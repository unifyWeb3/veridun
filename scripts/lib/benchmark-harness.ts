import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { groth16 } from 'snarkjs';
import { createApp, SIGNATURE_HEADER } from '../../src/api/app.js';
import { TrustedPayloadProofVerifier } from '../../src/agent/inbound-proof.js';
import type { Groth16Proof } from '../../src/agent/contracts.js';
import { signBody } from '../../src/agent/hmac.js';
import { CircuitProver } from '../../src/agent/prover.js';
import type { AppConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/db/pool.js';
import { PostgresTaskRepository } from '../../src/db/repository.js';
import type { GatekeeperTask } from '../../src/shared/protocol.js';

/**
 * Concurrency and latency harness for the Proof Gatekeeper service.
 *
 * The harness runs the real Fastify application over real HTTP against a real
 * PostgreSQL server with the official circuit artifacts, so every measured
 * number comes from the same code path the deployment runs:
 *
 *   request bytes -> HMAC verify -> schema validate -> transactional claim ->
 *   policy -> Groth16 prove -> local proof verification -> persist -> sign.
 *
 * It proves three properties and fails the run when any of them breaks:
 *
 *   1. concurrent deliveries of one task ID produce exactly one stored
 *      response, and every caller receives the identical signed bytes;
 *   2. the stored proof verifies against the official verification key;
 *   3. a second task that reuses a proof reference is rejected as a replay
 *      without a proof.
 */

export interface BenchmarkOptions {
  /** Parallel deliveries of the same task ID. */
  concurrency: number;
  /** Distinct tasks delivered one after another, for the latency sample. */
  samples: number;
  /** Directory holding the official circuit artifacts. */
  circuitDir: string;
  /** HMAC secret used to sign the benchmark requests. */
  hmacSecret: string;
  /** External PostgreSQL URL. When absent, an embedded PGlite engine is used. */
  databaseUrl?: string;
  /** Internal response budget in milliseconds. */
  requestBudgetMs?: number;
  /** Fastify log level; `silent` by default so benchmark output stays readable. */
  logLevel?: AppConfig['logLevel'];
}

export interface BenchmarkAssertion {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LatencyStats {
  samples: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface BenchmarkResult {
  ok: boolean;
  generatedAt: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
    cpus: number;
    database: string;
    postgresVersion: string | null;
    circuitDir: string;
    taskIdEncoding: string;
  };
  budget: {
    internalBudgetMs: number;
    platformDeadlineMs: number;
  };
  scenarios: {
    concurrentDelivery: {
      deliveries: number;
      identicalResponseBodies: boolean;
      identicalSignatures: boolean;
      storedResponses: number;
      proofGenerations: number;
      responseBytes: number;
      wallClockMs: number;
      slowestDeliveryMs: number;
      retryReplayedStoredBytes: boolean;
      proofGenerationsAfterRetry: number;
    };
    sequentialLatency: LatencyStats & { decisions: string[] };
    replayDetection: {
      decision: string | null;
      reasonCode: string | null;
      carriedProof: boolean;
    };
    storedProofVerification: {
      verified: boolean;
      publicSignalCount: number;
    };
  };
  assertions: BenchmarkAssertion[];
}

const REGISTERED_VK =
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

function benchmarkConfig(options: BenchmarkOptions, databaseUrl: string): AppConfig {
  return {
    nodeEnv: 'test',
    hmacSecret: options.hmacSecret,
    databaseUrl,
    databasePoolMax: 8,
    autoMigrate: false,
    kurierApiKey: '',
    kurierApiBaseUrl: 'https://api.kurier.xyz/api/v1',
    circuitDir: path.resolve(options.circuitDir),
    taskIdEncoding: 'auto',
    inboundProofVerifier: 'trusted-payload',
    subscanBaseUrl: 'https://zkverify.subscan.io',
    zkverifyRpcUrl: 'https://zkverify-rpc.zkverify.io',
    inboundProofTimeoutMs: 5_000,
    port: 0,
    host: '127.0.0.1',
    logLevel: options.logLevel ?? 'silent',
    dashboardEnabled: false,
    proofSubmitEnabled: false,
    kurierPollIntervalMs: 250,
    kurierFinalityTimeoutMs: 5_000,
    requestBudgetMs: options.requestBudgetMs ?? 55_000,
    taskClockSkewMs: 5_000,
    taskMaxWindowMs: 65_000,
    maxRequestBytes: 1_048_576,
  };
}

function benchmarkTask(
  taskId: string,
  proofTx: string,
  issuedAt: string,
  deadlineAt: string,
): GatekeeperTask {
  return {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: taskId,
    mode: 'practice',
    issued_at: issuedAt,
    deadline_at: deadlineAt,
    input: {
      registered_vk: REGISTERED_VK,
      proof_vk: REGISTERED_VK,
      minimum: '1000',
      public_balance: '1460',
      expiry_block: '19842201',
      current_block: '19832000',
      recipient: `0x6e8f${'0'.repeat(32)}d8e9`,
      condition_recipient: `0x6e8f${'0'.repeat(32)}d8e9`,
      amount: '500',
      max_transfer: '1000',
      proof_tx: proofTx,
    },
  };
}

function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    minMs: sorted[0] ?? 0,
    meanMs: values.length ? Math.round(total / values.length) : 0,
    p50Ms: rank(0.5),
    p95Ms: rank(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

interface Delivery {
  status: number;
  body: string;
  signature: string | null;
  durationMs: number;
}

async function deliver(
  baseUrl: string,
  body: string,
  secret: string,
): Promise<Delivery> {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/agent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signBody(secret, body),
    },
    body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text,
    signature: response.headers.get(SIGNATURE_HEADER),
    durationMs: Date.now() - startedAt,
  };
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const assertions: BenchmarkAssertion[] = [];
  const assert = (name: string, ok: boolean, detail: string): void => {
    assertions.push({ name, ok, detail });
  };

  let postgres: EmbeddedPostgres | null = null;
  let databaseUrl = options.databaseUrl ?? '';
  let databaseLabel = options.databaseUrl
    ? 'external PostgreSQL server'
    : 'embedded PostgreSQL server (embedded-postgres)';
  const databaseDir = path.join(
    os.tmpdir(),
    `veridun-benchmark-${process.pid}-${Date.now()}`,
  );

  if (!databaseUrl) {
    const port = 55_400 + Math.floor(Math.random() * 400);
    postgres = new EmbeddedPostgres({
      databaseDir,
      port,
      user: 'postgres',
      password: 'veridun-benchmark',
      authMethod: 'password',
      persistent: false,
      // The platform binary package ships its symlinks in an install script
      // that package managers may skip; rehydrate them at runtime instead.
      autoRehydrateSymlinks: true,
      onLog: () => {},
      onError: (error: unknown) => {
        process.stderr.write(`postgres: ${String(error)}\n`);
      },
    });
    await postgres.initialise();
    await postgres.start();
    databaseUrl = `postgres://postgres:veridun-benchmark@127.0.0.1:${port}/postgres`;
  }

  const pool = createDatabasePool(databaseUrl, 8);
  const repository = new PostgresTaskRepository(pool);

  let postgresVersion: string | null = null;
  try {
    await repository.ensureSchema();
    const version = await pool.query<{ version: string }>('SELECT version()');
    postgresVersion = version.rows[0]?.version ?? null;
  } catch (error) {
    await pool.end();
    await postgres?.stop();
    throw error;
  }

  const config = benchmarkConfig(options, databaseUrl);
  const prover = new CircuitProver(config.circuitDir, config.taskIdEncoding);
  const app = await createApp({
    config,
    repository,
    prover,
    inboundVerifier: new TrustedPayloadProofVerifier(),
    kurier: {
      enabled: false,
      submitAndAwait: async () => {
        throw new Error('Kurier submission is disabled in the benchmark');
      },
    },
  });

  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

  try {
    // ---- Scenario 1: concurrent deliveries of one task ID -----------------
    const issuedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 60_000).toISOString();
    const sharedTask = benchmarkTask(
      'gk_benchmark_concurrent',
      `0x${'a1'.repeat(32)}`,
      issuedAt,
      deadlineAt,
    );
    const sharedBody = JSON.stringify(sharedTask);

    const concurrentStartedAt = Date.now();
    const deliveries = await Promise.all(
      Array.from({ length: options.concurrency }, () =>
        deliver(baseUrl, sharedBody, options.hmacSecret),
      ),
    );
    const concurrentWallClockMs = Date.now() - concurrentStartedAt;

    const bodies = new Set(deliveries.map((delivery) => delivery.body));
    const signatures = new Set(deliveries.map((delivery) => delivery.signature));
    const allSucceeded = deliveries.every((delivery) => delivery.status === 200);
    const identicalBodies = bodies.size === 1;
    const identicalSignatures = signatures.size === 1;

    const storedResponses = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM agent_tasks WHERE task_id = $1',
      [sharedTask.task_id],
    );
    const proofGenerations = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM proof_attempts
       WHERE task_id = $1 AND stage = 'proof-generation' AND status = 'verified'`,
      [sharedTask.task_id],
    );
    const storedRow = await pool.query<{
      response_body: Buffer | null;
      response_signature: string | null;
    }>(
      'SELECT response_body, response_signature FROM agent_tasks WHERE task_id = $1',
      [sharedTask.task_id],
    );

    const storedBody = storedRow.rows[0]?.response_body?.toString('utf8') ?? null;
    const storedSignature = storedRow.rows[0]?.response_signature ?? null;
    const storedCount = Number(storedResponses.rows[0]?.count ?? '0');
    const proofCount = Number(proofGenerations.rows[0]?.count ?? '0');

    assert('every concurrent delivery answered 200', allSucceeded,
      deliveries.map((delivery) => delivery.status).join(', '));
    assert('every concurrent delivery returned identical response bytes', identicalBodies,
      `${bodies.size} distinct body/bodies across ${deliveries.length} deliveries`);
    assert('every concurrent delivery returned identical signature', identicalSignatures,
      `${signatures.size} distinct signature(s)`);
    assert('exactly one task row was stored', storedCount === 1, `${storedCount} row(s)`);
    assert('the proof was generated exactly once', proofCount === 1, `${proofCount} generation(s)`);
    assert('the stored response equals the delivered response',
      storedBody !== null && storedBody === deliveries[0]?.body,
      storedBody === deliveries[0]?.body ? 'byte-identical' : 'stored bytes differ');
    assert('the stored signature equals the delivered signature',
      storedSignature !== null && storedSignature === deliveries[0]?.signature,
      storedSignature === deliveries[0]?.signature ? 'identical' : 'signatures differ');

    // A retry after completion must replay the stored bytes without
    // generating a second proof.
    const retryDelivery = await deliver(baseUrl, sharedBody, options.hmacSecret);
    const proofGenerationsAfterRetry = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM proof_attempts
       WHERE task_id = $1 AND stage = 'proof-generation' AND status = 'verified'`,
      [sharedTask.task_id],
    );
    assert('a retry replays the exact stored response bytes',
      retryDelivery.status === 200 && retryDelivery.body === deliveries[0]?.body,
      retryDelivery.status === 200 && retryDelivery.body === deliveries[0]?.body
        ? 'byte-identical replay'
        : `status ${retryDelivery.status}`);
    assert('a retry does not generate a second proof',
      Number(proofGenerationsAfterRetry.rows[0]?.count ?? '0') === 1,
      `${proofGenerationsAfterRetry.rows[0]?.count} generation(s) after the retry`);

    // ---- Scenario 2: sequential latency of distinct tasks ------------------
    const latencies: number[] = [];
    const decisions: string[] = [];
    for (let index = 0; index < options.samples; index += 1) {
      const task = benchmarkTask(
        `gk_benchmark_latency_${index}`,
        `0x${index.toString(16).padStart(2, '0').repeat(32)}`,
        new Date().toISOString(),
        new Date(Date.now() + 60_000).toISOString(),
      );
      const delivery = await deliver(baseUrl, JSON.stringify(task), options.hmacSecret);
      latencies.push(delivery.durationMs);
      const parsed = JSON.parse(delivery.body) as { decision?: string };
      decisions.push(parsed.decision ?? 'unknown');
    }

    const stats = latencyStats(latencies);
    assert('every sequential task was answered 200',
      decisions.every((decision) => decision === 'APPROVE'),
      decisions.join(', '));
    assert('the slowest observed response stayed inside the internal budget',
      stats.maxMs <= config.requestBudgetMs,
      `max ${stats.maxMs} ms against a ${config.requestBudgetMs} ms budget`);

    // ---- Scenario 3: replay detection -------------------------------------
    const replayTask = benchmarkTask(
      'gk_benchmark_replay',
      `0x${'a1'.repeat(32)}`,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
    );
    const replayDelivery = await deliver(
      baseUrl,
      JSON.stringify(replayTask),
      options.hmacSecret,
    );
    const replayBody = JSON.parse(replayDelivery.body) as {
      decision?: string;
      reason_code?: string;
      proof?: unknown;
      public_signals?: unknown;
    };
    assert('a reused proof reference is rejected as a replay',
      replayBody.decision === 'REJECT' && replayBody.reason_code === 'PROOF_REUSED',
      `${replayBody.decision ?? 'unknown'} / ${replayBody.reason_code ?? 'unknown'}`);
    assert('a replay rejection carries no proof',
      replayBody.proof === undefined && replayBody.public_signals === undefined,
      replayBody.proof === undefined ? 'no proof in the response' : 'a proof was returned');

    // ---- Scenario 4: the stored proof verifies against the official key ----
    const proofRow = await pool.query<{
      proof: { proof: Groth16Proof; publicSignals: string[] } | null;
    }>(
      'SELECT proof FROM agent_tasks WHERE task_id = $1',
      [sharedTask.task_id],
    );
    const storedProof = proofRow.rows[0]?.proof ?? null;
    let proofVerified = false;
    let publicSignalCount = 0;
    if (storedProof) {
      publicSignalCount = storedProof.publicSignals?.length ?? 0;
      const verificationKey = JSON.parse(
        await readFile(path.join(config.circuitDir, 'gatekeeper_vkey.json'), 'utf8'),
      );
      proofVerified = await groth16.verify(
        verificationKey,
        storedProof.publicSignals,
        storedProof.proof,
      );
    }
    assert('the stored proof verifies against the official verification key',
      proofVerified,
      proofVerified ? 'groth16.verify returned true' : 'groth16.verify returned false');

    return {
      ok: assertions.every((assertion) => assertion.ok),
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        arch: process.arch,
        cpus: os.cpus().length,
        database: databaseLabel,
        postgresVersion,
        circuitDir: config.circuitDir,
        taskIdEncoding: config.taskIdEncoding,
      },
      budget: {
        internalBudgetMs: config.requestBudgetMs,
        platformDeadlineMs: 60_000,
      },
      scenarios: {
        concurrentDelivery: {
          deliveries: deliveries.length,
          identicalResponseBodies: identicalBodies,
          identicalSignatures: identicalSignatures,
          storedResponses: storedCount,
          proofGenerations: proofCount,
          responseBytes: Buffer.byteLength(deliveries[0]?.body ?? '', 'utf8'),
          wallClockMs: concurrentWallClockMs,
          slowestDeliveryMs: Math.max(...deliveries.map((delivery) => delivery.durationMs)),
          retryReplayedStoredBytes:
            retryDelivery.status === 200 && retryDelivery.body === deliveries[0]?.body,
          proofGenerationsAfterRetry: Number(
            proofGenerationsAfterRetry.rows[0]?.count ?? '0',
          ),
        },
        sequentialLatency: { ...stats, decisions },
        replayDetection: {
          decision: replayBody.decision ?? null,
          reasonCode: replayBody.reason_code ?? null,
          carriedProof: replayBody.proof !== undefined,
        },
        storedProofVerification: { verified: proofVerified, publicSignalCount },
      },
      assertions,
    };
  } finally {
    await app.close();
    await pool.end();
    await postgres?.stop();
    if (postgres && !options.databaseUrl) {
      // `persistent: false` keeps the cluster from being reused, but the data
      // directory is left behind on some platforms.
      await rm(databaseDir, { recursive: true, force: true });
    }
  }
}
