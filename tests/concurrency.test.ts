import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBenchmark } from '../scripts/lib/benchmark-harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Integration test for the delivery guarantees the platform depends on.
 *
 * It runs the real application over real HTTP against a real PostgreSQL
 * server, with the official circuit artifacts, and checks that concurrent
 * deliveries of one task ID collapse into one stored response that every
 * caller receives byte for byte.
 */
describe(
  'concurrent delivery against PostgreSQL',
  () => {
    it(
      'stores one response and replays it to every concurrent caller',
      async () => {
        const result = await runBenchmark({
          concurrency: 4,
          samples: 1,
          circuitDir: path.join(ROOT, 'artifacts/circuit'),
          hmacSecret: 'concurrency-test-secret',
        });

        const failed = result.assertions.filter((assertion) => !assertion.ok);
        expect(failed.map((assertion) => assertion.name)).toEqual([]);

        expect(result.scenarios.concurrentDelivery.storedResponses).toBe(1);
        expect(result.scenarios.concurrentDelivery.proofGenerations).toBe(1);
        expect(result.scenarios.concurrentDelivery.identicalResponseBodies).toBe(true);
        expect(result.scenarios.concurrentDelivery.identicalSignatures).toBe(true);
        expect(result.scenarios.concurrentDelivery.retryReplayedStoredBytes).toBe(true);
        expect(result.scenarios.concurrentDelivery.proofGenerationsAfterRetry).toBe(1);
      },
      120_000,
    );

    it(
      'rejects a reused proof reference without a proof and keeps the response inside the budget',
      async () => {
        const result = await runBenchmark({
          concurrency: 2,
          samples: 1,
          circuitDir: path.join(ROOT, 'artifacts/circuit'),
          hmacSecret: 'concurrency-test-secret',
        });

        expect(result.scenarios.replayDetection).toEqual({
          decision: 'REJECT',
          reasonCode: 'PROOF_REUSED',
          carriedProof: false,
        });
        expect(result.scenarios.storedProofVerification.verified).toBe(true);
        expect(result.scenarios.storedProofVerification.publicSignalCount).toBe(13);
        expect(result.scenarios.sequentialLatency.maxMs).toBeLessThanOrEqual(
          result.budget.internalBudgetMs,
        );
      },
      120_000,
    );
  },
  180_000,
);
