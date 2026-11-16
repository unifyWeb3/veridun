import type {
  DashboardSummary,
  Decision,
  DecisionCounts,
  InboundVerification,
  HealthStatus,
  KurierEvidence,
  LatencySummary,
  ListResponse,
  PolicyCheck,
  ProofAttempt,
  ProofCounts,
  ProofEvidence,
  ProofQuery,
  ProofRecord,
  TaskDetail,
  TaskQuery,
  TaskRecord,
} from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathValue(root: unknown, path: string): unknown {
  const segments = path.split('.');
  let current = root;

  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function firstValue(root: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = pathValue(root, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function stringAt(root: unknown, paths: readonly string[]): string | null {
  const value = firstValue(root, paths);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function numberAt(root: unknown, paths: readonly string[]): number | null {
  const value = firstValue(root, paths);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanAt(root: unknown, paths: readonly string[]): boolean | null {
  const value = firstValue(root, paths);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'verified', 'valid', 'passed', '1'].includes(normalized)) return true;
    if (['false', 'no', 'unverified', 'invalid', 'failed', '0'].includes(normalized)) return false;
  }
  return null;
}

function errorAt(root: unknown): string | null {
  const value = firstValue(root, ['error', 'error_message', 'failure_reason', 'last_error']);
  if (typeof value === 'string') return value.trim() || null;
  if (isRecord(value)) return stringAt(value, ['message', 'detail', 'code']);
  return null;
}

function normalizeDecision(value: unknown): Decision | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (['APPROVE', 'APPROVED', 'ACCEPT', 'ACCEPTED'].includes(normalized)) return 'APPROVE';
  if (['REJECT', 'REJECTED', 'DENY', 'DENIED'].includes(normalized)) return 'REJECT';
  return null;
}

function normalizeTask(raw: unknown): TaskRecord {
  if (!isRecord(raw)) {
    return {
      id: 'Unidentified task',
      decision: null,
      reasonCode: null,
      status: null,
      mode: null,
      receivedAt: null,
      completedAt: null,
      updatedAt: null,
      durationMs: null,
      proofStatus: null,
      proofTx: null,
      error: null,
    };
  }

  return {
    id: stringAt(raw, ['task_id', 'taskId', 'id']) ?? 'Unidentified task',
    decision: normalizeDecision(firstValue(raw, ['decision', 'outcome'])),
    reasonCode: stringAt(raw, ['reason_code', 'reasonCode', 'reason', 'failure_reason']),
    status: stringAt(raw, ['status', 'lifecycle_state', 'lifecycleStatus', 'state']),
    mode: stringAt(raw, ['mode', 'task_mode']),
    receivedAt: stringAt(raw, ['received_at', 'receivedAt', 'created_at', 'createdAt', 'issued_at']),
    completedAt: stringAt(raw, ['completed_at', 'completedAt', 'finished_at']),
    updatedAt: stringAt(raw, ['updated_at', 'updatedAt', 'completed_at', 'completedAt']),
    durationMs: numberAt(raw, ['duration_ms', 'durationMs', 'elapsed_ms', 'latency_ms', 'response_time_ms']),
    proofStatus: stringAt(raw, ['proof_status', 'proofStatus', 'proof_state']),
    proofTx: stringAt(raw, ['proof_tx', 'proofTx', 'transaction_hash', 'tx_hash', 'proof_hash']),
    error: errorAt(raw),
  };
}

function normalizeChecks(raw: unknown): PolicyCheck[] {
  const candidate = firstValue(raw, ['checks', 'policy_checks', 'policyChecks']);
  if (!Array.isArray(candidate)) return [];

  return candidate.map((item, index) => {
    if (!isRecord(item)) {
      return {
        key: null,
        label: typeof item === 'string' ? item : `Check ${index + 1}`,
        passed: null,
        expected: null,
        observed: null,
      };
    }

    return {
      key: stringAt(item, ['key', 'id', 'name']),
      label: stringAt(item, ['label', 'name', 'check', 'title']) ?? `Check ${index + 1}`,
      passed: booleanAt(item, ['passed', 'ok', 'valid', 'success']),
      expected: stringAt(item, ['expected', 'expected_value']),
      observed: stringAt(item, ['observed', 'actual', 'observed_value']),
    };
  });
}

function normalizeProofEvidence(raw: unknown): ProofEvidence | null {
  if (!isRecord(raw)) return null;

  const status = stringAt(raw, ['status', 'proof_status', 'proofStatus', 'state']);
  const normalizedStatus = status?.replace(/[_-]/g, ' ').trim().toUpperCase() ?? null;
  const localVerified =
    booleanAt(raw, ['local_verified', 'localVerified', 'locally_verified', 'verified']) ??
    (normalizedStatus === 'LOCALLY VERIFIED' || normalizedStatus === 'LOCAL VERIFIED' ? true : null);
  const submitted =
    booleanAt(raw, ['submitted', 'is_submitted', 'submission_status']) ??
    (normalizedStatus === 'SUBMITTED' ? true : null);
  const finalized =
    booleanAt(raw, ['finalized', 'is_finalized', 'finality_status']) ??
    (normalizedStatus === 'FINALIZED' ? true : null);
  const signalsCandidate = firstValue(raw, ['public_signals', 'publicSignals']);
  const publicSignals = Array.isArray(signalsCandidate)
    ? signalsCandidate.map((signal) => (typeof signal === 'string' ? signal : JSON.stringify(signal)))
    : [];

  return {
    status,
    localVerified,
    submitted,
    finalized,
    transactionHash: stringAt(raw, ['transaction_hash', 'transactionHash', 'tx_hash', 'proof_tx', 'proofTx']),
    publicSignals,
    error: errorAt(raw),
  };
}

function normalizeInboundVerification(raw: unknown): InboundVerification | null {
  if (!isRecord(raw)) return null;
  const publicInputs = firstValue(raw, ['publicInputs', 'public_inputs']);
  return {
    verified: booleanAt(raw, ['verified', 'is_verified', 'verified_inbound']),
    finalized: booleanAt(raw, ['finalized', 'is_finalized']),
    vkHash: stringAt(raw, ['vkHash', 'vk_hash']),
    vkMatches: booleanAt(raw, ['vkMatches', 'vk_matches']),
    blockNumber: numberAt(raw, ['blockNumber', 'block_number']),
    blockHash: stringAt(raw, ['blockHash', 'block_hash']),
    extrinsicHash: stringAt(raw, ['extrinsicHash', 'extrinsic_hash']),
    publicInputsHash: stringAt(raw, ['publicInputsHash', 'public_inputs_hash']),
    publicInputCount:
      numberAt(raw, ['publicInputCount', 'public_input_count']) ??
      (Array.isArray(publicInputs) ? publicInputs.length : null),
    source: stringAt(raw, ['source']),
    error: errorAt(raw),
  };
}

function normalizeKurierEvidence(raw: unknown): KurierEvidence | null {
  if (!isRecord(raw)) return null;
  const status = stringAt(raw, ['status', 'kurierStatus', 'kurier_status']);
  return {
    status,
    jobId: stringAt(raw, ['jobId', 'job_id']),
    transactionHash: stringAt(raw, ['txHash', 'tx_hash', 'transactionHash', 'transaction_hash']),
    submittedAt: stringAt(raw, ['submittedAt', 'submitted_at']),
    finalizedAt: stringAt(raw, ['finalizedAt', 'finalized_at']),
    error: errorAt(raw),
  };
}

function normalizeAttempts(raw: unknown): ProofAttempt[] {
  const candidate = firstValue(raw, ['attempts', 'proof_attempts', 'proofAttempts', 'timeline', 'events']);
  if (!Array.isArray(candidate)) return [];

  return candidate.map((item, index) => {
    if (!isRecord(item)) {
      return {
        id: null,
        type: typeof item === 'string' ? item : `Event ${index + 1}`,
        status: null,
        occurredAt: null,
        detail: null,
        error: null,
      };
    }

    return {
      id: stringAt(item, ['id', 'attempt_id', 'attemptId']),
      type: stringAt(item, ['stage', 'type', 'attempt_type', 'attemptType', 'kind', 'event', 'name']) ?? `Event ${index + 1}`,
      status: stringAt(item, ['status', 'state']),
      occurredAt: stringAt(item, ['occurred_at', 'occurredAt', 'created_at', 'timestamp', 'at']),
      detail:
        stringAt(item, ['detail', 'message', 'description']) ??
        (isRecord(item.detail) ? JSON.stringify(item.detail) : null),
      error: errorAt(item),
    };
  });
}

export function normalizeTaskDetail(raw: unknown): TaskDetail {
  if (!isRecord(raw)) {
    return {
      ...normalizeTask(raw),
      issuedAt: null,
      deadlineAt: null,
      requestDigest: null,
      checks: [],
      proof: null,
      inboundVerification: null,
      kurier: null,
      attempts: [],
    };
  }

  const nestedTask = isRecord(raw.task) ? raw.task : {};
  const taskSource = { ...raw, ...nestedTask };
  const proofBundle = isRecord(raw.proof) ? raw.proof : null;
  const proofSource = proofBundle && isRecord(proofBundle.proof)
    ? { ...proofBundle, ...proofBundle.proof }
    : proofBundle;
  const normalizedProof = normalizeProofEvidence(proofSource);
  const kurier = normalizeKurierEvidence(firstValue(raw, ['kurier', 'kurier_evidence', 'kurierEvidence']));
  const normalizedKurierStatus = kurier?.status?.replace(/[_-]/g, ' ').trim().toUpperCase() ?? null;
  const proof = normalizedProof
    ? {
        ...normalizedProof,
        localVerified: normalizedProof.localVerified ?? true,
        submitted:
          normalizedProof.submitted ??
          (normalizedKurierStatus === 'SUBMITTED' || normalizedKurierStatus === 'FINALIZED' ? true : null),
        finalized:
          normalizedProof.finalized ??
          (normalizedKurierStatus === 'FINALIZED' ? true : null),
        transactionHash: normalizedProof.transactionHash ?? kurier?.transactionHash ?? null,
      }
    : null;

  return {
    ...normalizeTask(taskSource),
    issuedAt: stringAt(taskSource, ['issuedAt', 'issued_at']),
    deadlineAt: stringAt(taskSource, ['deadlineAt', 'deadline_at']),
    requestDigest: stringAt(taskSource, ['requestDigest', 'request_digest']),
    checks: normalizeChecks(taskSource),
    proof,
    inboundVerification: normalizeInboundVerification(
      firstValue(taskSource, ['inboundVerification', 'inbound_verification']),
    ),
    kurier,
    attempts: normalizeAttempts(taskSource),
  };
}

export function normalizeProofRecord(raw: unknown): ProofRecord {
  if (!isRecord(raw)) {
    return {
      id: null,
      taskId: null,
      decision: null,
      reasonCode: null,
      status: null,
      localVerified: null,
      submitted: null,
      finalized: null,
      inboundVerified: null,
      publicSignalCount: null,
      durationMs: null,
      transactionHash: null,
      createdAt: null,
      updatedAt: null,
      error: null,
    };
  }

  const nestedProof = isRecord(raw.proof) ? raw.proof : {};
  const source = { ...raw, ...nestedProof };
  const status = stringAt(source, ['kurierStatus', 'kurier_status', 'status', 'proof_status', 'proofStatus', 'state']);
  const normalizedStatus = status?.replace(/[_-]/g, ' ').trim().toUpperCase() ?? null;
  const locallyVerified = booleanAt(source, [
    'locallyVerified',
    'locally_verified',
    'localVerified',
    'local_verified',
    'verified',
  ]);
  const finalized = booleanAt(source, ['finalized', 'is_finalized']) ??
    (normalizedStatus === 'FINALIZED' ? true : null);
  const submitted = booleanAt(source, ['submitted', 'is_submitted']) ??
    (normalizedStatus === 'SUBMITTED' || normalizedStatus === 'FINALIZED' ? true : null);

  return {
    id: stringAt(source, ['id', 'proof_id', 'proofId']),
    taskId: stringAt(source, ['task_id', 'taskId']),
    decision: normalizeDecision(firstValue(source, ['decision', 'outcome'])),
    reasonCode: stringAt(source, ['reason_code', 'reasonCode', 'reason', 'failure_reason']),
    status,
    localVerified: locallyVerified ?? (normalizedStatus === 'LOCALLY VERIFIED' ? true : null),
    submitted,
    finalized,
    inboundVerified: booleanAt(source, ['inboundVerified', 'inbound_verified']),
    publicSignalCount: numberAt(source, ['publicSignalCount', 'public_signal_count']),
    durationMs: numberAt(source, ['duration_ms', 'durationMs', 'elapsed_ms']),
    transactionHash: stringAt(source, [
      'kurierTxHash',
      'kurier_tx_hash',
      'transaction_hash',
      'transactionHash',
      'tx_hash',
      'proof_tx',
      'proofTx',
    ]),
    createdAt: stringAt(source, ['created_at', 'createdAt', 'received_at', 'generated_at']),
    updatedAt: stringAt(source, ['updated_at', 'updatedAt', 'submitted_at', 'finalized_at']),
    error: errorAt(source),
  };
}

function firstNumber(
  roots: readonly unknown[],
  paths: readonly string[],
): number | null {
  for (const root of roots) {
    const value = numberAt(root, paths);
    if (value !== null) return value;
  }
  return null;
}

function normalizeReasonCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      return typeof entry[1] === 'number' && Number.isFinite(entry[1]);
    }),
  );
}

