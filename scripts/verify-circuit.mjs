import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED = {
  'gatekeeper.wasm': 'be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f',
  'gatekeeper_final.zkey': 'adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d',
};
const EXPECTED_VK_HASH =
  '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0';

const circuitDir = path.resolve(
  process.env.CIRCUIT_DIR ?? 'artifacts/circuit',
);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyFile(name, expected) {
  const filePath = path.join(circuitDir, name);
  const bytes = await readFile(filePath);
  const actual = digest(bytes);
  if (actual !== expected) {
    throw new Error(
      `${name} checksum mismatch: expected ${expected}, received ${actual}`,
    );
  }
  console.log(`${name}: ${actual} (${bytes.length} bytes)`);
  return bytes;
}

async function main() {
  await verifyFile('gatekeeper.wasm', EXPECTED['gatekeeper.wasm']);
  await verifyFile('gatekeeper_final.zkey', EXPECTED['gatekeeper_final.zkey']);

  const verificationKey = JSON.parse(
    await readFile(path.join(circuitDir, 'gatekeeper_vkey.json'), 'utf8'),
  );
  if (
    verificationKey.protocol !== 'groth16' ||
    verificationKey.curve !== 'bn128' ||
    verificationKey.nPublic !== 13
  ) {
    throw new Error('verification key is not the expected Groth16/BN128 key');
  }

  console.log(`registered VK hash: ${EXPECTED_VK_HASH}`);
  console.log('Circuit artifact verification passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
