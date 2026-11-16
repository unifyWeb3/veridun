import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type {
  InboundProofResult,
  InboundProofVerifier,
  KurierClient,
  ProofBundle,
  Prover,
} from '../agent/contracts.js';
import { evaluatePolicy, type PolicyCheck } from '../agent/policy.js';
import { serializeSignedJson, verifyBodySignature } from '../agent/hmac.js';
import type { AppConfig } from '../config/env.js';
import type { PostgresTaskRepository } from '../db/repository.js';
import {
  agentResponseSchema,
  gatekeeperTaskSchema,
  preflightSchema,
  type AgentResponse,
  type Decision,
  type GatekeeperTask,
  type ReasonCode,
} from '../shared/protocol.js';

export const SIGNATURE_HEADER = 'x-agent-games-signature';

export interface AppDependencies {
  config: AppConfig;
  repository: Pick<
    PostgresTaskRepository,
    | 'ping'
    | 'claimTask'
    | 'getStoredResponse'
    | 'recordAttempt'
    | 'completeTask'
    | 'failTask'
    | 'listTasks'
    | 'getTask'
    | 'listProofs'
    | 'dashboardSummary'
  >;
  prover: Prover;
  inboundVerifier: InboundProofVerifier;
  kurier: KurierClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`${label} has no remaining response budget`));
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function taskWindowError(
  task: GatekeeperTask,
  now: number,
  clockSkewMs: number,
  maxWindowMs: number,
): string | null {
  const issuedAt = Date.parse(task.issued_at);
  const deadlineAt = Date.parse(task.deadline_at);
  if (!Number.isFinite(issuedAt)) return 'issued_at is not a valid timestamp';
  if (!Number.isFinite(deadlineAt)) return 'deadline_at is not a valid timestamp';
  if (issuedAt > now + clockSkewMs) return 'issued_at is in the future';
  if (now - issuedAt > maxWindowMs) return 'issued_at is outside the accepted task window';
  if (deadlineAt - issuedAt > maxWindowMs) return 'task window exceeds the accepted duration';
  if (deadlineAt <= now) return 'deadline_at has elapsed';
  return null;
}

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new Error('request body was not buffered as raw bytes');
}

function sendSigned(
  reply: FastifyReply,
  secret: string,
  statusCode: number,
  value: unknown,
): FastifyReply {
  const { body, signature } = serializeSignedJson(secret, value);
  return reply
    .status(statusCode)
    .header('content-type', 'application/json; charset=utf-8')
    .header(SIGNATURE_HEADER, signature)
    .send(body);
}

function sendStored(
  reply: FastifyReply,
  body: Buffer,
  signature: string,
): FastifyReply {
  return reply
    .status(200)
    .header('content-type', 'application/json; charset=utf-8')
    .header(SIGNATURE_HEADER, signature)
    .send(body);
}

function responseFor(
  decision: 'APPROVE' | 'REJECT',
  reasonCode: ReasonCode,
  proofTx: string,
  proof?: ProofBundle,
  proofRequired = false,
): AgentResponse {
  if (proofRequired && !proof) {
    throw new Error(`a Groth16 proof is required for ${reasonCode}`);
  }

  const response: AgentResponse = {
    decision,
    reason_code: reasonCode,
    proof_tx: proofTx,
  };
  if (proof) {
    response.proof = proof.proof;
    response.public_signals = proof.publicSignals;
  }
  return agentResponseSchema.parse(response);
}

