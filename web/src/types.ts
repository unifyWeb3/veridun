export type Decision = 'APPROVE' | 'REJECT';

export interface TaskRecord {
  id: string;
  decision: Decision | null;
  reasonCode: string | null;
  status: string | null;
  mode: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  proofStatus: string | null;
  proofTx: string | null;
  error: string | null;
}

export interface PolicyCheck {
  key: string | null;
  label: string;
  passed: boolean | null;
  expected: string | null;
  observed: string | null;
}

export interface ProofEvidence {
  status: string | null;
  localVerified: boolean | null;
  submitted: boolean | null;
  finalized: boolean | null;
  transactionHash: string | null;
  publicSignals: string[];
  error: string | null;
}

export interface ProofAttempt {
  id: string | null;
  type: string;
  status: string | null;
  occurredAt: string | null;
  detail: string | null;
  error: string | null;
}

export interface InboundVerification {
  verified: boolean | null;
  finalized: boolean | null;
  vkHash: string | null;
  vkMatches: boolean | null;
  blockNumber: number | null;
  blockHash: string | null;
  extrinsicHash: string | null;
  publicInputsHash: string | null;
  publicInputCount: number | null;
  source: string | null;
  error: string | null;
}

export interface KurierEvidence {
  status: string | null;
  jobId: string | null;
  transactionHash: string | null;
  submittedAt: string | null;
  finalizedAt: string | null;
  error: string | null;
}

export interface TaskDetail extends TaskRecord {
  issuedAt: string | null;
  deadlineAt: string | null;
  requestDigest: string | null;
  checks: PolicyCheck[];
  proof: ProofEvidence | null;
  inboundVerification: InboundVerification | null;
  kurier: KurierEvidence | null;
  attempts: ProofAttempt[];
}

export interface TaskReceipt {
  taskId: string;
  mode: string;
  state: string;
  decision: Decision | null;
  reasonCode: string | null;
  durationMs: number | null;
  requestDigest: string | null;
  responseBody: string | null;
  responseSignature: string | null;
  responseSignatureAlgorithm: string | null;
  proofScheme: string | null;
  verificationKeySource: string | null;
  reproduce: string | null;
  counterfactual: {
    decision: Decision | null;
    note: string | null;
    wouldHaveApprovedIf: string | null;
    failingCheckLabel: string | null;
    amount: string | null;
    recipient: string | null;
  } | null;
}

export interface ProofRecord {
  id: string | null;
  taskId: string | null;
  decision: Decision | null;
  reasonCode: string | null;
  status: string | null;
  localVerified: boolean | null;
  submitted: boolean | null;
  finalized: boolean | null;
  inboundVerified: boolean | null;
  publicSignalCount: number | null;
  durationMs: number | null;
  transactionHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface DecisionCounts {
  total: number | null;
  completed: number | null;
  approved: number | null;
  rejected: number | null;
  failed: number | null;
  pending: number | null;
}

export interface ProofCounts {
  total: number | null;
  localVerified: number | null;
  submitted: number | null;
  finalized: number | null;
  failed: number | null;
}

export interface LatencySummary {
  averageMs: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  database: string;
  proofSubmission: string;
  timestamp: string | null;
}

export interface DashboardSummary {
  generatedAt: string | null;
  serviceStatus: string | null;
  serviceDetail: string | null;
  decisions: DecisionCounts;
  reasons: Record<string, number>;
  proofs: ProofCounts;
  latency: LatencySummary;
  recentFailures: TaskRecord[];
  nextAction: { label: string | null; detail: string | null } | null;
}

export interface ListResponse<T> {
  items: T[];
  total: number | null;
  limit: number | null;
  offset: number | null;
}

export interface TaskQuery {
  limit: number;
  offset: number;
  decision?: Decision | '';
  reason_code?: string;
}

export interface ProofQuery {
  limit: number;
  offset: number;
}
