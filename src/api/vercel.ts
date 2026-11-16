import { loadConfig } from '../config/env.js';
import { createRuntime, type ApiRuntime } from './runtime.js';

let runtimePromise: Promise<ApiRuntime> | null = null;

function getRuntime(): Promise<ApiRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(loadConfig());
  }
  return runtimePromise;
}

function resolvedRoute(request: Request): { pathname: string; search: string } {
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get('path');
  const routeUrl = new URL(requestedPath ?? url.pathname, url.origin);

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== 'path' && !routeUrl.searchParams.has(key)) {
      routeUrl.searchParams.append(key, value);
    }
  }

  return {
    pathname: routeUrl.pathname,
    search: routeUrl.search,
  };
}

export async function handleVercelRequest(request: Request): Promise<Response> {
  const runtime = await getRuntime();
  const route = resolvedRoute(request);
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
    url: `${route.pathname}${route.search}`,
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
