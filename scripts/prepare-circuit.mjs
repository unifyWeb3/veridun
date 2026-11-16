import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zKey } from 'snarkjs';

const ARTIFACTS = [
  {
    name: 'gatekeeper.wasm',
    url: 'https://agentgames.zkverify.io/circuits/gatekeeper.wasm',
    sha256: 'be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f',
  },
  {
    name: 'gatekeeper_final.zkey',
    url: 'https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey',
    sha256: 'adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d',
  },
];

const circuitDir = path.resolve(
  process.env.CIRCUIT_DIR ?? 'artifacts/circuit',
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileDigest(filePath) {
  return sha256(await readFile(filePath));
}

async function downloadArtifact(artifact) {
  const response = await fetch(artifact.url, {
    headers: {
      'user-agent': 'Veridun/0.1 (+zkVerify Agent Games)',
      accept: 'application/octet-stream',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `${artifact.name} download returned HTTP ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== artifact.sha256) {
    throw new Error(
      `${artifact.name} checksum mismatch: expected ${artifact.sha256}, received ${digest}`,
    );
  }
  return bytes;
}

async function ensureArtifact(artifact) {
  const target = path.join(circuitDir, artifact.name);
  try {
    const digest = await fileDigest(target);
    if (digest === artifact.sha256) {
      console.log(`${artifact.name}: verified local artifact`);
      return target;
    }
    console.log(`${artifact.name}: local checksum mismatch; downloading official artifact`);
  } catch {
    console.log(`${artifact.name}: downloading official artifact`);
  }

  const bytes = await downloadArtifact(artifact);
  const temporary = `${target}.download`;
  await writeFile(temporary, bytes, { flag: 'w' });
  await rename(temporary, target);
  console.log(`${artifact.name}: downloaded and checksum verified`);
  return target;
}

async function exportVerificationKey(zkeyPath) {
  const verificationKey = await zKey.exportVerificationKey(zkeyPath);
  if (
    verificationKey?.protocol !== 'groth16' ||
    verificationKey?.curve !== 'bn128' ||
    verificationKey?.nPublic !== 13
  ) {
    throw new Error('official proving key did not export the expected Groth16/BN128 key');
  }
  const target = path.join(circuitDir, 'gatekeeper_vkey.json');
  const temporary = `${target}.download`;
  await writeFile(temporary, `${JSON.stringify(verificationKey, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return target;
}

async function main() {
  await mkdir(circuitDir, { recursive: true });
  const paths = new Map();
  for (const artifact of ARTIFACTS) {
    paths.set(artifact.name, await ensureArtifact(artifact));
  }

  const verificationKeyPath = await exportVerificationKey(
    paths.get('gatekeeper_final.zkey'),
  );
  paths.set('gatekeeper_vkey.json', verificationKeyPath);

  const lines = [];
  for (const [name, filePath] of paths.entries()) {
    const bytes = await readFile(filePath);
    lines.push(`${sha256(bytes)}  ${name}  ${bytes.length} bytes`);
  }
  await writeFile(
    path.join(circuitDir, 'checksums.txt'),
    `${lines.join('\n')}\n`,
    'utf8',
  );

  console.log(`Official circuit is ready in ${circuitDir}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
