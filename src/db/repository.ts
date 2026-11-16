import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  Decision,
  GatekeeperTask,
  ReasonCode,
} from '../shared/protocol.js';
import type {
  InboundProofResult,
  ProofBundle,
} from '../agent/contracts.js';
import type { PolicyCheck } from '../agent/policy.js';
import { SCHEMA_SQL } from './schema.js';

export type TaskState = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface TaskClaim {
  kind: 'claimed' | 'processing' | 'duplicate' | 'conflict';
  taskId: string;
  proofAlreadySeen: boolean;
  responseBody?: Buffer;
  responseSignature?: string;
}

export interface TaskListFilters {
  limit: number;
  offset: number;
  decision?: Decision;
  reasonCode?: ReasonCode;
}

export interface TaskSummaryItem {
  taskId: string;
  mode: string;
  state: TaskState;
  decision: Decision | null;
  reasonCode: ReasonCode | null;
  proofTx: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskSummaryItem {
  issuedAt: string;
  deadlineAt: string;
  requestDigest: string;
  policyChecks: PolicyCheck[];
  inboundVerification: InboundProofResult | null;
  proof: ProofBundle | null;
  kurier: Record<string, unknown> | null;
  attempts: ProofAttempt[];
}

export interface ProofAttempt {
  id: string;
  stage: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardSummary {
  generatedAt: string;
  service: {
    status: 'ready';
    detail: string;
  };
  totals: {
    tasks: number;
    completed: number;
    processing: number;
    failed: number;
    approvals: number;
    rejections: number;
    proofs: number;
    locallyVerifiedProofs: number;
    submittedKurierProofs: number;
    finalizedKurierProofs: number;
  };
  decisions: Record<string, number>;
  reasons: Record<string, number>;
  latencyMs: {
    average: number | null;
    p95: number | null;
    maximum: number | null;
  };
  recentFailures: TaskSummaryItem[];
}

export class PostgresTaskRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async ensureSchema(): Promise<void> {
    await this.#pool.query(SCHEMA_SQL);
  }

  async ping(): Promise<void> {
    await this.#pool.query('SELECT 1');
  }

