import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates `docs/CLAIMS.md`.
 *
 * Every factual number in the documentation must come from this registry
 * instead of being typed by hand. Values are either computed from the local
 * artifacts, resolved from the lockfile, or fetched from an authoritative
 * endpoint at generation time.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CIRCUIT_DIR = path.resolve(
  process.env.CIRCUIT_DIR ?? path.join(ROOT, 'artifacts/circuit'),
);
const OUTPUT = path.join(ROOT, 'docs/CLAIMS.md');
const CIRCUIT_INFO_URL = 'https://agentgames.zkverify.io/api/circuit-info';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digestFile(filePath) {
  const bytes = await readFile(filePath);
  return { sha256: sha256(bytes), bytes: bytes.length };
}

/**
 * Reads the Groth16 header of an official `.zkey` proving key.
 *
 * The exported verification key does not carry the circuit size, so the
 * variable and public-input counts are parsed from the proving key itself
 * instead of being transcribed.
 */
async function readZkeyHeader(filePath) {
  const bytes = await readFile(filePath);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = bytes.subarray(0, 4).toString('latin1');
  if (magic !== 'zkey') {
    throw new Error(`unexpected proving-key magic: ${magic}`);
  }
  const sectionCount = view.getUint32(8, true);

  let offset = 12;
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const id = view.getUint32(offset, true);
    const length = Number(view.getBigUint64(offset + 4, true));
    const payload = offset + 12;
    sections.push({ id, length, payload });
    offset = payload + length;
  }

  const header = sections.find((section) => section.id === 2);
  if (!header) throw new Error('proving key has no Groth16 header section');

  let cursor = header.payload;
  const n8q = view.getUint32(cursor, true);
  cursor += 4 + n8q;
  const n8r = view.getUint32(cursor, true);
  cursor += 4 + n8r;
  const nVars = view.getUint32(cursor, true);
  const nPublic = view.getUint32(cursor + 4, true);
  const domainSize = view.getUint32(cursor + 8, true);

  return { nVars, nPublic, domainSize };
}

