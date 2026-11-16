import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const BASE = {
  AGENT_GAMES_HMAC_SECRET: 'secret',
  DATABASE_URL: 'postgres://user:pass@host/db',
};

describe('environment configuration', () => {
  it('accepts dashboard values with surrounding whitespace', () => {
    const config = loadConfig({
      ...BASE,
      INBOUND_PROOF_VERIFIER: ' zkverify\n',
      TASK_ID_ENCODING: 'auto ',
      PROOF_SUBMIT_ENABLED: 'true\n',
      DASHBOARD_ENABLED: ' true ',
    });

    expect(config.inboundProofVerifier).toBe('zkverify');
    expect(config.taskIdEncoding).toBe('auto');
    expect(config.proofSubmitEnabled).toBe(true);
    expect(config.dashboardEnabled).toBe(true);
  });

  it('still rejects an invalid enum value', () => {
    expect(() =>
      loadConfig({ ...BASE, INBOUND_PROOF_VERIFIER: 'not-a-verifier' }),
    ).toThrow();
  });

  it('requires the HMAC secret and database url', () => {
    expect(() => loadConfig({ DATABASE_URL: BASE.DATABASE_URL })).toThrow();
    expect(() => loadConfig({ AGENT_GAMES_HMAC_SECRET: BASE.AGENT_GAMES_HMAC_SECRET })).toThrow();
  });

  it('strips a trailing slash from the kurier and subscan base urls', () => {
    const config = loadConfig({
      ...BASE,
      KURIER_API_BASE_URL: 'https://api.kurier.xyz/api/v1/',
      SUBSCAN_BASE_URL: 'https://zkverify.subscan.io/',
    });

    expect(config.kurierApiBaseUrl).toBe('https://api.kurier.xyz/api/v1');
    expect(config.subscanBaseUrl).toBe('https://zkverify.subscan.io');
  });
});
