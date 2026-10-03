import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { ValidationError, type ErrorCode } from './limits.js';
import { PrimeRunStore } from './store.js';

export function createApp(store: PrimeRunStore): Server {
  return createServer((request, response) => {
    void handle(request, response, store).catch((error: unknown) => {
      if (error instanceof ValidationError) {
        const status =
          error.code === 'NOT_FOUND'
            ? 404
            : error.code === 'RUN_NOT_COMPLETE' || error.code === 'NUMBER_OUTSIDE_RANGE'
              ? 409
              : 400;
        sendError(response, status, error.code, error.message);
      } else {
        sendError(response, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
      }
    });
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new ValidationError('UNSUPPORTED_MEDIA', 'Content-Type 必须是 application/json');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 1_000_000) {
      throw new ValidationError('INVALID_RANGE', '请求体不能超过 1 MB');
    }
    chunks.push(buffer);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('body must be object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('INVALID_INTEGER', '请求体必须是 JSON 对象');
  }
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  store: PrimeRunStore
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url.pathname === '/runs') {
    const body = await readJson(request);
    sendJson(response, 201, { run: store.createAndCompute(body) });
    return;
  }

  if (method === 'GET' && url.pathname === '/runs') {
    sendJson(response, 200, { runs: store.list(Number(url.searchParams.get('limit')), Number(url.searchParams.get('offset'))) });
    return;
  }

  const runId = Number(pathParts[1]);
  if (pathParts[0] === 'runs' && Number.isSafeInteger(runId) && runId > 0) {
    if (method === 'GET' && pathParts.length === 2) {
      sendJson(response, 200, { run: store.getRunOrThrow(runId) });
      return;
    }

    if (method === 'GET' && pathParts[2] === 'primes') {
      sendJson(
        response,
        200,
        store.getPrimePage(
          runId,
          Number(url.searchParams.get('limit') ?? 100),
          Number(url.searchParams.get('offset') ?? 0)
        )
      );
      return;
    }

    if (method === 'GET' && pathParts[2] === 'explain') {
      sendJson(response, 200, store.explain(runId, url.searchParams.get('number')));
      return;
    }

    if (method === 'GET' && pathParts[2] === 'export') {
      const format = url.searchParams.get('format') ?? 'jsonl';
      if (format !== 'jsonl' && format !== 'txt' && format !== 'json') {
        throw new ValidationError('INVALID_INTEGER', 'format 只能是 json、jsonl 或 txt');
      }
      if (format === 'json') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        store.exportJsonStream(runId).pipe(response);
        return;
      }
      if (format === 'jsonl') {
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        store.exportLines(runId, 'jsonl').pipe(response);
        return;
      }
      if (format === 'txt') {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        store.exportLines(runId, 'txt').pipe(response);
        return;
      }
    }
  }

  sendError(response, 404, 'NOT_FOUND', `未找到路由 ${method} ${url.pathname}`);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, code: ErrorCode | 'INTERNAL_ERROR', message: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: { code, message } }));
}

process.on('uncaughtException', (error) => {
  if (error instanceof ValidationError) return;
  console.error(error);
});
