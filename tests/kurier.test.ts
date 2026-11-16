import { afterEach, describe, expect, it, vi } from 'vitest';
import { KurierProofClient } from '../src/agent/kurier.js';
import { TEST_PROOF_BUNDLE } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Kurier proof submission contract', () => {
  it('submits the proof and waits for finalization', async () => {
    const responses = [
      new Response(JSON.stringify({ jobId: 'job-1', optimisticVerify: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(JSON.stringify({ jobId: 'job-1', status: 'Submitted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(
        JSON.stringify({
          jobId: 'job-1',
          status: 'Finalized',
          txHash: '0xabc',
          blockHash: '0xdef',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected Kurier request');
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new KurierProofClient({
      apiKey: 'test-key',
      baseUrl: 'https://kurier.test/api/v1',
      pollIntervalMs: 1,
      finalityTimeoutMs: 5_000,
    });

    const result = await client.submitAndAwait(
      TEST_PROOF_BUNDLE,
      `0x${'11'.repeat(32)}`,
      Date.now() + 5_000,
    );

    expect(result.status).toBe('Finalized');
    expect(result.txHash).toBe('0xabc');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const submitBody = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    );
    expect(submitBody.proofData.publicSignals).toHaveLength(13);
    expect(submitBody.proofData.vk).toBe(`0x${'11'.repeat(32)}`);
  });

  it('fails loudly when Kurier reports processing failure', async () => {
    const responses = [
      new Response(JSON.stringify({ jobId: 'job-2', optimisticVerify: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(JSON.stringify({ jobId: 'job-2', status: 'Failed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = responses.shift();
        if (!response) throw new Error('unexpected Kurier request');
        return response;
      }),
    );

    const client = new KurierProofClient({
      apiKey: 'test-key',
      baseUrl: 'https://kurier.test/api/v1',
      pollIntervalMs: 1,
      finalityTimeoutMs: 5_000,
    });

    await expect(
      client.submitAndAwait(
        TEST_PROOF_BUNDLE,
        `0x${'11'.repeat(32)}`,
        Date.now() + 5_000,
      ),
    ).rejects.toThrow('Kurier reported that proof processing failed');
  });

  it('does not submit without an API key', async () => {
    const client = new KurierProofClient({
      apiKey: '',
      baseUrl: 'https://kurier.test/api/v1',
      pollIntervalMs: 1,
      finalityTimeoutMs: 5_000,
    });
    expect(client.enabled).toBe(false);
    await expect(
      client.submitAndAwait(
        TEST_PROOF_BUNDLE,
        `0x${'11'.repeat(32)}`,
        Date.now() + 1_000,
      ),
    ).rejects.toThrow('disabled');
  });
});
