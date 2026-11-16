import type { TaskIdEncoding } from '../config/env.js';
import type { Decision, GatekeeperTask } from '../shared/protocol.js';
import { deriveSalt, encodeTaskId, hexToField, reduceField } from './task-id.js';

/**
 * The official gatekeeper circuit takes twelve public inputs plus one private
 * salt. The mapping lives in its own module so the prover and any independent
 * receipt verifier derive the same witness inputs from the task envelope.
 */
export function buildCircuitInputs(
  task: GatekeeperTask,
  decision: Decision,
  requestDigest: string,
  taskIdEncoding: TaskIdEncoding,
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
    taskId: encodeTaskId(task.task_id, taskIdEncoding).toString(),
    salt: deriveSalt(task.task_id, requestDigest).toString(),
  };
}

/**
 * The expected public-signal order of the official circuit. Index 0 is the
 * commitment; the remaining twelve map to the public inputs in order.
 */
export function expectedPublicSignals(
  inputs: Record<string, string>,
): (string | null)[] {
  return [
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
}

/**
 * Confirms that the public signals returned by the prover match the inputs
 * derived from the task envelope.
 */
export function publicSignalsMatchInputs(
  publicSignals: string[],
  inputs: Record<string, string>,
): { ok: boolean; mismatched: number[] } {
  const expected = expectedPublicSignals(inputs);
  const mismatched: number[] = [];
  if (publicSignals.length !== expected.length) {
    return { ok: false, mismatched: [] };
  }
  for (let index = 1; index < expected.length; index += 1) {
    const wanted = reduceField(BigInt(expected[index]!));
    const actual = reduceField(BigInt(publicSignals[index]!));
    if (wanted !== actual) mismatched.push(index);
  }
  return { ok: mismatched.length === 0, mismatched };
}