function normalizeSummary(raw: unknown): DashboardSummary {
  if (!isRecord(raw)) {
    return {
      generatedAt: null,
      serviceStatus: null,
      serviceDetail: null,
      decisions: { total: null, completed: null, approved: null, rejected: null, failed: null, pending: null },
      reasons: {},
      proofs: { total: null, localVerified: null, submitted: null, finalized: null, failed: null },
      latency: { averageMs: null, p95Ms: null, maximumMs: null },
      recentFailures: [],
      nextAction: null,
    };
  }

  const envelope = isRecord(raw.data) ? raw.data : raw;
  const serviceSource = isRecord(envelope.service)
    ? envelope.service
    : isRecord(envelope.health)
      ? envelope.health
      : envelope;
  const taskSource = isRecord(envelope.totals)
    ? envelope.totals
    : isRecord(envelope.task_counts)
      ? envelope.task_counts
      : isRecord(envelope.tasks)
        ? envelope.tasks
        : isRecord(envelope.metrics)
          ? envelope.metrics
          : envelope;
  const proofSource = isRecord(envelope.totals)
    ? envelope.totals
    : isRecord(envelope.proof_counts)
      ? envelope.proof_counts
      : isRecord(envelope.proofs)
        ? envelope.proofs
        : isRecord(envelope.metrics)
          ? envelope.metrics
          : envelope;
  const latencySource = isRecord(envelope.latencyMs)
    ? envelope.latencyMs
    : isRecord(envelope.latency)
      ? envelope.latency
      : isRecord(envelope.latency_ms)
        ? envelope.latency_ms
        : envelope;

  const decisions: DecisionCounts = {
    total: firstNumber([taskSource, envelope], ['tasks', 'total', 'total_tasks', 'task_count', 'count']),
    completed: firstNumber([taskSource, envelope], ['completed', 'completed_tasks', 'completed_count']),
    approved: firstNumber([taskSource, envelope], [
      'approved',
      'approve',
      'approvals',
      'approved_count',
      'approve_count',
    ]),
    rejected: firstNumber([taskSource, envelope], [
      'rejected',
      'reject',
      'rejections',
      'rejected_count',
      'reject_count',
    ]),
    failed: firstNumber([taskSource, envelope], ['failed', 'failures', 'failed_tasks', 'failure_count']),
    pending: firstNumber([taskSource, envelope], [
      'processing',
      'pending',
      'in_progress',
      'active',
      'pending_tasks',
    ]),
  };

  const proofs: ProofCounts = {
    total: firstNumber([proofSource, envelope], ['proofs', 'total', 'total_proofs', 'proof_count', 'count']),
    localVerified: firstNumber([proofSource, envelope], [
      'locallyVerifiedProofs',
      'locally_verified',
      'locally_verified_count',
      'localVerified',
      'local_verified',
      'verified',
    ]),
    submitted: firstNumber([proofSource, envelope], [
      'submittedKurierProofs',
      'submitted',
      'submission_count',
      'submitted_count',
    ]),
    finalized: firstNumber([proofSource, envelope], [
      'finalizedKurierProofs',
      'finalized',
      'finalized_count',
      'finalization_count',
    ]),
    failed: firstNumber([proofSource, envelope], ['failed', 'failures', 'failed_proofs', 'failure_count']),
  };

  const latency: LatencySummary = {
    averageMs: firstNumber([latencySource, envelope], [
      'average_ms',
      'averageMs',
      'avg_ms',
      'avgMs',
      'average',
      'avg',
      'mean_ms',
    ]),
    p95Ms: firstNumber([latencySource, envelope], ['p95_ms', 'p95Ms', 'p95', 'percentile_95_ms']),
    maximumMs: firstNumber([latencySource, envelope], ['maximum_ms', 'maximumMs', 'maximum', 'max', 'max_ms']),
  };

  const reasons = normalizeReasonCounts(
    firstValue(envelope, ['reasons', 'reason_counts', 'reasonCounts']),
  );

  const failureCandidate = firstValue(envelope, [
    'recent_failures',
    'recentFailures',
    'recent_failed_tasks',
    'failures',
  ]);
  const recentFailures = Array.isArray(failureCandidate)
    ? failureCandidate.map(normalizeTask)
    : [];

  const nextCandidate = firstValue(envelope, ['next_action', 'nextAction']);
  let nextAction: DashboardSummary['nextAction'] = null;
  if (typeof nextCandidate === 'string') {
    nextAction = { label: nextCandidate, detail: null };
  } else if (isRecord(nextCandidate)) {
    nextAction = {
      label: stringAt(nextCandidate, ['label', 'title', 'action', 'task']),
      detail: stringAt(nextCandidate, ['detail', 'description', 'reason']),
    };
  }

  return {
    generatedAt: stringAt(envelope, ['generated_at', 'generatedAt', 'snapshot_at', 'as_of', 'timestamp']),
    serviceStatus: stringAt(serviceSource, ['service_status', 'serviceStatus', 'status', 'state', 'readiness']),
    serviceDetail: stringAt(serviceSource, ['detail', 'message', 'description']),
    decisions,
    reasons,
    proofs,
    latency,
    recentFailures,
    nextAction,
  };
}