  async claimTask(task: GatekeeperTask, requestDigest: string): Promise<TaskClaim> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO agent_tasks (task_id, request_digest, envelope, state)
         VALUES ($1, $2, $3, 'PROCESSING')
         ON CONFLICT DO NOTHING
         RETURNING task_id`,
        [task.task_id, requestDigest, JSON.stringify(task)],
      );

      if (inserted.rowCount === 1) {
        const owner = await this.#claimProofReference(client, task);
        await client.query(
          `UPDATE agent_tasks SET updated_at = now() WHERE task_id = $1`,
          [task.task_id],
        );
        await client.query('COMMIT');
        return {
          kind: 'claimed',
          taskId: task.task_id,
          proofAlreadySeen: owner !== task.task_id,
        };
      }

      const existing = await client.query<StoredTaskRow>(
        `SELECT state, request_digest, response_body, response_signature, updated_at
         FROM agent_tasks WHERE task_id = $1 FOR UPDATE`,
        [task.task_id],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('task disappeared while it was being claimed');

      if (row.request_digest !== requestDigest) {
        await client.query('COMMIT');
        return {
          kind: 'conflict',
          taskId: task.task_id,
          proofAlreadySeen: false,
        };
      }

      if (row.response_body && row.response_signature) {
        await client.query('COMMIT');
        return {
          kind: 'duplicate',
          taskId: task.task_id,
          proofAlreadySeen: false,
          responseBody: row.response_body,
          responseSignature: row.response_signature,
        };
      }

      const staleProcessing =
        row.state === 'PROCESSING' &&
        Date.now() - new Date(row.updated_at).getTime() > 120_000;
      const reclaimable = row.state === 'FAILED' || staleProcessing;
      if (reclaimable) {
        const owner = await this.#claimProofReference(client, task);
        await client.query(
          `UPDATE agent_tasks
           SET state = 'PROCESSING', error = NULL, updated_at = now()
           WHERE task_id = $1`,
          [task.task_id],
        );
        await client.query('COMMIT');
        return {
          kind: 'claimed',
          taskId: task.task_id,
          proofAlreadySeen: owner !== task.task_id,
        };
      }

      await client.query('COMMIT');
      return {
        kind: 'processing',
        taskId: task.task_id,
        proofAlreadySeen: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStoredResponse(taskId: string): Promise<{ body: Buffer; signature: string } | null> {
    const result = await this.#pool.query<StoredTaskRow>(
      `SELECT response_body, response_signature
       FROM agent_tasks WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row?.response_body || !row.response_signature) return null;
    return { body: row.response_body, signature: row.response_signature };
  }

  async recordAttempt(
    taskId: string,
    stage: string,
    status: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO proof_attempts (task_id, stage, status, detail)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [taskId, stage, status, JSON.stringify(detail)],
    );
  }

  async completeTask(input: {
    taskId: string;
    decision: Decision;
    reasonCode: ReasonCode;
    responseBody: Buffer;
    responseSignature: string;
    proof: ProofBundle | null;
    policyChecks: PolicyCheck[];
    inboundVerification: InboundProofResult | null;
    kurier: Record<string, unknown> | null;
    durationMs: number;
  }): Promise<void> {
    await this.#pool.query(
      `UPDATE agent_tasks SET
         state = 'COMPLETED',
         decision = $2,
         reason_code = $3,
         response_body = $4,
         response_signature = $5,
         proof = $6::jsonb,
         public_signals = $7::jsonb,
         policy_checks = $8::jsonb,
         inbound_verification = $9::jsonb,
         kurier = $10::jsonb,
         duration_ms = $11,
         error = NULL,
         updated_at = now()
       WHERE task_id = $1`,
      [
        input.taskId,
        input.decision,
        input.reasonCode,
        input.responseBody,
        input.responseSignature,
        input.proof ? JSON.stringify(input.proof) : null,
        input.proof ? JSON.stringify(input.proof.publicSignals) : null,
        JSON.stringify(input.policyChecks),
        input.inboundVerification ? JSON.stringify(input.inboundVerification) : null,
        input.kurier ? JSON.stringify(input.kurier) : null,
        input.durationMs,
      ],
    );
  }

  async failTask(taskId: string, error: string, durationMs: number): Promise<void> {
    await this.#pool.query(
      `UPDATE agent_tasks
       SET state = 'FAILED', error = $2, duration_ms = $3, updated_at = now()
       WHERE task_id = $1`,
      [taskId, error.slice(0, 4_000), durationMs],
    );
  }

  async listTasks(filters: TaskListFilters): Promise<TaskSummaryItem[]> {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (filters.decision) {
      values.push(filters.decision);
      conditions.push(`decision = $${values.length}`);
    }
    if (filters.reasonCode) {
      values.push(filters.reasonCode);
      conditions.push(`reason_code = $${values.length}`);
    }
    values.push(filters.limit, filters.offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, envelope, state, decision, reason_code, duration_ms, error,
              created_at, updated_at
       FROM agent_tasks
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(mapTaskSummary);
  }

  async getTask(taskId: string): Promise<TaskDetail | null> {
    const result = await this.#pool.query<TaskRow>(
      `SELECT task_id, envelope, state, decision, reason_code, duration_ms, error,
              created_at, updated_at, request_digest, policy_checks,
              inbound_verification, proof, kurier
       FROM agent_tasks WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const attemptsResult = await this.#pool.query<AttemptRow>(
      `SELECT id, stage, status, detail, created_at
       FROM proof_attempts WHERE task_id = $1 ORDER BY created_at DESC`,
      [taskId],
    );
    const summary = mapTaskSummary(row);
    return {
      ...summary,
      issuedAt: row.envelope.issued_at,
      deadlineAt: row.envelope.deadline_at,
      requestDigest: row.request_digest,
      policyChecks: (row.policy_checks as PolicyCheck[] | null) ?? [],
      inboundVerification:
        (row.inbound_verification as InboundProofResult | null) ?? null,
      proof: (row.proof as ProofBundle | null) ?? null,
      kurier: (row.kurier as Record<string, unknown> | null) ?? null,
      attempts: attemptsResult.rows.map((attempt) => ({
        id: String(attempt.id),
        stage: attempt.stage,
        status: attempt.status,
        detail: (attempt.detail as Record<string, unknown>) ?? {},
        createdAt: new Date(attempt.created_at).toISOString(),
      })),
    };
  }

  async listProofs(limit: number, offset: number): Promise<ProofLedgerItem[]> {
    const result = await this.#pool.query<ProofRow>(
      `SELECT task_id, envelope, decision, reason_code, proof, public_signals,
              inbound_verification, kurier, duration_ms, created_at
       FROM agent_tasks
       WHERE proof IS NOT NULL OR kurier IS NOT NULL
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows.map((row) => ({
      taskId: row.task_id,
      decision: row.decision,
      reasonCode: row.reason_code,
      proofTx: row.envelope?.input?.proof_tx ?? null,
      locallyVerified: Boolean(row.proof),
      publicSignalCount: Array.isArray(row.public_signals) ? row.public_signals.length : 0,
      inboundVerified: Boolean(row.inbound_verification?.verified),
      kurierStatus:
        typeof row.kurier?.status === 'string' ? row.kurier.status : null,
      kurierTxHash:
        typeof row.kurier?.txHash === 'string' ? row.kurier.txHash : null,
      durationMs: row.duration_ms,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async dashboardSummary(): Promise<DashboardSummary> {
    const [totalsResult, decisionsResult, reasonsResult, latencyResult, failuresResult] =
      await Promise.all([
        this.#pool.query<TotalsRow>(
          `SELECT
             count(*)::int AS tasks,
             count(*) FILTER (WHERE state = 'COMPLETED')::int AS completed,
             count(*) FILTER (WHERE state = 'PROCESSING')::int AS processing,
             count(*) FILTER (WHERE state = 'FAILED')::int AS failed,
             count(*) FILTER (WHERE decision = 'APPROVE')::int AS approvals,
             count(*) FILTER (WHERE decision = 'REJECT')::int AS rejections,
             count(*) FILTER (WHERE proof IS NOT NULL)::int AS proofs,
             count(*) FILTER (WHERE proof IS NOT NULL)::int AS locally_verified_proofs,
             count(*) FILTER (WHERE kurier IS NOT NULL)::int AS submitted_kurier_proofs,
             count(*) FILTER (WHERE kurier->>'status' = 'Finalized')::int AS finalized_kurier_proofs
           FROM agent_tasks`,
        ),
        this.#pool.query<GroupRow>(
          `SELECT COALESCE(decision, 'PENDING') AS key, count(*)::int AS count
           FROM agent_tasks GROUP BY 1 ORDER BY 1`,
        ),
        this.#pool.query<GroupRow>(
          `SELECT COALESCE(reason_code, 'PENDING') AS key, count(*)::int AS count
           FROM agent_tasks WHERE reason_code IS NOT NULL GROUP BY 1 ORDER BY 1`,
        ),
        this.#pool.query<LatencyRow>(
          `SELECT avg(duration_ms)::float AS average,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float AS p95,
                  max(duration_ms)::float AS maximum
           FROM agent_tasks WHERE duration_ms IS NOT NULL`,
        ),
        this.#pool.query<TaskRow>(
          `SELECT task_id, envelope, state, decision, reason_code, duration_ms, error,
                  created_at, updated_at
           FROM agent_tasks
           WHERE state = 'FAILED' OR error IS NOT NULL
           ORDER BY updated_at DESC LIMIT 8`,
        ),
      ]);

    const totals = totalsResult.rows[0];
    const latency = latencyResult.rows[0];
    return {
      generatedAt: new Date().toISOString(),
      service: {
        status: 'ready',
        detail: 'PostgreSQL is reachable; dashboard values come from the durable task ledger.',
      },
      totals: {
        tasks: totals.tasks,
        completed: totals.completed,
        processing: totals.processing,
        failed: totals.failed,
        approvals: totals.approvals,
        rejections: totals.rejections,
        proofs: totals.proofs,
        locallyVerifiedProofs: totals.locally_verified_proofs,
        submittedKurierProofs: totals.submitted_kurier_proofs,
        finalizedKurierProofs: totals.finalized_kurier_proofs,
      },
      decisions: Object.fromEntries(decisionsResult.rows.map((row) => [row.key, row.count])),
      reasons: Object.fromEntries(reasonsResult.rows.map((row) => [row.key, row.count])),
      latencyMs: {
        average: latency?.average == null ? null : Math.round(latency.average),
        p95: latency?.p95 == null ? null : Math.round(latency.p95),
        maximum: latency?.maximum == null ? null : Math.round(latency.maximum),
      },
      recentFailures: failuresResult.rows.map(mapTaskSummary),
    };
  }

  async #claimProofReference(
    client: PoolClient,
    task: GatekeeperTask,
  ): Promise<string> {
    await client.query(
      `INSERT INTO proof_references (proof_tx, first_task_id)
       VALUES ($1, $2)
       ON CONFLICT (proof_tx) DO NOTHING`,
      [task.input.proof_tx.toLowerCase(), task.task_id],
    );
    const result = await client.query<{ first_task_id: string }>(
      `SELECT first_task_id FROM proof_references WHERE proof_tx = $1`,
      [task.input.proof_tx.toLowerCase()],
    );
    return result.rows[0]?.first_task_id ?? task.task_id;
  }
}

