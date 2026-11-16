import type { AppDependencies } from '../src/api/app.js';
import type {
  Groth16Proof,
  InboundProofResult,
  ProofBundle,
} from '../src/agent/contracts.js';
import type { AppConfig } from '../src/config/env.js';
import type {
  GatekeeperTask,
  Preflight,
} from '../src/shared/protocol.js';

export const HMAC_SECRET = 'test-secret-with-sufficient-entropy';

export const REGISTERED_VK =
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    hmacSecret: HMAC_SECRET,
    databaseUrl: 'postgres://unused/test',
    databasePoolMax: 2,
    autoMigrate: false,
    kurierApiKey: '',
    kurierApiBaseUrl: 'https://api.kurier.xyz/api/v1',
    circuitDir: 'artifacts/circuit',
    taskIdEncoding: 'auto',
    inboundProofVerifier: 'zkverify',
    subscanBaseUrl: 'https://zkverify.subscan.io',
    zkverifyRpcUrl: 'https://zkverify-rpc.zkverify.io',
    inboundProofTimeoutMs: 5_000,
    port: 3000,
    host: '127.0.0.1',
    logLevel: 'silent',
    dashboardEnabled: false,
    proofSubmitEnabled: false,
    kurierPollIntervalMs: 250,
    kurierFinalityTimeoutMs: 5_000,
    requestBudgetMs: 55_000,
    taskClockSkewMs: 5_000,
    taskMaxWindowMs: 65_000,
    maxRequestBytes: 1_048_576,
    ...overrides,
  };
}

export function testTask(overrides: Partial<GatekeeperTask> = {}): GatekeeperTask {
  const now = Date.now();
  return {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: 'gk_test_0001',
    mode: 'practice',
    issued_at: new Date(now).toISOString(),
    deadline_at: new Date(now + 60_000).toISOString(),
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
      proof_tx: `0x${'11'.repeat(32)}`,
    },
    ...overrides,
  };
}

export function testPreflight(): Preflight {
  return {
    type: 'agent-games.preflight.v1',
    agent_id: 'agt_test',
    issued_at: new Date().toISOString(),
    nonce: 'nonce-test',
  };
}

export const TEST_PROOF: Groth16Proof = {
  pi_a: ['1', '2', '1'],
  pi_b: [
    ['3', '4'],
    ['5', '6'],
    ['7', '8'],
  ],
  pi_c: ['9', '10', '1'],
  protocol: 'groth16',
  curve: 'bn128',
};

export const TEST_PROOF_BUNDLE: ProofBundle = {
  proof: TEST_PROOF,
  publicSignals: Array.from({ length: 13 }, (_, index) => String(index + 1)),
};

export function verifiedInbound(
  overrides: Partial<InboundProofResult> = {},
): InboundProofResult {
  return {
    verified: true,
    finalized: true,
    vkHash: REGISTERED_VK,
    vkMatches: true,
    publicInputs: ['1', '2', '3'],
    publicInputsHash: 'a'.repeat(64),
    blockNumber: 5_998_973,
    blockHash: `0x${'22'.repeat(32)}`,
    extrinsicHash: `0x${'11'.repeat(32)}`,
    source: 'zkverify',
    ...overrides,
  };
}

export function testDependencies(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  const repository = {
    ping: async () => undefined,
    claimTask: async (task: GatekeeperTask) => ({
      kind: 'claimed' as const,
      taskId: task.task_id,
      proofAlreadySeen: false,
    }),
    getStoredResponse: async () => null,
    recordAttempt: async () => undefined,
    completeTask: async () => undefined,
    failTask: async () => undefined,
    listTasks: async () => [],
    getTask: async () => null,
    listProofs: async () => [],
    dashboardSummary: async () => ({
      generatedAt: new Date().toISOString(),
      service: { status: 'ready' as const, detail: 'test' },
      totals: {
        tasks: 0,
        completed: 0,
        processing: 0,
        failed: 0,
        approvals: 0,
        rejections: 0,
        proofs: 0,
        locallyVerifiedProofs: 0,
        submittedKurierProofs: 0,
        finalizedKurierProofs: 0,
      },
      decisions: {},
      reasons: {},
      latencyMs: { average: null, p95: null, maximum: null },
      recentFailures: [],
    }),
  };

  return {
    config: testConfig(),
    repository,
    prover: {
      prove: async () => TEST_PROOF_BUNDLE,
      verify: async () => true,
    },
    inboundVerifier: {
      source: 'zkverify',
      verify: async () => verifiedInbound(),
    },
    kurier: {
      enabled: false,
      submitAndAwait: async () => {
        throw new Error('Kurier should not be called in this test');
      },
    },
    ...overrides,
  };
}
