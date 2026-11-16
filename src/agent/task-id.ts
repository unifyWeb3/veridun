import { createHash } from 'node:crypto';
import { keccak256 } from 'js-sha3';
import type { TaskIdEncoding } from '../config/env.js';

export const BN128_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const UUID_SUFFIX = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function reduceField(value: bigint): bigint {
  return ((value % BN128_PRIME) + BN128_PRIME) % BN128_PRIME;
}

export function hexToField(value: string): bigint {
  return reduceField(BigInt(value));
}

export function encodeTaskId(taskId: string, strategy: TaskIdEncoding): bigint {
  if (strategy === 'auto' && /^\d+$/.test(taskId)) {
    return reduceField(BigInt(taskId));
  }

  if (strategy === 'hex-suffix' || strategy === 'auto') {
    const match = UUID_SUFFIX.exec(taskId);
    if (match) return reduceField(BigInt(`0x${match[1].replaceAll('-', '')}`));
    if (strategy === 'hex-suffix') {
      throw new Error('task_id does not contain the expected UUID suffix');
    }
  }

  if (strategy === 'keccak256') {
    return reduceField(BigInt(`0x${keccak256(taskId)}`));
  }

  return reduceField(BigInt(`0x${createHash('sha256').update(taskId).digest('hex')}`));
}

export function deriveSalt(taskId: string, requestDigest: string): bigint {
  return reduceField(
    BigInt(
      `0x${createHash('sha256')
        .update(`veridun:salt:${taskId}:${requestDigest}`)
        .digest('hex')}`,
    ),
  );
}