async function lockfileVersions() {
  const lock = JSON.parse(await readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const packages = lock.packages ?? {};
  const names = [
    'fastify',
    'snarkjs',
    'typescript',
    'vite',
    'vitest',
    'pg',
    '@fastify/static',
  ];
  const versions = {};
  for (const name of names) {
    const entry = packages[`node_modules/${name}`];
    if (entry?.version) versions[name] = entry.version;
  }
  return versions;
}

async function officialCircuitInfo() {
  const response = await fetch(CIRCUIT_INFO_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Veridun/0.1 (+zkVerify Agent Games)',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`circuit-info returned HTTP ${response.status}`);
  }
  return response.json();
}

async function liveProbe(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const rows = [];

  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(30_000) });
  const healthBody = (await health.json().catch(() => ({}))) ?? {};
  rows.push({
    endpoint: 'GET /health',
    status: health.status,
    observed: `ok=${healthBody.ok ?? 'unknown'} service=${healthBody.service ?? 'unknown'} database=${healthBody.database ?? 'unknown'}`,
  });

  const summary = await fetch(`${base}/api/summary`, { signal: AbortSignal.timeout(30_000) });
  const summaryBody = (await summary.json().catch(() => ({}))) ?? {};
  const totals = summaryBody?.totals ?? {};
  rows.push({
    endpoint: 'GET /api/summary',
    status: summary.status,
    observed: `tasks=${totals.tasks ?? 'unknown'} completed=${totals.completed ?? 'unknown'} proofs=${totals.proofs ?? 'unknown'}`,
  });

  for (const endpoint of ['/api/tasks', '/api/proofs']) {
    const response = await fetch(`${base}${endpoint}`, { signal: AbortSignal.timeout(30_000) });
    const body = (await response.json().catch(() => ({}))) ?? {};
    rows.push({
      endpoint: `GET ${endpoint}`,
      status: response.status,
      observed: `items=${Array.isArray(body.items) ? body.items.length : 'unknown'}`,
    });
  }

  const unsigned = await fetch(`${base}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'agent-games.preflight.v1' }),
    signal: AbortSignal.timeout(30_000),
  });
  const unsignedBody = (await unsigned.json().catch(() => ({}))) ?? {};
  rows.push({
    endpoint: 'POST /agent (unsigned)',
    status: unsigned.status,
    observed: `error=${unsignedBody.error ?? 'unknown'} signed=${unsigned.headers.has('x-agent-games-signature')}`,
  });

  // The receipt surface must answer a missing task and a missing parameter
  // with its documented codes, not with a generic failure.
  for (const path of ['/api/receipt?task_id=gk_missing', '/api/receipt']) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    const body = (await response.json().catch(() => ({}))) ?? {};
    rows.push({
      endpoint: `GET ${path}`,
      status: response.status,
      observed: `error=${body.error ?? 'none'}`,
    });
  }

  return rows;
}

function table(rows) {
  const header = '| Fact | Value | Source |';
  const divider = '| --- | --- | --- |';
  const body = rows.map((row) => `| ${row.fact} | ${row.value} | ${row.source} |`);
  return [header, divider, ...body].join('\n');
}

async function main() {
  const liveIndex = process.argv.indexOf('--live');
  const liveBaseUrl =
    liveIndex >= 0 ? process.argv[liveIndex + 1] : process.env.VERIDUN_LIVE_URL;

  const artifacts = {};
  for (const name of ['gatekeeper.wasm', 'gatekeeper_final.zkey', 'gatekeeper_vkey.json']) {
    artifacts[name] = await digestFile(path.join(CIRCUIT_DIR, name));
  }

  const verificationKey = JSON.parse(
    await readFile(path.join(CIRCUIT_DIR, 'gatekeeper_vkey.json'), 'utf8'),
  );
  const provingKeyHeader = await readZkeyHeader(
    path.join(CIRCUIT_DIR, 'gatekeeper_final.zkey'),
  );

  const official = await officialCircuitInfo();
  const officialGatekeeper = official?.circuits?.gatekeeper ?? {};

  const packageJson = JSON.parse(
    await readFile(path.join(ROOT, 'package.json'), 'utf8'),
  );
  const versions = await lockfileVersions();
  const npmUserAgent = process.env.npm_config_user_agent ?? '';
  const npmVersion = npmUserAgent.match(/npm\/([0-9.]+)/)?.[1] ?? 'unknown';

  const sections = [];

  sections.push(
    '# Claims registry',
    '',
    'Generated by `npm run claims` (`scripts/claims.mjs`). Do not edit by hand: every',
    'value below is computed from local artifacts, resolved from `package-lock.json`, or',
    'fetched from an authoritative endpoint at generation time.',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Node.js used for generation: ${process.version}`,
    '',
    '## Toolchain',
    '',
    table([
      {
        fact: 'Declared Node.js engine',
        value: `\`${packageJson.engines?.node ?? 'unset'}\``,
        source: '`package.json`',
      },
      {
        fact: 'npm used for generation',
        value: `\`${npmVersion}\``,
        source: 'npm user agent',
      },
      ...Object.entries(versions).map(([name, version]) => ({
        fact: `${name}`,
        value: `\`${version}\``,
        source: '`package-lock.json`',
      })),
    ]),
    '',
    '## Official circuit identity (fetched at generation time)',
    '',
    table([
      {
        fact: 'Official network',
        value: `\`${official.network}\``,
        source: CIRCUIT_INFO_URL,
      },
      {
        fact: 'Registered gatekeeper VK hash',
        value: `\`${officialGatekeeper.vkHash}\``,
        source: CIRCUIT_INFO_URL,
      },
      {
        fact: 'Official WASM artifact URL',
        value: `\`${officialGatekeeper.artifacts?.wasm}\``,
        source: CIRCUIT_INFO_URL,
      },
      {
        fact: 'Official ZKEY artifact URL',
        value: `\`${officialGatekeeper.artifacts?.zkey}\``,
        source: CIRCUIT_INFO_URL,
      },
    ]),
    '',
    '## Local circuit artifacts (computed)',
    '',
    table(
      Object.entries(artifacts).map(([name, info]) => ({
        fact: `\`${name}\` SHA-256`,
        value: `\`${info.sha256}\``,
        source: `local file (${info.bytes} bytes)`,
      })),
    ),
    '',
    '## Verification key exported from the official proving key',
    '',
    table([
      { fact: 'Protocol', value: `\`${verificationKey.protocol}\``, source: '`gatekeeper_vkey.json`' },
      { fact: 'Curve', value: `\`${verificationKey.curve}\``, source: '`gatekeeper_vkey.json`' },
      {
        fact: 'Public inputs (`nPublic`)',
        value: `\`${verificationKey.nPublic}\``,
        source: '`gatekeeper_vkey.json`',
      },
      {
        fact: 'Circuit variables (`nVars`)',
        value: `\`${provingKeyHeader.nVars}\``,
        source: '`gatekeeper_final.zkey` header',
      },
      {
        fact: 'Proving-key public inputs (`nPublic`)',
        value: `\`${provingKeyHeader.nPublic}\``,
        source: '`gatekeeper_final.zkey` header',
      },
      {
        fact: 'Proving-key domain size',
        value: `\`${provingKeyHeader.domainSize}\``,
        source: '`gatekeeper_final.zkey` header',
      },
    ]),
    '',
  );

  if (liveBaseUrl) {
    const rows = await liveProbe(liveBaseUrl);
    sections.push(
      '## Live deployment probe',
      '',
      `Unauthenticated external fetch of \`${liveBaseUrl.replace(/\/$/, '')}\` at generation time.`,
      '',
      table(
        rows.map((row) => ({
          fact: `\`${row.endpoint}\``,
          value: `HTTP ${row.status}`,
          source: row.observed,
        })),
      ),
      '',
    );
  } else {
    sections.push(
      '## Live deployment probe',
      '',
      'Not generated. Re-run `npm run claims -- --live <base-url>` to record an',
      'unauthenticated probe of the deployed endpoints.',
      '',
    );
  }

  const benchmarkPath = path.join(ROOT, 'docs/benchmarks/concurrency-and-latency.json');
  let benchmark = null;
  try {
    benchmark = JSON.parse(await readFile(benchmarkPath, 'utf8'));
  } catch {
    benchmark = null;
  }

  if (benchmark) {
    const concurrency = benchmark.scenarios.concurrentDelivery;
    const latency = benchmark.scenarios.sequentialLatency;
    sections.push(
      '## Concurrency and latency benchmark',
      '',
      'Measured by `npm run benchmark`: the real application over real HTTP against',
      `a real PostgreSQL server (\`${benchmark.environment.postgresVersion ?? benchmark.environment.database}\`),`,
      'with the official circuit artifacts. The artifact is',
      '`docs/benchmarks/concurrency-and-latency.json`; the numbers below are read',
      'from it, not transcribed.',
      '',
      table([
        {
          fact: 'Concurrent deliveries of one task ID',
          value: `\`${concurrency.deliveries}\``,
          source: `stored responses: ${concurrency.storedResponses}; proof generations: ${concurrency.proofGenerations}`,
        },
        {
          fact: 'Every concurrent delivery returned identical response bytes',
          value: `\`${concurrency.identicalResponseBodies}\``,
          source: `identical signatures: ${concurrency.identicalSignatures}; response bytes: ${concurrency.responseBytes}`,
        },
        {
          fact: 'A retry replayed the stored response bytes',
          value: `\`${concurrency.retryReplayedStoredBytes}\``,
          source: `proof generations after the retry: ${concurrency.proofGenerationsAfterRetry}`,
        },
        {
          fact: 'Sequential full-path latency (p50 / p95 / max)',
          value: `\`${latency.p50Ms} ms / ${latency.p95Ms} ms / ${latency.maxMs} ms\``,
          source: `${latency.samples} samples, min ${latency.minMs} ms, mean ${latency.meanMs} ms`,
        },
        {
          fact: 'Internal response budget',
          value: `\`${benchmark.budget.internalBudgetMs} ms\``,
          source: `platform deadline: ${benchmark.budget.platformDeadlineMs} ms`,
        },
        {
          fact: 'A reused proof reference was rejected',
          value: `\`${benchmark.scenarios.replayDetection.decision} / ${benchmark.scenarios.replayDetection.reasonCode}\``,
          source: `carried a proof: ${benchmark.scenarios.replayDetection.carriedProof}`,
        },
        {
          fact: 'The stored proof verified against the official verification key',
          value: `\`${benchmark.scenarios.storedProofVerification.verified}\``,
          source: `public signals: ${benchmark.scenarios.storedProofVerification.publicSignalCount}`,
        },
        {
          fact: 'Benchmark host',
          value: `\`${benchmark.environment.node} on ${benchmark.environment.platform} (${benchmark.environment.cpus} CPUs)\``,
          source: `generated at ${benchmark.generatedAt}`,
        },
      ]),
      '',
    );
  } else {
    sections.push(
      '## Concurrency and latency benchmark',
      '',
      'Not generated. Re-run `npm run benchmark` to record the measured delivery',
      'guarantees and latency against the response budget.',
      '',
    );
  }

  await writeFile(OUTPUT, `${sections.join('\n')}\n`, 'utf8');
  console.log(`Claims registry written to ${path.relative(ROOT, OUTPUT)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
