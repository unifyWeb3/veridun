import { describe, expect, it } from 'vitest';
import {
  extractPublicInputs,
  extractVkHash,
  hashPublicInputs,
} from '../src/agent/inbound-proof.js';

describe('zkVerify inbound proof evidence', () => {
  it('extracts a submitted VK hash and rejects a full verification key', () => {
    expect(
      extractVkHash({
        toHuman: () => ({ Hash: `0x${'11'.repeat(32)}` }),
      }),
    ).toBe(`0x${'11'.repeat(32)}`);

    expect(() =>
      extractVkHash({
        toHuman: () => ({ alpha1: ['1'] }),
      }),
    ).toThrow('full verification key');
  });

  it('normalizes public inputs into stable evidence', () => {
    const inputs = extractPublicInputs({
      toJSON: () => ['0x01', '0x02'],
    });
    expect(inputs).toEqual(['0x01', '0x02']);
    expect(hashPublicInputs(inputs)).toBe(hashPublicInputs(['0X01', '0X02']));
    expect(hashPublicInputs(inputs)).toHaveLength(64);
  });
});
