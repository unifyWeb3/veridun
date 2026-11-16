import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CircuitProver } from '../src/agent/prover.js';
import { testTask } from './fixtures.js';

const prover = new CircuitProver(
  path.resolve('artifacts/circuit'),
  'auto',
);

describe('official gatekeeper circuit prover', () => {
  it(
    'generates and locally verifies an approval proof with 13 public signals',
    async () => {
      const bundle = await prover.prove(
        testTask(),
        'APPROVE',
        'a'.repeat(64),
      );
      expect(bundle.publicSignals).toHaveLength(13);
      expect(bundle.publicSignals[11]).toBe('1');
      expect(await prover.verify(bundle)).toBe(true);
    },
    120_000,
  );

  it(
    'generates and locally verifies a circuit-visible rejection proof',
    async () => {
      const task = testTask();
      task.input.public_balance = '999';
      const bundle = await prover.prove(
        task,
        'REJECT',
        'b'.repeat(64),
      );
      expect(bundle.publicSignals).toHaveLength(13);
      expect(bundle.publicSignals[11]).toBe('0');
      expect(await prover.verify(bundle)).toBe(true);
    },
    120_000,
  );

  it(
    'refuses to generate a false approval witness',
    async () => {
      const task = testTask();
      task.input.amount = '1001';
      await expect(
        prover.prove(task, 'APPROVE', 'c'.repeat(64)),
      ).rejects.toThrow();
    },
    120_000,
  );

  it(
    'cannot prove replay as a circuit rejection when all visible checks pass',
    async () => {
      await expect(
        prover.prove(testTask(), 'REJECT', 'd'.repeat(64)),
      ).rejects.toThrow();
    },
    120_000,
  );
});
