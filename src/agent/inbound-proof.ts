import { createHash } from 'node:crypto';
import { ApiPromise, HttpProvider } from '@polkadot/api';
import type { GatekeeperTask } from '../shared/protocol.js';
import type {
  InboundProofResult,
  InboundProofVerifier,
} from './contracts.js';

export interface ZkVerifyInboundVerifierConfig {
  rpcUrl: string;
  subscanBaseUrl: string;
  timeoutMs: number;
}

interface SubscanExtrinsicData {
  block_hash?: string;
  block_num?: number;
  extrinsic_index?: string;
  success?: boolean;
  finalized?: boolean;
  error?: string | null;
}

interface ExtrinsicLocation {
  blockHash: string;
  blockNumber: number;
  extrinsicIndex: number;
}

function normalizeHex(value: string): string {
  return value.trim().toLowerCase();
}

export function hashPublicInputs(publicInputs: string[]): string {
  return createHash('sha256')
    .update(publicInputs.map((value) => value.trim().toLowerCase()).join('\n'))
    .digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

export class TrustedPayloadProofVerifier implements InboundProofVerifier {
  readonly source = 'trusted-payload' as const;

  async verify(task: GatekeeperTask): Promise<InboundProofResult> {
    return {
      verified: true,
      finalized: true,
      vkHash: task.input.proof_vk,
      vkMatches: true,
      publicInputs: [],
      publicInputsHash: null,
      blockNumber: null,
      blockHash: null,
      extrinsicHash: task.input.proof_tx,
      source: 'trusted-payload',
    };
  }
}

export class ZkVerifyInboundProofVerifier implements InboundProofVerifier {
  readonly source = 'zkverify' as const;
  readonly #config: ZkVerifyInboundVerifierConfig;
  #api: Promise<ApiPromise> | null = null;

  constructor(config: ZkVerifyInboundVerifierConfig) {
    this.#config = config;
  }

  async verify(task: GatekeeperTask): Promise<InboundProofResult> {
    const proofTx = normalizeHex(task.input.proof_tx);
    try {
      if (!/^0x[0-9a-f]{64}$/.test(proofTx)) {
        throw new Error('proof_tx is not a 32-byte zkVerify extrinsic hash');
      }

      const location = await this.#resolveExtrinsicLocation(proofTx);
      const api = await withTimeout(
        this.#getApi(),
        this.#config.timeoutMs,
        'zkVerify RPC connection',
      );
      const block = await withTimeout(
        api.rpc.chain.getBlock(location.blockHash),
        this.#config.timeoutMs,
        'zkVerify block lookup',
      );
      const extrinsic = block.block.extrinsics[location.extrinsicIndex];
      if (!extrinsic) {
        throw new Error('zkVerify block does not contain the referenced extrinsic');
      }

      const extrinsicHash = extrinsic.hash.toHex().toLowerCase();
      if (extrinsicHash !== proofTx) {
        throw new Error('decoded zkVerify extrinsic hash does not match proof_tx');
      }

      const method = extrinsic.method;
      if (
        method.section.toLowerCase() !== 'settlementgroth16pallet' ||
        method.method.toLowerCase() !== 'submitproof'
      ) {
        throw new Error('proof_tx does not reference a Groth16 submitProof call');
      }

      const submittedProof = method.args[1]?.toJSON() as
        | { curve?: unknown }
        | undefined;
      if (
        !submittedProof ||
        typeof submittedProof !== 'object' ||
        String(submittedProof.curve).toLowerCase() !== 'bn254'
      ) {
        throw new Error('referenced proof does not use the expected Bn254 curve');
      }

      const [blockHeader, finalizedHead, events] = await Promise.all([
        withTimeout(
          api.rpc.chain.getHeader(location.blockHash),
          this.#config.timeoutMs,
          'zkVerify block header lookup',
        ),
        withTimeout(
          api.rpc.chain.getFinalizedHead(),
          this.#config.timeoutMs,
          'zkVerify finalized head lookup',
        ),
        withTimeout(
          api.query.system.events.at(location.blockHash),
          this.#config.timeoutMs,
          'zkVerify event lookup',
        ),
      ]);
      const finalizedHeader = await withTimeout(
        api.rpc.chain.getHeader(finalizedHead),
        this.#config.timeoutMs,
        'zkVerify finalized header lookup',
      );

      const blockNumber = BigInt(blockHeader.number.toString());
      const finalizedNumber = BigInt(finalizedHeader.number.toString());
      const finalized = blockNumber <= finalizedNumber;
      const proofVerified = (events as unknown as ReadonlyArray<{
        event?: { section?: string; method?: string };
        section?: string;
        method?: string;
      }>).some((record) => {
        const section = record.event?.section ?? record.section ?? '';
        const method = record.event?.method ?? record.method ?? '';
        return (
          section.toLowerCase() === 'settlementgroth16pallet' &&
          method.toLowerCase() === 'proofverified'
        );
      });
      if (!proofVerified) {
        throw new Error('referenced zkVerify extrinsic has no ProofVerified event');
      }

      const vkHash = extractVkHash(method.args[0]);
      const vkMatches = normalizeHex(vkHash) === normalizeHex(task.input.proof_vk);
      const publicInputs = extractPublicInputs(method.args[2]);
      if (publicInputs.length === 0) {
        throw new Error('referenced proof did not expose public-input evidence');
      }

      return {
        verified: finalized && vkMatches,
        finalized,
        vkHash,
        vkMatches,
        publicInputs,
        publicInputsHash: hashPublicInputs(publicInputs),
        blockNumber: Number(blockNumber),
        blockHash: location.blockHash,
        extrinsicHash,
        source: 'zkverify',
      };
    } catch (error) {
      return {
        verified: false,
        finalized: false,
        vkHash: null,
        vkMatches: false,
        publicInputs: [],
        publicInputsHash: null,
        blockNumber: null,
        blockHash: null,
        extrinsicHash: proofTx,
        source: 'zkverify',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async close(): Promise<void> {
    if (!this.#api) return;
    const api = await this.#api;
    await api.disconnect();
    this.#api = null;
  }

  #getApi(): Promise<ApiPromise> {
    if (!this.#api) {
      const provider = new HttpProvider(this.#config.rpcUrl, {
        'User-Agent': 'Mozilla/5.0 (compatible; Veridun/0.1; +https://agentgames.zkverify.io)',
      });
      this.#api = this.#connectWithRetry(provider);
    }
    return this.#api;
  }

  async #connectWithRetry(provider: HttpProvider): Promise<ApiPromise> {
    let lastError: unknown = new Error('zkVerify RPC connection failed');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await ApiPromise.create({ provider, noInitWarn: true });
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(250 * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async #resolveExtrinsicLocation(proofTx: string): Promise<ExtrinsicLocation> {
    const url = `${this.#config.subscanBaseUrl.replace(/\/$/, '')}/extrinsic/${proofTx}`;
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Veridun/0.1 (+zkVerify Agent Games)',
      },
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Subscan extrinsic lookup returned HTTP ${response.status}`);
    }
    const html = await response.text();
    const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error('Subscan extrinsic page did not contain indexed chain data');
    const parsed = JSON.parse(match[1]) as {
      props?: { pageProps?: { data?: SubscanExtrinsicData } };
    };
    const data = parsed.props?.pageProps?.data;
    if (!data?.block_hash || !data.block_num || !data.extrinsic_index) {
      throw new Error(data?.error || 'Subscan did not index the referenced extrinsic');
    }
    if (data.success === false) {
      throw new Error('referenced zkVerify extrinsic was not successful');
    }
    const extrinsicIndex = Number(data.extrinsic_index.split('-').at(-1));
    if (!Number.isInteger(extrinsicIndex) || extrinsicIndex < 0) {
      throw new Error('Subscan returned an invalid extrinsic index');
    }
    return {
      blockHash: data.block_hash,
      blockNumber: data.block_num,
      extrinsicIndex,
    };
  }

}

export function extractVkHash(argument: { toHuman: () => unknown }): string {
  const human = argument.toHuman();
  if (!human || typeof human !== 'object' || !('Hash' in human)) {
    throw new Error('referenced proof submitted a full verification key instead of a VK hash');
  }
  const hash = (human as { Hash: unknown }).Hash;
  if (typeof hash !== 'string') throw new Error('zkVerify proof has an invalid VK hash');
  return hash;
}

export function extractPublicInputs(argument: { toJSON: () => unknown }): string[] {
  const value = argument.toJSON();
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
}
