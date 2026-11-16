import { createHmac, timingSafeEqual } from 'node:crypto';

function normalizeSignature(value: string | string[] | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^sha256=/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function signBody(secret: string, body: Buffer | string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyBodySignature(
  secret: string,
  body: Buffer | string,
  provided: string | string[] | null | undefined,
): boolean {
  const normalized = normalizeSignature(provided);
  if (!normalized) return false;

  const expected = Buffer.from(signBody(secret, body), 'utf8');
  const actual = Buffer.from(normalized, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function serializeSignedJson(
  secret: string,
  value: unknown,
): { body: Buffer; signature: string } {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return { body, signature: signBody(secret, body) };
}
