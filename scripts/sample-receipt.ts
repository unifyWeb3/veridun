import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCircuitInputs, publicSignalsMatchInputs } from '../src/agent/circuit-inputs.js';
import { buildCounterfactual } from '../src/agent/counterfactual.js';
import { signBody } from '../src/agent/hmac.js';
import { evaluatePolicy } from '../src/agent/policy.js';
import { CircuitProver } from '../src/agent/prover.js';
import { gatekeeperTaskSchema, type GatekeeperTask } from '../src/shared/protocol.js';

/**
 * Generates a local sample receipt for one Proof Gatekeeper task.
 *
 * The receipt contains a real Groth16 proof produced with the official circuit
 * artifacts, the deterministic policy checks, the exact response bytes, and a
 * signature over those bytes computed with a published sample key. It is a
 * local sample: it is not a platform-signed response and it is not a record of
 * a live Agent Games task.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs/samples/sample-receipt.json');
const SAMPLE_KEY = 'veridun-local-sample-key';
const TASK_ID = 'gk_sample_0001';

const task: GatekeeperTask = gatekeeperTaskSchema.parse({
  type: 'agent-games.proof-gatekeeper.v1',
  task_id: TASK_ID,
  mode: 'practice',
  issued_at: '2026-01-01T00:00:00.000Z',
  deadline_at: '2026-01-01T00:01:00.000Z',
  input: {
    registered_vk: '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0',
    proof_vk: '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0',
    minimum: '1000',
    public_balance: '1460',
    expiry_block: '19842201',
    current_block: '19832000',
    recipient: `0x6e8f${'0'.repeat(32)}d8e9`,
    condition_recipient: `0x6e8f${'0'.repeat(32)}d8e9`,
    amount: '500',
    max_transfer: '1000',
    proof_tx: `0x${'11'.repeat(32)}`,
  },
});

const requestDigest = createHash('sha256')
  .update(JSON.stringify(task))
  .digest('hex');

const policy = evaluatePolicy(task, false);
const prover = new CircuitProver(
  process.env.CIRCUIT_DIR ?? path.join(ROOT, 'artifacts/circuit'),
  'auto',
);
const proof = await prover.prove(task, policy.decision, requestDigest);
const locallyVerified = await prover.verify(proof);

const response = {
  decision: policy.decision,
  reason_code: policy.reasonCode,
  proof_tx: task.input.proof_tx,
  proof: proof.proof,
  public_signals: proof.publicSignals,
};
const responseBody = Buffer.from(JSON.stringify(response), 'utf8');

const inputs = buildCircuitInputs(task, policy.decision, requestDigest, 'auto');
const signalCheck = publicSignalsMatchInputs(proof.publicSignals, inputs);

const receipt = {
  schema: 'veridun.decision-receipt.v1',
  sample: true,
  provenance: {
    kind: 'local sample',
    note: 'Generated locally by scripts/sample-receipt.ts with the official circuit artifacts. This is not a platform-signed response and not a record of a live Agent Games task.',
    generated_at: new Date().toISOString(),
    circuit_artifacts: 'artifacts/circuit (official, checksum-verified by npm run circuit:prepare)',
  },
  task,
  request_digest: requestDigest,
  policy: {
    decision: policy.decision,
    reason_code: policy.reasonCode,
    provable: policy.provable,
    checks: policy.checks,
  },
  counterfactual: buildCounterfactual(task, policy.decision, policy.checks),
  response_body: responseBody.toString('utf8'),
  response_signature: signBody(SAMPLE_KEY, responseBody),
  response_signature_algorithm: 'HMAC-SHA256 hex over the exact response_body bytes',
  response_signature_key: {
    kind: 'published sample key',
    value: SAMPLE_KEY,
    note: 'Live platform responses are signed with AGENT_GAMES_HMAC_SECRET, which is never published.',
  },
  proof: {
    scheme: 'Groth16 on BN128',
    proof: proof.proof,
    public_signals: proof.publicSignals,
    locally_verified: locallyVerified,
    public_signals_match_inputs: signalCheck.ok,
    verification_key_source: 'exported from the official gatekeeper proving key',
  },
  reproduce: {
    generate: 'npm run receipt:sample',
    verify: 'npm run receipt:verify -- docs/samples/sample-receipt.json',
  },
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

console.log(`Sample receipt written to ${path.relative(ROOT, OUTPUT)}`);
console.log(`decision=${receipt.policy.decision} reason_code=${receipt.policy.reason_code}`);
console.log(`proof locally verified: ${receipt.proof.locally_verified}`);

// snarkjs keeps worker handles open; this script has nothing left to do.
process.exit(0);
