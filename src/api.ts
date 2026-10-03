import * as http from "node:http";
import { Store } from "./store";
import { ApiError } from "./validate";
import { ALGO_VERSION } from "./sieve";

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1_000_000) reject(new ApiError("PAYLOAD_TOO_LARGE", "请求体过大", 413));
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(new ApiError("BAD_JSON", "请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, algoVersion: ALGO_VERSION });
      }
      if (req.method === "POST" && url.pathname === "/jobs") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const job = store.createAndRun(body.L, body.R, body.blockSize);
        return sendJson(res, job.status === "done" ? 201 : 500, job);
      }
      if (req.method === "GET" && url.pathname === "/jobs") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return sendJson(res, 200, { items: store.listJobs(limit, offset) });
      }
      if (parts[0] === "jobs" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("INVALID_PARAM", "任务 id 非法");
        const job = store.getJob(id);
        if (!job) throw new ApiError("NOT_FOUND", `任务 ${id} 不存在`, 404);
        if (req.method === "GET" && parts.length === 2) return sendJson(res, 200, job);
        if (req.method === "GET" && parts[2] === "primes") {
          if (job.status !== "done") throw new ApiError("JOB_NOT_DONE", `任务状态为 ${job.status}`, 409);
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 10000);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return sendJson(res, 200, { jobId: id, ...store.getPrimes(id, limit, offset) });
        }
        if (req.method === "GET" && parts[2] === "explain") {
          const n = Number(url.searchParams.get("n"));
          try {
            return sendJson(res, 200, store.explain(id, n));
          } catch (e) {
            throw new ApiError("EXPLAIN_FAILED", e instanceof Error ? e.message : String(e));
          }
        }
        if (req.method === "GET" && parts[2] === "export") {
          if (job.status !== "done") throw new ApiError("JOB_NOT_DONE", `任务状态为 ${job.status}`, 409);
          const format = url.searchParams.get("format") ?? "json";
          if (format === "txt") {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            for (const p of store.iteratePrimes(id)) res.write(`${p}\n`);
            return res.end();
          }
          if (format === "json") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.write(JSON.stringify({ job, primes: [] as number[] }).replace("]", ""));
            let first = true;
            for (const p of store.iteratePrimes(id)) {
              res.write((first ? "" : ",") + String(p));
              first = false;
            }
            return res.end("]}");
          }
          throw new ApiError("INVALID_PARAM", "format 仅支持 json 或 txt");
        }
      }
      throw new ApiError("NOT_FOUND", `路由不存在: ${req.method} ${url.pathname}`, 404);
    } catch (e) {
      if (e instanceof ApiError) return sendJson(res, e.status, { error: e.code, message: e.message });
      return sendJson(res, 500, { error: "INTERNAL", message: e instanceof Error ? e.message : String(e) });
    }
  });
}

export function startServer(store: Store, port: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(store);
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}
