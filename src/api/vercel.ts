import { loadConfig } from '../config/env.js';
import { dispatchFastifyRequest } from './node-dispatch.js';
import { createRuntime, type ApiRuntime } from './runtime.js';

let runtimePromise: Promise<ApiRuntime> | null = null;

function getRuntime(): Promise<ApiRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(loadConfig());
  }
  return runtimePromise;
}

/**
 * Vercel serves the dashboard as static output and routes every API call
 * through a single catch-all function. The internal Fastify route is derived
 * from the request pathname so the signed raw-body contract stays identical
 * on Vercel and on the local server.
 *
 * The request is dispatched through Fastify's Node HTTP handler rather than
 * `app.inject()`, because `inject` depends on `light-my-request`, whose
 * CommonJS `require()` of the ESM-only `cookie` package fails inside the
 * Vercel Node runtime (`ERR_REQUIRE_ESM`).
 */
export function resolveInternalPath(pathname: string): string | null {
  if (pathname.startsWith('/api/')) return pathname;
  if (pathname === '/agent' || pathname === '/health') return pathname;
  return null;
}

export async function handleVercelRequest(
  request: Request,
  runtimeOverride?: ApiRuntime,
): Promise<Response> {
  const url = new URL(request.url);
  const internalPath = resolveInternalPath(url.pathname);
  if (!internalPath) {
    return new Response(
      JSON.stringify({ error: 'NOT_FOUND' }),
      { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }

  const runtime = runtimeOverride ?? (await getRuntime());
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('host');
  headers.delete('transfer-encoding');

  let payload: Buffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    payload = Buffer.from(await request.arrayBuffer());
  }

  const dispatched = await dispatchFastifyRequest(runtime.app, {
    method: request.method,
    url: `${internalPath}${url.search}`,
    headers: Object.fromEntries(headers.entries()),
    body: payload,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(dispatched.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(key, item);
    } else {
      responseHeaders.set(key, value);
    }
  }
  // The platform owns the response framing; never forward hop-by-hop or
  // length headers that describe the serverless transport.
  responseHeaders.delete('transfer-encoding');
  responseHeaders.delete('connection');
  responseHeaders.delete('keep-alive');
  responseHeaders.delete('content-length');

  return new Response(Uint8Array.from(dispatched.body), {
    status: dispatched.statusCode,
    headers: responseHeaders,
  });
}
