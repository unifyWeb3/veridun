import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadConfig } from '../config/env.js';
import { createRuntime, type ApiRuntime } from './runtime.js';

let runtimePromise: Promise<ApiRuntime> | null = null;

function getRuntime(): Promise<ApiRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime(loadConfig());
  }
  return runtimePromise;
}

function resolvedRoute(request: VercelRequest): { pathname: string; search: string } {
  const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);
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

async function handleRequest(request: VercelRequest, response: VercelResponse): Promise<void> {
  const runtime = await getRuntime();
  const route = resolvedRoute(request);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      headers[key] = value.join(',');
    } else if (typeof value === 'string') {
      headers[key] = value;
    }
  }
  delete headers['content-length'];
  delete headers['host'];
  delete headers['transfer-encoding'];

  let payload: Buffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    payload = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body));
  }

  const injected = await runtime.app.inject({
    method: request.method ?? 'GET',
    url: `${route.pathname}${route.search}`,
    headers,
    payload,
  });

  for (const [key, value] of Object.entries(injected.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) response.appendHeader(key, item);
    } else {
      response.setHeader(key, String(value));
    }
  }

  response.status(injected.statusCode).send(injected.body);
}

export function createVercelHandler() {
  return async function vercelHandler(request: VercelRequest, response: VercelResponse): Promise<void> {
    await handleRequest(request, response);
  };
}

export async function handleVercelRequest(request: Request): Promise<Response> {
  const runtime = await getRuntime();
  const url = new URL(request.url);
  const requestedPath = url.searchParams.get('path');
  const routeUrl = new URL(requestedPath ?? url.pathname, url.origin);

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== 'path' && !routeUrl.searchParams.has(key)) {
      routeUrl.searchParams.append(key, value);
    }
  }

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
    url: `${routeUrl.pathname}${routeUrl.search}`,
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