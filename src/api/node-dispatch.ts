import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { FastifyInstance } from 'fastify';

/**
 * Serverless bridge between the platform's WHATWG `Request`/`Response` pair and
 * Fastify's Node HTTP handler.
 *
 * Fastify's `app.inject()` helper depends on `light-my-request`, which
 * `require()`s the ESM-only `cookie@2` package from CommonJS. The Vercel
 * Node runtime rejects that require with `ERR_REQUIRE_ESM`, so the deployed
 * function cannot use `inject`. Dispatching through the real Node HTTP
 * primitives keeps the exact same Fastify routing, hooks, content-type
 * parsing, and raw-body semantics as the standalone server without pulling in
 * the test-only dependency.
 */

export interface DispatchRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface DispatchResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

/** Hard ceiling for a single request handled by the serverless function. */
export const DISPATCH_TIMEOUT_MS = 55_000;

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk === undefined || chunk === null) return Buffer.alloc(0);
  return Buffer.from(String(chunk), 'utf8');
}

function collectHeaders(response: ServerResponse): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(response.getHeaders())) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      headers[name] = value.map((item) => String(item));
      continue;
    }
    headers[name] = String(value);
  }
  return headers;
}

function timeoutResponse(): DispatchResponse {
  return {
    statusCode: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ error: 'REQUEST_TIMEOUT' }), 'utf8'),
  };
}

/**
 * Runs one request through Fastify's Node HTTP handler and returns the exact
 * status, headers, and response bytes.
 */
export async function dispatchFastifyRequest(
  app: FastifyInstance,
  request: DispatchRequest,
  timeoutMs: number = DISPATCH_TIMEOUT_MS,
): Promise<DispatchResponse> {
  // Fastify finalizes route contexts (hooks, parsers) once the instance is
  // ready; dispatching earlier would route with an incomplete context.
  await app.ready();

  const socket = new Socket();
  const rawRequest = new IncomingMessage(socket);
  rawRequest.method = request.method;
  rawRequest.url = request.url;
  rawRequest.httpVersion = '1.1';
  rawRequest.httpVersionMajor = 1;
  rawRequest.httpVersionMinor = 1;
  rawRequest.headers = { host: 'veridun.local', ...request.headers };

  if (request.body && request.body.length > 0) {
    rawRequest.push(request.body);
  }
  rawRequest.push(null);

  const rawResponse = new ServerResponse(rawRequest);
  const chunks: Buffer[] = [];

  const originalWriteHead = rawResponse.writeHead.bind(rawResponse);
  const originalWrite = rawResponse.write.bind(rawResponse);
  const originalEnd = rawResponse.end.bind(rawResponse);

  // `writeHead(status, headers)` stores headers outside of `getHeaders()` when
  // no header was set before the call, so mirror them back explicitly.
  rawResponse.writeHead = ((statusCode: number, ...args: unknown[]) => {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      for (const [name, value] of Object.entries(last as Record<string, unknown>)) {
        rawResponse.setHeader(name, value as string | number | readonly string[]);
      }
    }
    return (originalWriteHead as (...callArgs: unknown[]) => ServerResponse)(
      statusCode,
      ...args,
    );
  }) as typeof rawResponse.writeHead;

  rawResponse.write = ((chunk: unknown) => {
    chunks.push(toBuffer(chunk));
    return true;
  }) as unknown as typeof rawResponse.write;

  const completion = new Promise<DispatchResponse>((resolve) => {
    rawResponse.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (chunk !== undefined && chunk !== null) chunks.push(toBuffer(chunk));
      const result = (originalEnd as (...callArgs: unknown[]) => ServerResponse)(
        chunk,
        ...rest,
      );
      resolve({
        statusCode: rawResponse.statusCode,
        headers: collectHeaders(rawResponse),
        body: Buffer.concat(chunks),
      });
      return result;
    }) as unknown as typeof rawResponse.end;
  });

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<DispatchResponse>((resolve) => {
    timer = setTimeout(() => resolve(timeoutResponse()), timeoutMs);
    timer.unref?.();
  });

  try {
    app.routing(rawRequest, rawResponse);
  } catch (error) {
    if (timer) clearTimeout(timer);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(
        JSON.stringify({
          error: 'INTERNAL_ERROR',
          detail: error instanceof Error ? error.message : String(error),
        }),
        'utf8',
      ),
    };
  }

  try {
    return await Promise.race([completion, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
