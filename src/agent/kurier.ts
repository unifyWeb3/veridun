import type { ProofBundle, KurierClient, KurierJobResult } from './contracts.js';

export interface KurierConfig {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  finalityTimeoutMs: number;
}

interface KurierSubmitResponse {
  jobId?: string;
  optimisticVerify?: string;
}

interface KurierStatusResponse {
  jobId?: string;
  status?: string;
  statusId?: number;
  txHash?: string;
  blockHash?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KurierProofClient implements KurierClient {
  readonly #config: KurierConfig;

  constructor(config: KurierConfig) {
    this.#config = config;
  }

  get enabled(): boolean {
    return this.#config.apiKey.trim().length > 0;
  }

  async submitAndAwait(
    proof: ProofBundle,
    registeredVkHash: string,
    deadlineAt: number,
  ): Promise<KurierJobResult> {
    if (!this.enabled) {
      throw new Error('Kurier submission is disabled because KURIER_API_KEY is not configured');
    }

    const submitResponse = await fetch(
      `${this.#config.baseUrl}/submit-proof/${encodeURIComponent(this.#config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proofType: 'groth16',
          vkRegistered: true,
          proofOptions: { library: 'snarkjs', curve: 'bn128' },
          proofData: {
            proof: proof.proof,
            publicSignals: proof.publicSignals,
            vk: registeredVkHash,
          },
        }),
        signal: AbortSignal.timeout(Math.max(1_000, deadlineAt - Date.now())),
      },
    );
    if (!submitResponse.ok) {
      throw new Error(`Kurier proof submission returned HTTP ${submitResponse.status}`);
    }
    const submitted = (await submitResponse.json()) as KurierSubmitResponse;
    if (!submitted.jobId) throw new Error('Kurier did not return a jobId');
    if (submitted.optimisticVerify && submitted.optimisticVerify !== 'success') {
      throw new Error(`Kurier optimistic verification returned ${submitted.optimisticVerify}`);
    }

    let lastStatus: KurierStatusResponse = {
      jobId: submitted.jobId,
      status: 'Submitted',
    };
    while (Date.now() < deadlineAt) {
      const remaining = deadlineAt - Date.now();
      const waitMs = Math.min(this.#config.pollIntervalMs, Math.max(0, remaining));
      if (waitMs > 0) await sleep(waitMs);
      if (Date.now() >= deadlineAt) break;

      const statusResponse = await fetch(
        `${this.#config.baseUrl}/job-status/${encodeURIComponent(this.#config.apiKey)}/${encodeURIComponent(submitted.jobId)}`,
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, deadlineAt - Date.now()))),
        },
      );
      if (!statusResponse.ok) {
        throw new Error(`Kurier status lookup returned HTTP ${statusResponse.status}`);
      }
      lastStatus = (await statusResponse.json()) as KurierStatusResponse;
      if (lastStatus.status === 'Finalized') break;
      if (lastStatus.status === 'Failed') {
        throw new Error('Kurier reported that proof processing failed');
      }
    }

    if (lastStatus.status !== 'Finalized') {
      throw new Error(`Kurier proof did not finalize before the response budget (${lastStatus.status ?? 'Unknown'})`);
    }

    return {
      jobId: submitted.jobId,
      status: lastStatus.status ?? 'Finalized',
      optimisticVerify: submitted.optimisticVerify,
      txHash: lastStatus.txHash,
      blockHash: lastStatus.blockHash,
      submittedAt: lastStatus.createdAt,
      finalizedAt: lastStatus.updatedAt,
      raw: lastStatus,
    };
  }
}
