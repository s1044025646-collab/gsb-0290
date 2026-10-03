import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import { segmentedSieve, explainNumber, ALGO_VERSION, Explanation } from "./sieve";
import { validateRange } from "./validate";

export interface JobRow {
  id: number;
  L: number;
  R: number;
  block_size: number;
  status: string;
  prime_count: number | null;
  block_count: number | null;
  algo_version: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        L INTEGER NOT NULL,
        R INTEGER NOT NULL,
        block_size INTEGER NOT NULL,
        status TEXT NOT NULL,
        prime_count INTEGER,
        block_count INTEGER,
        algo_version TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS primes (
        job_id INTEGER NOT NULL,
        value INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        PRIMARY KEY (job_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_primes_job ON primes(job_id, ord);
    `);
  }

  close() { this.db.close(); }

  createAndRun(L: unknown, R: unknown, blockSize: unknown): JobRow {
    const v = validateRange(L, R, blockSize);
    const created = new Date().toISOString();
    const ins = this.db.prepare(
      `INSERT INTO jobs (L, R, block_size, status, algo_version, created_at) VALUES (?, ?, ?, 'running', ?, ?)`
    );
    const id = Number(ins.run(v.L, v.R, v.blockSize, ALGO_VERSION, created).lastInsertRowid);
    try {
      const { primes, blockCount } = segmentedSieve(v.L, v.R, v.blockSize);
      this.db.exec("BEGIN");
      try {
        const insP = this.db.prepare(`INSERT INTO primes (job_id, value, ord) VALUES (?, ?, ?)`);
        for (let i = 0; i < primes.length; i++) insP.run(id, primes[i], i);
        this.db.prepare(
          `UPDATE jobs SET status='done', prime_count=?, block_count=?, finished_at=? WHERE id=?`
        ).run(primes.length, blockCount, new Date().toISOString(), id);
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.db.prepare(`DELETE FROM primes WHERE job_id=?`).run(id);
      this.db.prepare(
        `UPDATE jobs SET status='failed', error=?, prime_count=NULL, block_count=NULL, finished_at=? WHERE id=?`
      ).run(msg, new Date().toISOString(), id);
    }
    return this.getJob(id)!;
  }

  getJob(id: number): JobRow | undefined {
    return this.db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as unknown as JobRow | undefined;
  }

  listJobs(limit = 50, offset = 0): JobRow[] {
    return this.db.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset) as unknown as JobRow[];
  }

  getPrimes(jobId: number, limit: number, offset: number): { total: number; items: number[] } {
    const job = this.getJob(jobId);
    if (!job) return { total: 0, items: [] };
    const rows = this.db.prepare(
      `SELECT value FROM primes WHERE job_id=? ORDER BY ord LIMIT ? OFFSET ?`
    ).all(jobId, limit, offset) as unknown as { value: number }[];
    return { total: job.prime_count ?? 0, items: rows.map((r) => r.value) };
  }

  *iteratePrimes(jobId: number, batch = 10000): Generator<number> {
    let offset = 0;
    for (;;) {
      const rows = this.db.prepare(
        `SELECT value FROM primes WHERE job_id=? ORDER BY ord LIMIT ? OFFSET ?`
      ).all(jobId, batch, offset) as unknown as { value: number }[];
      if (rows.length === 0) break;
      for (const r of rows) yield r.value;
      offset += rows.length;
    }
  }

  explain(jobId: number, n: number): Explanation & { jobId: number } {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`任务 ${jobId} 不存在`);
    if (job.status !== "done") throw new Error(`任务 ${jobId} 状态为 ${job.status}，不能解释`);
    if (!Number.isInteger(n) || n < 0) throw new Error("n 必须是非负整数");
    if (n < job.L || n > job.R) throw new Error(`n=${n} 不在任务区间 [${job.L}, ${job.R}] 内`);
    return { jobId, ...explainNumber(n, job.L, job.R, job.block_size) };
  }
}
