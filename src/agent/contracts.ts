import type { Decision, GatekeeperTask } from '../shared/protocol.js';

export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

export interface ProofBundle {
  proof: Groth16Proof;
  publicSignals: string[];
}

export interface Prover {
  prove(
    task: GatekeeperTask,
    decision: Decision,
    requestDigest: string,
  ): Promise<ProofBundle>;
  verify(bundle: ProofBundle): Promise<boolean>;
}

export interface InboundProofResult {
  verified: boolean;
  finalized: boolean;
  vkHash: string | null;
  vkMatches: boolean;
  publicInputs: string[];
  publicInputsHash: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  extrinsicHash: string | null;
  source: 'zkverify' | 'trusted-payload';
  error?: string;
}

export interface InboundProofVerifier {
  readonly source: 'zkverify' | 'trusted-payload';
  verify(task: GatekeeperTask): Promise<InboundProofResult>;
}

export interface KurierJobResult {
  jobId: string;
  status: string;
  optimisticVerify?: string;
  txHash?: string;
  blockHash?: string;
  submittedAt?: string;
  finalizedAt?: string;
  raw?: unknown;
}

export interface KurierClient {
  readonly enabled: boolean;
  submitAndAwait(
    proof: ProofBundle,
    registeredVkHash: string,
    deadlineAt: number,
  ): Promise<KurierJobResult>;
}