async function requestJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('The Veridun API could not be reached.', 0);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new ApiError(`The API returned an unreadable response (${response.status}).`, response.status);
      }
      throw new ApiError('The API returned a response that was not valid JSON.', response.status);
    }
  }

  if (!response.ok) {
    const detail = isRecord(body) ? stringAt(body, ['message', 'error', 'detail']) : null;
    throw new ApiError(detail ?? `The API request failed (${response.status}).`, response.status);
  }

  return body;
}

function listContainer(raw: unknown, fields: readonly string[]): unknown {
  if (!isRecord(raw)) return raw;
  const envelope = isRecord(raw.data) ? raw.data : raw;
  for (const field of fields) {
    const candidate = pathValue(envelope, field);
    if (Array.isArray(candidate)) return candidate;
  }
  if (Array.isArray(envelope)) return envelope;
  return envelope;
}

function normalizeList<T>(raw: unknown, fields: readonly string[], normalizeItem: (item: unknown) => T): ListResponse<T> {
  const root = isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
  const itemsCandidate = listContainer(raw, fields);
  const items = Array.isArray(itemsCandidate) ? itemsCandidate.map(normalizeItem) : [];

  return {
    items,
    total: numberAt(root, ['total', 'total_count', 'pagination.total', 'meta.total', 'meta.pagination.total']),
    limit: numberAt(root, ['limit', 'page_size', 'pageSize', 'pagination.limit', 'meta.limit']),
    offset: numberAt(root, ['offset', 'pagination.offset', 'meta.offset']),
  };
}

