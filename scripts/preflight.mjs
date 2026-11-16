#!/usr/bin/env node
/**
 * Official Agent Games preflight runner.
 *
 * Usage:
 *   AGENT_GAMES_HMAC_SECRET=<secret> \
 *   node scripts/preflight.mjs https://your-agent.vercel.app agent_id_here
 *
 * The script builds the official preflight envelope, signs the exact request
 * bytes with HMAC-SHA256, POSTs it to the agent endpoint and verifies the
 * signature the agent returns over the exact response body.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const endpoint = process.argv[2] ?? process.env.AGENT_ENDPOINT;
const agentId = process.argv[3] ?? process.env.AGENT_ID;
const secret = process.env.AGENT_GAMES_HMAC_SECRET;

if (!endpoint) {
  console.error('Usage: node scripts/preflight.mjs <agent-endpoint-url> [agent-id]');
  process.exit(2);
}
if (!secret) {
  console.error('AGENT_GAMES_HMAC_SECRET is required.');
  process.exit(2);
}
if (!agentId) {
  console.error('AGENT_ID is required (pass it as the second argument or set AGENT_ID).');
  process.exit(2);
}

const sign = (value) => createHmac('sha256', secret).update(value).digest('hex');

const envelope = {
  type: 'agent-games.preflight.v1',
  agent_id: agentId,
  issued_at: new Date().toISOString(),
  nonce: randomUUID(),
};

const body = JSON.stringify(envelope);
const signature = sign(body);
const url = endpoint.endsWith('/agent') ? endpoint : `${endpoint.replace(/\/$/, '')}/agent`;

console.log(`POST ${url}`);
console.log(`agent_id: ${agentId}`);
console.log(`body:    ${body}`);

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-agent-games-signature': signature,
  },
  body,
  signal: AbortSignal.timeout(60_000),
});

const responseBody = await response.text();
const responseSignature = response.headers.get('x-agent-games-signature');
console.log(`status:  ${response.status}`);
console.log(`body:    ${responseBody}`);

if (!responseSignature) {
  console.error('FAIL: response is missing the x-agent-games-signature header.');
  process.exit(1);
}

const expected = Buffer.from(sign(responseBody), 'utf8');
const received = Buffer.from(responseSignature.trim().replace(/^sha256=/i, '').toLowerCase(), 'utf8');
const verified =
  expected.length === received.length && timingSafeEqual(expected, received);

if (!verified) {
  console.error('FAIL: response signature does not match the exact response body.');
  process.exit(1);
}
console.log('signature: verified against the exact response body');

let parsed;
try {
  parsed = JSON.parse(responseBody);
} catch {
  console.error('FAIL: response body is not valid JSON.');
  process.exit(1);
}

if (response.status !== 200 || parsed?.ok !== true || parsed?.protocolVersion !== 'v1') {
  console.error('FAIL: endpoint did not return the expected preflight acknowledgement.');
  process.exit(1);
}

console.log('PASS: preflight acknowledged by Veridun.');