export interface ProofLedgerItem {
  taskId: string;
  decision: Decision | null;
  reasonCode: ReasonCode | null;
  proofTx: string | null;
  locallyVerified: boolean;
  publicSignalCount: number;
  inboundVerified: boolean;
  kurierStatus: string | null;
  kurierTxHash: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface StoredTaskRow extends QueryResultRow {
  state: TaskState;
  request_digest: string;
  response_body: Buffer | null;
  response_signature: string | null;
  updated_at: Date | string;
}

interface TaskEnvelopeRow {
  mode: string;
  issued_at: string;
  deadline_at: string;
  input?: { proof_tx?: string };
}

interface TaskRow extends QueryResultRow {
  task_id: string;
  envelope: TaskEnvelopeRow;
  state: TaskState;
  decision: Decision | null;
  reason_code: ReasonCode | null;
  duration_ms: number | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  request_digest: string;
  policy_checks?: PolicyCheck[] | null;
  inbound_verification?: InboundProofResult | null;
  proof?: ProofBundle | null;
  kurier?: Record<string, unknown> | null;
  public_signals?: string[] | null;
}

interface AttemptRow extends QueryResultRow {
  id: string;
  stage: string;
  status: string;
  detail: Record<string, unknown>;
  created_at: Date | string;
}

interface ProofRow extends TaskRow {
  public_signals: string[] | null;
}

interface TotalsRow extends QueryResultRow {
  tasks: number;
  completed: number;
  processing: number;
  failed: number;
  approvals: number;
  rejections: number;
  proofs: number;
  locally_verified_proofs: number;
  submitted_kurier_proofs: number;
  finalized_kurier_proofs: number;
}

interface GroupRow extends QueryResultRow {
  key: string;
  count: number;
}

interface LatencyRow extends QueryResultRow {
  average: number | null;
  p95: number | null;
  maximum: number | null;
}

function mapTaskSummary(row: TaskRow): TaskSummaryItem {
  return {
    taskId: row.task_id,
    mode: row.envelope?.mode ?? 'unknown',
    state: row.state,
    decision: row.decision,
    reasonCode: row.reason_code,
    proofTx: row.envelope?.input?.proof_tx ?? null,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