export async function getHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const raw = await requestJson('/health', signal);
  const root = isRecord(raw) ? raw : {};
  return {
    ok: booleanAt(root, ['ok']) ?? false,
    service: stringAt(root, ['service']) ?? 'veridun',
    database: stringAt(root, ['database']) ?? 'unknown',
    proofSubmission: stringAt(root, ['proofSubmission']) ?? 'unknown',
    timestamp: stringAt(root, ['timestamp']),
  };
}

export async function getDashboardSummary(signal?: AbortSignal): Promise<DashboardSummary> {
  const raw = await requestJson('/api/dashboard/summary', signal);
  return normalizeSummary(raw);
}

export async function getTasks(query: TaskQuery, signal?: AbortSignal): Promise<ListResponse<TaskRecord>> {
  const params = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.decision) params.set('decision', query.decision);
  if (query.reason_code) params.set('reason_code', query.reason_code);

  const raw = await requestJson(`/api/tasks?${params.toString()}`, signal);
  return normalizeList(raw, ['items', 'tasks', 'results', 'records'], normalizeTask);
}

export async function getTask(taskId: string, signal?: AbortSignal): Promise<TaskDetail> {
  const raw = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, signal);
  return normalizeTaskDetail(raw);
}

export async function getProofs(query: ProofQuery, signal?: AbortSignal): Promise<ListResponse<ProofRecord>> {
  const params = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  const raw = await requestJson(`/api/proofs?${params.toString()}`, signal);
  return normalizeList(raw, ['items', 'proofs', 'results', 'records'], normalizeProofRecord);
}
