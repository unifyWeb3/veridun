import { describe, expect, it } from 'vitest';
import {
  serializeSignedJson,
  signBody,
  verifyBodySignature,
} from '../src/agent/hmac.js';
import { HMAC_SECRET } from './fixtures.js';

describe('raw-body HMAC', () => {
  it('accepts only the signature of the exact bytes', () => {
    const body = Buffer.from('{"type":"preflight","nonce":"a"}');
    const signature = signBody(HMAC_SECRET, body);
    expect(verifyBodySignature(HMAC_SECRET, body, signature)).toBe(true);
    expect(verifyBodySignature(HMAC_SECRET, `${body.toString()} `, signature)).toBe(false);
  });

  it('accepts the sha256 prefix without changing the signed bytes', () => {
    const body = Buffer.from('{"ok":true}');
    const signature = signBody(HMAC_SECRET, body);
    expect(verifyBodySignature(HMAC_SECRET, body, `sha256=${signature}`)).toBe(true);
  });

  it('rejects malformed and wrong-length signatures', () => {
    const body = Buffer.from('{}');
    expect(verifyBodySignature(HMAC_SECRET, body, 'not-a-signature')).toBe(false);
    expect(verifyBodySignature(HMAC_SECRET, body, '00')).toBe(false);
  });

  it('signs the serialized response body exactly', () => {
    const { body, signature } = serializeSignedJson(HMAC_SECRET, {
      ok: true,
      protocolVersion: 'v1',
    });
    expect(verifyBodySignature(HMAC_SECRET, body, signature)).toBe(true);
    expect(JSON.parse(body.toString('utf8'))).toEqual({
      ok: true,
      protocolVersion: 'v1',
    });
  });
});
