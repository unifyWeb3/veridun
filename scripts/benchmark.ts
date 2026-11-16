import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gracefulExit } from 'exit-hook';
import { runBenchmark } from './lib/benchmark-harness.js';

/**
 * Runs the concurrency and latency benchmark and records the result as a
 * machine-generated artifact.
 *
 * The artifact is the source of the numbers quoted in `docs/CLAIMS.md`; it is
 * never transcribed by hand.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs/benchmarks/concurrency-and-latency.json');

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

const concurrency = argument('concurrency', 8);
const samples = argument('samples', 5);
const hmacSecret =
  process.env.BENCHMARK_HMAC_SECRET ?? 'veridun-benchmark-local-secret';

const result = await runBenchmark({
  concurrency,
  samples,
  circuitDir: process.env.CIRCUIT_DIR ?? path.join(ROOT, 'artifacts/circuit'),
  hmacSecret,
  databaseUrl: process.env.BENCHMARK_DATABASE_URL,
});

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const relative = path.relative(ROOT, OUTPUT);
console.log(`Benchmark artifact written to ${relative}`);
console.log(
  `database: ${result.environment.database} — ${result.environment.postgresVersion ?? 'version unknown'}`,
);
console.log(
  `concurrent deliveries: ${result.scenarios.concurrentDelivery.deliveries}, ` +
    `stored responses: ${result.scenarios.concurrentDelivery.storedResponses}, ` +
    `proof generations: ${result.scenarios.concurrentDelivery.proofGenerations}, ` +
    `identical bytes: ${result.scenarios.concurrentDelivery.identicalResponseBodies}`,
);
console.log(
  `sequential latency: p50 ${result.scenarios.sequentialLatency.p50Ms} ms, ` +
    `p95 ${result.scenarios.sequentialLatency.p95Ms} ms, ` +
    `max ${result.scenarios.sequentialLatency.maxMs} ms ` +
    `(budget ${result.budget.internalBudgetMs} ms)`,
);
for (const assertion of result.assertions) {
  console.log(`${assertion.ok ? 'PASS' : 'FAIL'}  ${assertion.name} — ${assertion.detail}`);
}

if (!result.ok) {
  console.error('FAIL: the benchmark found a broken invariant');
  await gracefulExit(1);
} else {
  console.log('PASS: every benchmark invariant held');
  // snarkjs keeps worker handles open, so the process needs an explicit exit.
  // `gracefulExit` runs the registered shutdown hooks first, which keeps the
  // embedded PostgreSQL cluster and the pool from being torn down mid-write.
  await gracefulExit(0);
}
