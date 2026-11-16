import { loadConfig } from '../config/env.js';
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

  const injected = await runtime.app.inject({
    method: request.method,
    url: `${internalPath}${url.search}`,
    headers: Object.fromEntries(headers.entries()),
    payload,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(injected.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(key, item);
    } else {
      responseHeaders.set(key, String(value));
    }
  }

  return new Response(injected.body, {
    status: injected.statusCode,
    headers: responseHeaders,
  });
}
