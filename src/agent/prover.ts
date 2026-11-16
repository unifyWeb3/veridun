import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { groth16 } from 'snarkjs';
import type { TaskIdEncoding } from '../config/env.js';
import type { Decision, GatekeeperTask } from '../shared/protocol.js';
import type { Groth16Proof, ProofBundle, Prover } from './contracts.js';
import { buildCircuitInputs, publicSignalsMatchInputs } from './circuit-inputs.js';

interface VerificationKey {
  protocol: string;
  curve: string;
  nPublic: number;
  IC: string[][];
  [key: string]: unknown;
}

export class CircuitProver implements Prover {
  readonly #circuitDir: string;
  readonly #taskIdEncoding: TaskIdEncoding;
  #verificationKey: VerificationKey | null = null;

  constructor(circuitDir: string, taskIdEncoding: TaskIdEncoding) {
    this.#circuitDir = path.resolve(circuitDir);
    this.#taskIdEncoding = taskIdEncoding;
  }

  async prove(
    task: GatekeeperTask,
    decision: Decision,
    requestDigest: string,
  ): Promise<ProofBundle> {
    const inputs = buildCircuitInputs(task, decision, requestDigest, this.#taskIdEncoding);
    const result = await groth16.fullProve(
      inputs,
      path.join(this.#circuitDir, 'gatekeeper.wasm'),
      path.join(this.#circuitDir, 'gatekeeper_final.zkey'),
    );

    const proof = result.proof as unknown as Groth16Proof;
    const publicSignals = result.publicSignals.map(String);
    const bundle: ProofBundle = { proof, publicSignals };

    if (!(await this.verify(bundle))) {
      throw new Error('official circuit proof failed local Groth16 verification');
    }
    this.#assertPublicSignals(bundle, inputs);

    return bundle;
  }

  async verify(bundle: ProofBundle): Promise<boolean> {
    const verificationKey = await this.#loadVerificationKey();
    try {
      return await groth16.verify(verificationKey, bundle.publicSignals, bundle.proof);
    } catch {
      return false;
    }
  }

  #assertPublicSignals(bundle: ProofBundle, inputs: Record<string, string>): void {
    const { ok, mismatched } = publicSignalsMatchInputs(bundle.publicSignals, inputs);
    if (!ok) {
      throw new Error(
        mismatched.length
          ? `public signal ${mismatched[0]} does not match the circuit input`
          : `expected 13 public signals, received ${bundle.publicSignals.length}`,
      );
    }
  }

  async #loadVerificationKey(): Promise<VerificationKey> {
    if (this.#verificationKey) return this.#verificationKey;
    const raw = await readFile(path.join(this.#circuitDir, 'gatekeeper_vkey.json'), 'utf8');
    const parsed = JSON.parse(raw) as VerificationKey;
    if (parsed.protocol !== 'groth16' || parsed.curve !== 'bn128' || parsed.nPublic !== 13) {
      throw new Error('official gatekeeper verification key has an unexpected format');
    }
    this.#verificationKey = parsed;
    return parsed;
  }
}
