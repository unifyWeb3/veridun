import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { groth16 } from 'snarkjs';
import type { TaskIdEncoding } from '../config/env.js';
import type { Decision, GatekeeperTask } from '../shared/protocol.js';
import type { Groth16Proof, ProofBundle, Prover } from './contracts.js';
import { deriveSalt, encodeTaskId, hexToField, reduceField } from './task-id.js';

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
    const inputs = this.#circuitInputs(task, decision, requestDigest);
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

  #circuitInputs(
    task: GatekeeperTask,
    decision: Decision,
    requestDigest: string,
  ): Record<string, string> {
    const input = task.input;
    return {
      registeredVkHash: hexToField(input.registered_vk).toString(),
      proofVkHash: hexToField(input.proof_vk).toString(),
      minimum: BigInt(input.minimum).toString(),
      publicBalance: BigInt(input.public_balance).toString(),
      expiryBlock: BigInt(input.expiry_block).toString(),
      currentBlock: BigInt(input.current_block).toString(),
      recipient: hexToField(input.recipient).toString(),
      conditionRecipient: hexToField(input.condition_recipient).toString(),
      amount: BigInt(input.amount).toString(),
      maxTransfer: BigInt(input.max_transfer).toString(),
      decision: decision === 'APPROVE' ? '1' : '0',
      taskId: encodeTaskId(task.task_id, this.#taskIdEncoding).toString(),
      salt: deriveSalt(task.task_id, requestDigest).toString(),
    };
  }

  #assertPublicSignals(bundle: ProofBundle, inputs: Record<string, string>): void {
    const expected = [
      null,
      inputs.registeredVkHash,
      inputs.proofVkHash,
      inputs.minimum,
      inputs.publicBalance,
      inputs.expiryBlock,
      inputs.currentBlock,
      inputs.recipient,
      inputs.conditionRecipient,
      inputs.amount,
      inputs.maxTransfer,
      inputs.decision,
      inputs.taskId,
    ];

    if (bundle.publicSignals.length !== 13) {
      throw new Error(`expected 13 public signals, received ${bundle.publicSignals.length}`);
    }
    for (let index = 1; index < expected.length; index += 1) {
      const wanted = reduceField(BigInt(expected[index]!));
      const actual = reduceField(BigInt(bundle.publicSignals[index]!));
      if (wanted !== actual) {
        throw new Error(`public signal ${index} does not match the circuit input`);
      }
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