export async function createApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, repository, prover, inboundVerifier, kurier } = dependencies;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.x-agent-games-signature'],
    },
    bodyLimit: config.maxRequestBytes,
    requestTimeout: config.requestBudgetMs + 2_000,
    connectionTimeout: 10_000,
  });

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  const healthHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await repository.ping();
      return reply.send({
        ok: true,
        service: 'veridun',
        database: 'ready',
        proofSubmission: kurier.enabled && config.proofSubmitEnabled ? 'enabled' : 'disabled',
        timestamp: new Date().toISOString(),
      });
    } catch {
      return reply.status(503).send({
        ok: false,
        service: 'veridun',
        database: 'unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  const agentHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const rawBody = asBuffer(request.body);
    if (!verifyBodySignature(config.hmacSecret, rawBody, request.headers[SIGNATURE_HEADER])) {
      return sendSigned(reply, config.hmacSecret, 401, { error: 'INVALID_SIGNATURE' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return sendSigned(reply, config.hmacSecret, 400, { error: 'INVALID_JSON' });
    }

    const preflight = preflightSchema.safeParse(parsed);
    if (preflight.success) {
      return sendSigned(reply, config.hmacSecret, 200, {
        ok: true,
        protocolVersion: 'v1',
      });
    }

    const taskResult = gatekeeperTaskSchema.safeParse(parsed);
    if (!taskResult.success) {
      return sendSigned(reply, config.hmacSecret, 400, { error: 'INVALID_TASK' });
    }
    const task = taskResult.data;
    const deadlineAt = Date.parse(task.deadline_at);
    const now = Date.now();
    const windowError = taskWindowError(
      task,
      now,
      config.taskClockSkewMs,
      config.taskMaxWindowMs,
    );
    if (windowError) {
      return sendSigned(reply, config.hmacSecret, 400, {
        error: 'INVALID_TASK_WINDOW',
        detail: windowError,
      });
    }
    if (!Number.isFinite(deadlineAt) || deadlineAt <= now + 250) {
      return sendSigned(reply, config.hmacSecret, 410, { error: 'TASK_DEADLINE_EXPIRED' });
    }

    const requestDigest = createHash('sha256').update(rawBody).digest('hex');
    const claim = await repository.claimTask(task, requestDigest);
    if (claim.kind === 'conflict') {
      return sendSigned(reply, config.hmacSecret, 409, { error: 'TASK_ID_CONFLICT' });
    }
    if (claim.kind === 'duplicate' && claim.responseBody && claim.responseSignature) {
      return sendStored(reply, claim.responseBody, claim.responseSignature);
    }
    if (claim.kind === 'processing') {
      const stored = await waitForStoredResponse(
        repository,
        task.task_id,
        Math.min(deadlineAt - 250, now + config.requestBudgetMs),
      );
      if (stored) return sendStored(reply, stored.body, stored.signature);
      return sendSigned(reply, config.hmacSecret, 409, { error: 'TASK_IN_PROGRESS' });
    }

    return handleClaimedTask({
      task,
      claim,
      requestDigest,
      deadlineAt,
      dependencies,
      logger: app.log,
      reply,
    });
  };

  app.post('/agent', agentHandler);
  app.post('/api/agent', agentHandler);

  const summaryHandler = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send(await repository.dashboardSummary());
    } catch (error) {
      requestLogError(app.log, error, 'dashboard summary failed');
      return reply.status(503).send({ error: 'DASHBOARD_UNAVAILABLE' });
    }
  };

  // Canonical single-segment dashboard route. Vercel only routes one-segment
  // paths under /api to the catch-all function, so the console uses this
  // path and the nested alias below is kept for direct Fastify access.
  app.get('/api/summary', summaryHandler);
  app.get('/api/dashboard/summary', summaryHandler);

  app.get('/api/tasks', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limit = boundedInteger(query.limit, 50, 1, 200);
    const offset = boundedInteger(query.offset, 0, 0, 1_000_000);
    const decision =
      query.decision === 'APPROVE' || query.decision === 'REJECT'
        ? query.decision
        : undefined;
    const reasonCode =
      typeof query.reason_code === 'string' && query.reason_code.length > 0
        ? (query.reason_code as ReasonCode)
        : undefined;
    try {
      const items = await repository.listTasks({ limit, offset, decision, reasonCode });
      return reply.send({ items, limit, offset });
    } catch (error) {
      requestLogError(app.log, error, 'task list failed');
      return reply.status(503).send({ error: 'TASKS_UNAVAILABLE' });
    }
  });

  const taskDetailHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { taskId?: string };
    const query = request.query as Record<string, unknown>;
    const taskId =
      params.taskId ?? (typeof query.task_id === 'string' ? query.task_id : undefined);
    if (!taskId) {
      return reply.status(400).send({ error: 'TASK_ID_REQUIRED' });
    }
    try {
      const task = await repository.getTask(taskId);
      if (!task) return reply.status(404).send({ error: 'TASK_NOT_FOUND' });
      return reply.send(task);
    } catch (error) {
      requestLogError(app.log, error, 'task detail failed');
      return reply.status(503).send({ error: 'TASK_UNAVAILABLE' });
    }
  };

  // Canonical single-segment dashboard route (query parameter carries the id).
  // Vercel only routes one-segment paths under /api to the catch-all function,
  // so the console uses this path and the nested alias below is kept for
  // direct Fastify access.
  app.get('/api/task', taskDetailHandler);
  app.get('/api/tasks/:taskId', taskDetailHandler);

  app.get('/api/proofs', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limit = boundedInteger(query.limit, 50, 1, 200);
    const offset = boundedInteger(query.offset, 0, 0, 1_000_000);
    try {
      const items = await repository.listProofs(limit, offset);
      return reply.send({ items, limit, offset });
    } catch (error) {
      requestLogError(app.log, error, 'proof ledger failed');
      return reply.status(503).send({ error: 'PROOFS_UNAVAILABLE' });
    }
  });

  const webRoot = path.resolve('dist/web');
  if (config.dashboardEnabled && existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: true,
    });
  }

  app.setErrorHandler((error, request, reply) => {
    requestLogError(app.log, error, 'unhandled request error');
    if (reply.sent) return;
    return sendSigned(reply, config.hmacSecret, 500, { error: 'INTERNAL_ERROR' });
  });

  return app;
}

