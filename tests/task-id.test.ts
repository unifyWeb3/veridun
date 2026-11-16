import { describe, expect, it } from 'vitest';
import {
  BN128_PRIME,
  encodeTaskId,
  hexToField,
  reduceField,
} from '../src/agent/task-id.js';

describe('task ID field encoding', () => {
  it('treats numeric task IDs directly in auto mode', () => {
    expect(encodeTaskId('20261115001', 'auto')).toBe(20_261_115_001n);
  });

  it('treats a UUID suffix as a 128-bit hexadecimal value in auto mode', () => {
    const suffix = '00112233-4455-6677-8899-aabbccddeeff';
    expect(encodeTaskId(`gk_${suffix}`, 'auto')).toBe(
      BigInt(`0x${suffix.replaceAll('-', '')}`),
    );
  });

  it('uses SHA-256 when explicitly configured', () => {
    const encoded = encodeTaskId('gk_24_9d1', 'sha256');
    expect(encoded).toBeLessThan(BN128_PRIME);
    expect(encoded).toBe(reduceField(encoded));
  });

  it('reduces hexadecimal values into the BN128 field', () => {
    expect(hexToField(`0x${'ff'.repeat(32)}`)).toBe(
      reduceField(BigInt(`0x${'ff'.repeat(32)}`)),
    );
  });
});
