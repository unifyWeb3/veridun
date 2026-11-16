import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, SIGNATURE_HEADER } from '../src/api/app.js';
import { verifyBodySignature } from '../src/agent/hmac.js';
import type { GatekeeperTask } from '../src/shared/protocol.js';
import {
  HMAC_SECRET,
  TEST_PROOF_BUNDLE,
  testDependencies,
  testPreflight,
  testTask,
  verifiedInbound,
} from './fixtures.js';

const openApps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function signature(body: string): string {
  return createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

function responseSignature(response: { headers: Record<string, unknown> }): string {
  const value = response.headers[SIGNATURE_HEADER];
  if (Array.isArray(value)) return String(value[0]);
  return String(value);
}

async function build(overrides = {}) {
  const dependencies = testDependencies(overrides);
  const app = await createApp(dependencies);
  openApps.push(app);
  return { app, dependencies };
}

describe('signed Agent Games endpoint', () => {
  it('rejects an invalid HMAC before parsing the body', async () => {
    const claimTask = vi.fn();
    const { app } = await build({
      repository: {
        ...testDependencies().repository,
        claimTask,
      },
    });
    const body = '{not-json';

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: '00'.repeat(32),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'INVALID_SIGNATURE' });
    expect(claimTask).not.toHaveBeenCalled();
    expect(
      verifyBodySignature(
        HMAC_SECRET,
        response.body,
        responseSignature(response),
      ),
    ).toBe(true);
  });

  it('answers the signed preflight handshake', async () => {
    const { app } = await build();
    const body = JSON.stringify(testPreflight());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, protocolVersion: 'v1' });
    expect(
      verifyBodySignature(
        HMAC_SECRET,
        response.body,
        responseSignature(response),
      ),
    ).toBe(true);
  });

  it('returns a locally verified proof for a valid approval', async () => {
    const prove = vi.fn(async () => TEST_PROOF_BUNDLE);
    const { app } = await build({
      prover: { prove, verify: async () => true },
    });
    const task = testTask();
    const body = JSON.stringify(task);

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body);
    expect(parsed.decision).toBe('APPROVE');
    expect(parsed.reason_code).toBe('VALID_CONDITION');
    expect(parsed.proof).toEqual(TEST_PROOF_BUNDLE.proof);
    expect(parsed.public_signals).toHaveLength(13);
    expect(prove).toHaveBeenCalledWith(task, 'APPROVE', expect.any(String));
    expect(
      verifyBodySignature(
        HMAC_SECRET,
        response.body,
        responseSignature(response),
      ),
    ).toBe(true);
  });

  it('returns a proof for a circuit-visible rejection', async () => {
    const prove = vi.fn(async () => TEST_PROOF_BUNDLE);
    const inboundVerify = vi.fn(async () => verifiedInbound());
    const { app } = await build({
      prover: { prove, verify: async () => true },
      inboundVerifier: { source: 'zkverify', verify: inboundVerify },
    });
    const task = testTask();
    task.input.proof_vk = `0x${'ab'.repeat(32)}`;
    const body = JSON.stringify(task);

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    const parsed = JSON.parse(response.body);
    expect(parsed.decision).toBe('REJECT');
    expect(parsed.reason_code).toBe('VK_SUBSTITUTION');
    expect(parsed.proof).toEqual(TEST_PROOF_BUNDLE.proof);
    expect(parsed.public_signals).toHaveLength(13);
    expect(prove).toHaveBeenCalledWith(task, 'REJECT', expect.any(String));
    expect(inboundVerify).not.toHaveBeenCalled();
  });

  it('rejects replay without attempting an invalid circuit proof', async () => {
    const prove = vi.fn(async () => TEST_PROOF_BUNDLE);
    const { app } = await build({
      prover: { prove, verify: async () => true },
      repository: {
        ...testDependencies().repository,
        claimTask: async (task: GatekeeperTask) => ({
          kind: 'claimed',
          taskId: task.task_id,
          proofAlreadySeen: true,
        }),
      },
    });
    const body = JSON.stringify(testTask());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    const parsed = JSON.parse(response.body);
    expect(parsed.decision).toBe('REJECT');
    expect(parsed.reason_code).toBe('PROOF_REUSED');
    expect(parsed.proof).toBeUndefined();
    expect(parsed.public_signals).toBeUndefined();
    expect(prove).not.toHaveBeenCalled();
  });

  it('fails closed with a signed rejection when inbound finality fails', async () => {
    const prove = vi.fn(async () => TEST_PROOF_BUNDLE);
    const { app } = await build({
      prover: { prove, verify: async () => true },
      inboundVerifier: {
        source: 'zkverify',
        verify: async () =>
          verifiedInbound({
            verified: false,
            finalized: false,
            vkMatches: false,
            error: 'finality unavailable',
          }),
      },
    });
    const body = JSON.stringify(testTask());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    const parsed = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(parsed.decision).toBe('REJECT');
    expect(parsed.reason_code).toBe('PROOF_NOT_FINALIZED');
    expect(parsed.proof).toBeUndefined();
    expect(prove).not.toHaveBeenCalled();
    expect(
      verifyBodySignature(
        HMAC_SECRET,
        response.body,
        responseSignature(response),
      ),
    ).toBe(true);
  });

  it('returns a signed rejection when proof generation fails', async () => {
    const { app } = await build({
      prover: {
        prove: async () => {
          throw new Error('prover unavailable');
        },
        verify: async () => false,
      },
    });
    const body = JSON.stringify(testTask());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body);
    expect(parsed.decision).toBe('REJECT');
    expect(parsed.reason_code).toBe('PROOF_NOT_FINALIZED');
    expect(
      verifyBodySignature(
        HMAC_SECRET,
        response.body,
        responseSignature(response),
      ),
    ).toBe(true);
  });

  it('replays the exact stored response for an idempotent delivery', async () => {
    const storedBody = Buffer.from('{"decision":"APPROVE"}');
    const storedSignature = signature(storedBody.toString('utf8'));
    const { app } = await build({
      repository: {
        ...testDependencies().repository,
        claimTask: async (task: GatekeeperTask) => ({
          kind: 'duplicate',
          taskId: task.task_id,
          proofAlreadySeen: false,
          responseBody: storedBody,
          responseSignature: storedSignature,
        }),
      },
    });
    const body = JSON.stringify(testTask());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    expect(response.body).toBe(storedBody.toString('utf8'));
    expect(responseSignature(response)).toBe(storedSignature);
  });

  it('detects a task ID reused with a different payload', async () => {
    const { app } = await build({
      repository: {
        ...testDependencies().repository,
        claimTask: async (task: GatekeeperTask) => ({
          kind: 'conflict',
          taskId: task.task_id,
          proofAlreadySeen: false,
        }),
      },
    });
    const body = JSON.stringify(testTask());

    const response = await app.inject({
      method: 'POST',
      url: '/agent',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature(body),
      },
      payload: body,
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({ error: 'TASK_ID_CONFLICT' });
  });

  it('serves a re-verifiable receipt for a completed task', async () => {
    const storedBody = '{"decision":"APPROVE","reason_code":"VALID_CONDITION"}';
    const storedSignature = signature(storedBody);
    const { app } = await build({
      repository: {
        ...testDependencies().repository,
        getReceipt: async (taskId: string) => ({
          taskId,
          mode: 'practice',
          state: 'COMPLETED' as const,
          decision: 'APPROVE' as const,
          reasonCode: 'VALID_CONDITION' as const,
          durationMs: 1234,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
          requestDigest: 'a'.repeat(64),
          envelope: {
            mode: 'practice',
            issued_at: '2026-01-01T00:00:00.000Z',
            deadline_at: '2026-01-01T00:01:00.000Z',
            input: { proof_tx: `0x${'11'.repeat(32)}` },
          },
          policyChecks: [],
          inboundVerification: null,
          proof: null,
          kurier: null,
          responseBody: storedBody,
          responseSignature: storedSignature,
        }),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/receipt?task_id=gk_test_0001',
    });

    expect(response.statusCode).toBe(200);
    const receipt = JSON.parse(response.body) as {
      taskId: string;
      responseBody: string;
      responseSignature: string;
      verification: { reproduce: string };
    };
    expect(receipt.taskId).toBe('gk_test_0001');
    expect(receipt.responseBody).toBe(storedBody);
    expect(receipt.responseSignature).toBe(storedSignature);
    expect(receipt.verification.reproduce).toContain('receipt:verify');
  });

  it('reports a missing receipt without leaking internals', async () => {
    const { app } = await build();

    const missingId = await app.inject({ method: 'GET', url: '/api/receipt?task_id=gk_none' });
    expect(missingId.statusCode).toBe(404);
    expect(JSON.parse(missingId.body)).toEqual({ error: 'TASK_NOT_FOUND' });

    const missingParameter = await app.inject({ method: 'GET', url: '/api/receipt' });
    expect(missingParameter.statusCode).toBe(400);
    expect(JSON.parse(missingParameter.body)).toEqual({ error: 'TASK_ID_REQUIRED' });
  });
});