async function handleClaimedTask(input: {
  task: GatekeeperTask;
  claim: { proofAlreadySeen: boolean };
  requestDigest: string;
  deadlineAt: number;
  dependencies: AppDependencies;
  logger: FastifyBaseLogger;
  reply: FastifyReply;
}): Promise<FastifyReply> {
  const { task, claim, requestDigest, deadlineAt, dependencies, logger, reply } = input;
  const { config, repository, prover, inboundVerifier, kurier } = dependencies;
  const startedAt = Date.now();

  let decision: Decision = 'REJECT';
  let reasonCode: ReasonCode = 'PROOF_NOT_FINALIZED';
  let policyChecks: PolicyCheck[] = [];
  let proof: ProofBundle | null = null;
  let inboundVerification: InboundProofResult | null = null;
  let kurierEvidence: Record<string, unknown> | null = null;
  let proofExpected = false;

  try {
    const policy = evaluatePolicy(task, claim.proofAlreadySeen);
    decision = policy.decision;
    reasonCode = policy.reasonCode;
    policyChecks = policy.checks;

    if (decision === 'APPROVE') {
      const inboundTimeoutMs = Math.min(
        config.inboundProofTimeoutMs,
        deadlineAt - Date.now() - 750,
      );
      inboundVerification = await withTimeout(
        inboundVerifier.verify(task),
        inboundTimeoutMs,
        'inbound proof verification',
      ).catch((error: unknown) => failedInboundResult(
        task,
        inboundVerifier.source,
        error instanceof Error ? error.message : String(error),
      ));
      await safeRecord(
        repository,
        task.task_id,
        'inbound-proof',
        inboundVerification.verified ? 'verified' : 'failed',
        {
          source: inboundVerification.source,
          finalized: inboundVerification.finalized,
          vkMatches: inboundVerification.vkMatches,
          blockNumber: inboundVerification.blockNumber,
          publicInputCount: inboundVerification.publicInputs.length,
          error: inboundVerification.error,
        },
      );
      if (!inboundVerification.verified) {
        decision = 'REJECT';
        reasonCode = 'PROOF_NOT_FINALIZED';
      }
    }

    proofExpected =
      policy.provable &&
      reasonCode !== 'PROOF_REUSED' &&
      reasonCode !== 'PROOF_NOT_FINALIZED';

    if (proofExpected) {
      const proofTimeoutMs = deadlineAt - Date.now() - 750;
      proof = await withTimeout(
        prover.prove(task, decision, requestDigest),
        proofTimeoutMs,
        'Groth16 proof generation',
      );
      await safeRecord(repository, task.task_id, 'proof-generation', 'verified', {
        publicSignalCount: proof.publicSignals.length,
        decision,
        reasonCode,
      });
    } else {
      await safeRecord(repository, task.task_id, 'proof-generation', 'not-applicable', {
        decision,
        reasonCode,
        reason: reasonCode === 'PROOF_REUSED'
          ? 'Replay is external state and the circuit-visible condition remains valid.'
          : 'No circuit-valid decision proof exists for this state.',
      });
    }

    if (
      proof &&
      config.proofSubmitEnabled &&
      kurier.enabled &&
      deadlineAt - Date.now() > 1_000
    ) {
      const kurierDeadline = Math.min(
        deadlineAt - 750,
        Date.now() + config.kurierFinalityTimeoutMs,
      );
      try {
        const result = await kurier.submitAndAwait(
          proof,
          task.input.registered_vk,
          kurierDeadline,
        );
        kurierEvidence = { ...result };
        await safeRecord(repository, task.task_id, 'kurier', 'finalized', {
          jobId: result.jobId,
          status: result.status,
          txHash: result.txHash,
          blockHash: result.blockHash,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await safeRecord(repository, task.task_id, 'kurier', 'failed', { error: message });
      }
    }

    const response = responseFor(
      decision,
      reasonCode,
      task.input.proof_tx,
      proof ?? undefined,
      proofExpected,
    );
    const serialized = serializeSignedJson(config.hmacSecret, response);
    const durationMs = Date.now() - startedAt;

    await repository.completeTask({
      taskId: task.task_id,
      decision,
      reasonCode,
      responseBody: serialized.body,
      responseSignature: serialized.signature,
      proof,
      policyChecks,
      inboundVerification,
      kurier: kurierEvidence,
      durationMs,
    });
    await safeRecord(repository, task.task_id, 'response', 'signed', {
      durationMs,
      decision,
      reasonCode,
      hasProof: Boolean(proof),
      responseBytes: serialized.body.length,
    });

    return sendStored(reply, serialized.body, serialized.signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;

    if (decision === 'APPROVE') {
      decision = 'REJECT';
      reasonCode = 'PROOF_NOT_FINALIZED';
    }

    const response = responseFor(
      decision,
      reasonCode,
      task.input.proof_tx,
      undefined,
      false,
    );
    const serialized = serializeSignedJson(config.hmacSecret, response);

    try {
      await repository.completeTask({
        taskId: task.task_id,
        decision,
        reasonCode,
        responseBody: serialized.body,
        responseSignature: serialized.signature,
        proof: null,
        policyChecks,
        inboundVerification,
        kurier: kurierEvidence,
        durationMs,
      });
    } catch {
      await repository.failTask(task.task_id, message, durationMs).catch(() => undefined);
    }

    await safeRecord(repository, task.task_id, 'processing', 'failed', {
      error: message,
      decision,
      reasonCode,
      durationMs,
    });
    requestLogError(logger, error, 'task processing failed; returned a signed rejection');

    return sendStored(reply, serialized.body, serialized.signature);
  }
}

function failedInboundResult(
  task: GatekeeperTask,
  source: 'zkverify' | 'trusted-payload',
  error: string,
): InboundProofResult {
  return {
    verified: false,
    finalized: false,
    vkHash: null,
    vkMatches: false,
    publicInputs: [],
    publicInputsHash: null,
    blockNumber: null,
    blockHash: null,
    extrinsicHash: task.input.proof_tx,
    source,
    error,
  };
}

async function waitForStoredResponse(
  repository: Pick<PostgresTaskRepository, 'getStoredResponse'>,
  taskId: string,
  deadlineAt: number,
): Promise<{ body: Buffer; signature: string } | null> {
  while (Date.now() < deadlineAt) {
    const stored = await repository.getStoredResponse(taskId);
    if (stored) return stored;
    await sleep(50);
  }
  return repository.getStoredResponse(taskId);
}

async function safeRecord(
  repository: Pick<PostgresTaskRepository, 'recordAttempt'>,
  taskId: string,
  stage: string,
  status: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await repository.recordAttempt(taskId, stage, status, detail);
  } catch {
    // Evidence telemetry must never replace the scored response. The durable task
    // row and its final response remain the authoritative record.
  }
}

function requestLogError(
  logger: Pick<FastifyBaseLogger, 'error'>,
  error: unknown,
  message: string,
): void {
  logger.error({ err: error }, message);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
