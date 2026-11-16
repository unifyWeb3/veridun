import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { signBody, verifyBodySignature } from '../src/agent/hmac.js';
import {
  handleVercelRequest,
  resolveInternalPath,
} from '../src/api/vercel.js';
import type { ApiRuntime } from '../src/api/runtime.js';
import { HMAC_SECRET, testDependencies, testPreflight } from './fixtures.js';

async function testRuntime(): Promise<ApiRuntime> {
  const app = await createApp(testDependencies());
  return {
    app,
    async close() {
      await app.close();
    },
  };
}

function signedRequest(path: string, rawBody: string): Request {
  return new Request(`https://veridun-oxunify.vercel.app${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-games-signature': signBody(HMAC_SECRET, rawBody),
    },
    body: rawBody,
  });
}

describe('vercel web handler', () => {
  it('maps public paths to the internal Fastify routes', () => {
    expect(resolveInternalPath('/agent')).toBe('/agent');
    expect(resolveInternalPath('/api/agent')).toBe('/api/agent');
    expect(resolveInternalPath('/health')).toBe('/health');
    expect(resolveInternalPath('/api/health')).toBe('/api/health');
    expect(resolveInternalPath('/api/summary')).toBe('/api/summary');
    expect(resolveInternalPath('/api/task')).toBe('/api/task');
    expect(resolveInternalPath('/api/tasks')).toBe('/api/tasks');
    expect(resolveInternalPath('/api/proofs')).toBe('/api/proofs');
    expect(resolveInternalPath('/tasks')).toBeNull();
    expect(resolveInternalPath('/')).toBeNull();
  });

  it('signs the preflight response over the exact response body', async () => {
    const runtime = await testRuntime();
    try {
      const rawBody = JSON.stringify(testPreflight());
      const response = await handleVercelRequest(signedRequest('/agent', rawBody), runtime);
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ ok: true, protocolVersion: 'v1' });
      const signature = response.headers.get('x-agent-games-signature');
      expect(signature).toBeTruthy();
      expect(verifyBodySignature(HMAC_SECRET, text, signature)).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it('verifies the inbound HMAC over the raw request bytes', async () => {
    const runtime = await testRuntime();
    try {
      const rawBody = `{\n  "type": "agent-games.preflight.v1",\n  "agent_id": "agt_test",\n  "issued_at": "${new Date().toISOString()}",\n  "nonce": "nonce-test"\n}`;
      const response = await handleVercelRequest(signedRequest('/agent', rawBody), runtime);
      expect(response.status).toBe(200);
    } finally {
      await runtime.close();
    }
  });

  it('rejects a request whose signature does not match the raw body', async () => {
    const runtime = await testRuntime();
    try {
      const rawBody = JSON.stringify(testPreflight());
      const request = new Request('https://veridun-oxunify.vercel.app/agent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agent-games-signature': signBody(HMAC_SECRET, `${rawBody} `),
        },
        body: rawBody,
      });
      const response = await handleVercelRequest(request, runtime);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: 'INVALID_SIGNATURE' });
      expect(
        verifyBodySignature(HMAC_SECRET, text, response.headers.get('x-agent-games-signature')),
      ).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it('serves the health route without a signature', async () => {
    const runtime = await testRuntime();
    try {
      const response = await handleVercelRequest(
        new Request('https://veridun-oxunify.vercel.app/health'),
        runtime,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('veridun');
    } finally {
      await runtime.close();
    }
  });

  it('serves the single-segment dashboard routes Vercel routes to the function', async () => {
    const runtime = await testRuntime();
    try {
      const summary = await handleVercelRequest(
        new Request('https://veridun-oxunify.vercel.app/api/summary'),
        runtime,
      );
      expect(summary.status).toBe(200);

      const task = await handleVercelRequest(
        new Request('https://veridun-oxunify.vercel.app/api/task?task_id=gk_missing'),
        runtime,
      );
      expect(task.status).toBe(404);
      const body = (await task.json()) as { error: string };
      expect(body.error).toBe('TASK_NOT_FOUND');
    } finally {
      await runtime.close();
    }
  });

  it('does not route dashboard paths through the api function', async () => {
    const runtime = await testRuntime();
    try {
      const response = await handleVercelRequest(
        new Request('https://veridun-oxunify.vercel.app/tasks'),
        runtime,
      );
      expect(response.status).toBe(404);
    } finally {
      await runtime.close();
    }
  });
});
