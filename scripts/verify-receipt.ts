import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groth16 } from 'snarkjs';
import {
  buildCircuitInputs,
  publicSignalsMatchInputs,
} from '../src/agent/circuit-inputs.js';
import { buildCounterfactual } from '../src/agent/counterfactual.js';
import type { Groth16Proof } from '../src/agent/contracts.js';
import { verifyBodySignature } from '../src/agent/hmac.js';
import { evaluatePolicy } from '../src/agent/policy.js';
import { gatekeeperTaskSchema } from '../src/shared/protocol.js';

/**
 * Verifies a Veridun decision receipt independently of the service.
 *
 * The checks are:
 *   1. the receipt parses as a gatekeeper task and a decision envelope;
 *   2. the deterministic policy engine still reaches the recorded decision;
 *   3. the public signals match the circuit inputs derived from the envelope;
 *   4. the Groth16 proof verifies against the official verification key;
 *   5. the HMAC over the exact response bytes matches (when a key is supplied).
 *
 * Exits non-zero if any check fails, so it can be used as a CI gate.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Receipt {
  schema?: string;
  sample?: boolean;
  task: unknown;
  request_digest?: string;
  policy?: { decision?: string; reason_code?: string; provable?: boolean; checks?: unknown[] };
  counterfactual?: {
    decision?: string;
    failingCheck?: { key?: string; label?: string } | null;
    wouldHaveApprovedIf?: string | null;
    valueAtRisk?: { amount?: string; recipient?: string; maxTransfer?: string } | null;
  };
  response_body?: string;
  response_signature?: string;
  response_signature_key?: { value?: string };
  proof?: {
    proof?: unknown;
    public_signals?: string[];
    locally_verified?: boolean;
  };
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run receipt:verify -- <receipt-file>');
  process.exit(2);
}

const receipt = JSON.parse(await readFile(path.resolve(file), 'utf8')) as Receipt;

const results: { check: string; ok: boolean; detail: string }[] = [];

function record(check: string, ok: boolean, detail: string): void {
  results.push({ check, ok, detail });
}

const task = gatekeeperTaskSchema.safeParse(receipt.task);
if (!task.success) {
  record('task envelope parses against the published contract', false, task.error.issues[0]?.message ?? 'invalid envelope');
  print();
  process.exit(1);
}
record('task envelope parses against the published contract', true, task.data.task_id);

const decision = receipt.policy?.decision;
const reasonCode = receipt.policy?.reason_code;
if (decision !== 'APPROVE' && decision !== 'REJECT') {
  record('decision is present', false, `unexpected decision: ${String(decision)}`);
  print();
  process.exit(1);
}
record('decision is present', true, `${decision} / ${String(reasonCode)}`);

const policy = evaluatePolicy(task.data, false);
const policyAgrees = policy.decision === decision && policy.reasonCode === reasonCode;
if (policy.provable !== receipt.policy?.provable) {
  record(
    'policy replay matches the recorded decision',
    false,
    `provable mismatch: replay=${policy.provable} receipt=${String(receipt.policy?.provable)}`,
  );
} else {
  record(
    'policy replay matches the recorded decision',
    policyAgrees,
    policyAgrees
      ? `${policy.decision} / ${policy.reasonCode}`
      : `replay=${policy.decision} / ${policy.reasonCode}`,
  );
}

const publicSignals = receipt.proof?.public_signals ?? [];
if (publicSignals.length !== 13) {
  record('receipt carries 13 public signals', false, `received ${publicSignals.length}`);
} else {
  record('receipt carries 13 public signals', true, '13 signals');

  const encoding = (process.env.TASK_ID_ENCODING ?? 'auto') as
    | 'auto'
    | 'hex-suffix'
    | 'sha256'
    | 'keccak256';
  const inputs = buildCircuitInputs(
    task.data,
    decision,
    receipt.request_digest ?? '',
    encoding,
  );
  const signalCheck = publicSignalsMatchInputs(publicSignals, inputs);
  record(
    'public signals match the circuit inputs derived from the envelope',
    signalCheck.ok,
    signalCheck.ok ? 'all 12 public inputs match' : `mismatched indexes: ${signalCheck.mismatched.join(', ')}`,
  );

  const vkeyPath = path.join(
    process.env.CIRCUIT_DIR ?? path.join(ROOT, 'artifacts/circuit'),
    'gatekeeper_vkey.json',
  );
  const vkey = JSON.parse(await readFile(vkeyPath, 'utf8'));
  let verified = false;
  try {
    verified = await groth16.verify(
      vkey,
      publicSignals,
      receipt.proof?.proof as Groth16Proof,
    );
  } catch (error) {
    record(
      'Groth16 proof verifies against the official verification key',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (verified) {
    record('Groth16 proof verifies against the official verification key', true, 'groth16.verify returned true');
  }
}

if (receipt.counterfactual) {
  const expectedCounterfactual = buildCounterfactual(
    task.data,
    decision,
    policy.checks,
  );
  const expectedValueAtRisk = expectedCounterfactual.valueAtRisk;
  const sameFailingCheck =
    (receipt.counterfactual.failingCheck?.key ?? null) ===
    (expectedCounterfactual.failingCheck?.key ?? null);
  const sameValueAtRisk =
    receipt.counterfactual.valueAtRisk?.amount === expectedValueAtRisk?.amount &&
    receipt.counterfactual.valueAtRisk?.recipient === expectedValueAtRisk?.recipient;
  record(
    'counterfactual matches a recomputation from the envelope',
    sameFailingCheck && sameValueAtRisk,
    sameFailingCheck && sameValueAtRisk
      ? `value at risk ${expectedValueAtRisk?.amount} to ${expectedValueAtRisk?.recipient}`
      : `receipt counterfactual=${JSON.stringify(receipt.counterfactual.failingCheck?.key ?? null)} recomputed=${expectedCounterfactual.failingCheck?.key ?? null}`,
  );
}

if (receipt.response_body && receipt.response_signature) {  const key =
    process.env.AGENT_GAMES_HMAC_SECRET ?? receipt.response_signature_key?.value ?? '';
  if (!key) {
    record('response HMAC over the exact response bytes', true, 'skipped: no key supplied');
  } else {
    const ok = verifyBodySignature(key, receipt.response_body, receipt.response_signature);
    record(
      'response HMAC over the exact response bytes',
      ok,
      ok ? 'signature matches the stored body bytes' : 'signature does not match the stored body bytes',
    );
  }
} else {
  record('response HMAC over the exact response bytes', false, 'receipt has no response body or signature');
}

print();
process.exit(results.every((result) => result.ok) ? 0 : 1);

function print(): void {
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.check} — ${result.detail}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    failed === 0
      ? `PASS: receipt verified (${results.length} checks)`
      : `FAIL: ${failed} of ${results.length} checks failed`,
  );
}
