import {
  DatabaseSync,
} from 'node:sqlite';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  ALGORITHM_VERSION,
  ValidationError,
  blockCount,
  validateParams,
  type RunParams
} from './limits.js';
import { basePrimesUpTo, runSegmentedSieve, type NumberExplanation } from './sieve.js';

export type RunStatus = 'pending' | 'complete' | 'failed';

export interface RunSummary {
  id: number;
  l: number;
  r: number;
  blockSize: number;
  status: RunStatus;
  algorithmVersion: string | null;
  blockCount: number | null;
  primeCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface RunRow {
  id: number | bigint;
  l: number | bigint;
  r: number | bigint;
  block_size: number | bigint;
  status: RunStatus;
  algorithm_version: string | null;
  block_count: number | bigint | null;
  prime_count: number | bigint | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PrimePage {
  runId: number;
  limit: number;
  offset: number;
  total: number;
  primes: number[];
}

export interface ExplanationResponse {
  runId: number;
  explanation: NumberExplanation;
}

function numberRow(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function summarize(row: RunRow): RunSummary {
  return {
    id: Number(row.id),
    l: Number(row.l),
    r: Number(row.r),
    blockSize: Number(row.block_size),
    status: row.status,
    algorithmVersion: row.algorithm_version,
    blockCount: numberRow(row.block_count),
    primeCount: numberRow(row.prime_count),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

export class PrimeRunStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        l INTEGER NOT NULL,
        r INTEGER NOT NULL,
        block_size INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),
        algorithm_version TEXT,
        block_count INTEGER,
        prime_count INTEGER,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS primes (
        run_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY(run_id, position),
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_runs_range ON runs(l, r, status);
    `);
  }

  createAndCompute(input: Partial<RunParams>): RunSummary {
    const startedAt = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO runs (l, r, block_size, status, started_at)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    const fallbackL = typeof input.l === 'number' && Number.isFinite(input.l) ? Math.trunc(input.l) : 0;
    const fallbackR = typeof input.r === 'number' && Number.isFinite(input.r) ? Math.trunc(input.r) : 0;
    const fallbackBlockSize =
      typeof input.blockSize === 'number' && Number.isFinite(input.blockSize)
        ? Math.trunc(input.blockSize)
        : 1;
    const info = insert.run(fallbackL, fallbackR, fallbackBlockSize, startedAt);
    const id = Number(info.lastInsertRowid);

    let params: RunParams;
    try {
      params = validateParams(input);
      const result = runSegmentedSieve(params);
      const saveRun = this.db.prepare(`
        UPDATE runs
        SET l=?, r=?, block_size=?, status='complete', algorithm_version=?, block_count=?, prime_count=?,
            error_code=NULL, error_message=NULL, finished_at=?
        WHERE id=?
      `);
      const insertPrime = this.db.prepare(
        'INSERT INTO primes(run_id, position, value) VALUES (?, ?, ?)'
      );

      const tx = this.db.prepare('BEGIN IMMEDIATE');
      const commit = this.db.prepare('COMMIT');
      const rollback = this.db.prepare('ROLLBACK');
      tx.run();
      try {
        saveRun.run(
          params.l,
          params.r,
          params.blockSize,
          result.algorithmVersion,
          result.blockCount,
          result.primeCount,
          new Date().toISOString(),
          id
        );
        for (let position = 0; position < result.primes.length; position++) {
          insertPrime.run(id, position, result.primes[position]);
        }
        commit.run();
      } catch (error) {
        rollback.run();
        throw error;
      }
    } catch (error) {
      this.markFailed(id, error);
      throw error;
    }

    return this.getRunOrThrow(id);
  }

  private markFailed(id: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof ValidationError ? error.code : 'COMPUTATION_FAILED';
    this.db
      .prepare(`
        UPDATE runs
        SET status='failed', error_code=?, error_message=?, finished_at=?
        WHERE id=?
      `)
      .run(code, message, new Date().toISOString(), id);
  }

  getRun(id: number): RunSummary | null {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new ValidationError('INVALID_INTEGER', 'id 必须是正整数');
    }
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as RunRow | undefined;
    return row ? summarize(row) : null;
  }

  getRunOrThrow(id: number): RunSummary {
    const run = this.getRun(id);
    if (!run) throw new ValidationError('NOT_FOUND', `执行记录 ${id} 不存在`);
    return run;
  }

  list(limit = 20, offset = 0): RunSummary[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const safeOffset = Math.max(Math.trunc(offset), 0);
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(safeLimit, safeOffset) as unknown as RunRow[];
    return rows.map(summarize);
  }

  private completeRun(id: number): RunSummary {
    const run = this.getRunOrThrow(id);
    if (run.status !== 'complete') {
      throw new ValidationError(
        'RUN_NOT_COMPLETE',
        `执行记录 ${id} 当前状态为 ${run.status}，只有 complete 才能读取成功报告`
      );
    }
    return run;
  }

  getPrimePage(id: number, rawLimit = 100, rawOffset = 0): PrimePage {
    const run = this.completeRun(id);
    const limit = Math.min(Math.max(Number(rawLimit) || 100, 1), 1000);
    const offset = Math.max(Number(rawOffset) || 0, 0);
    if (offset > (run.primeCount ?? 0)) {
      throw new ValidationError('INVALID_RANGE', 'offset 不能超过素数总数');
    }
    const rows = this.db
      .prepare('SELECT value FROM primes WHERE run_id=? ORDER BY position LIMIT ? OFFSET ?')
      .all(id, limit, offset) as Array<{ value: number | bigint }>;

    return {
      runId: id,
      limit,
      offset,
      total: run.primeCount ?? 0,
      primes: rows.map((row) => Number(row.value))
    };
  }

  explain(id: number, n: unknown): ExplanationResponse {
    const run = this.completeRun(id);
    const number = typeof n === 'number' ? n : Number(n);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new ValidationError('INVALID_INTEGER', 'number 必须是非负安全整数');
    }
    if (number < run.l || number > run.r) {
      throw new ValidationError(
        'NUMBER_OUTSIDE_RANGE',
        `数字 ${number} 不在执行记录 ${id} 的闭区间 [${run.l},${run.r}] 内`
      );
    }

    return { runId: id, explanation: explainStoredNumber(run, number) };
  }

  exportJsonStream(id: number): Readable {
    const run = this.completeRun(id);
    const select = this.db.prepare('SELECT value FROM primes WHERE run_id=? ORDER BY position');
    const iterator = select.iterate(id) as IterableIterator<{ value: number | bigint }>;

    return Readable.from(
      (async function* () {
        yield JSON.stringify({
          id,
          input: { l: run.l, r: run.r, blockSize: run.blockSize },
          status: run.status,
          algorithmVersion: run.algorithmVersion,
          blockCount: run.blockCount,
          primeCount: run.primeCount,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          primes: []
        }, null, 2).replace(/"primes": \[\]\n\}/, '"primes": [');

        let first = true;
        for (const row of iterator) {
          if (!first) yield ',';
          first = false;
          yield String(Number(row.value));
        }
        yield ']\n}\n';
      })()
    );
  }

  exportLines(id: number, format: 'jsonl' | 'txt'): Readable {
    const run = this.completeRun(id);
    const select = this.db.prepare('SELECT value FROM primes WHERE run_id=? ORDER BY position');
    const iterator = select.iterate(id) as IterableIterator<{ value: number | bigint }>;
    let first = true;

    return Readable.from(
      (async function* () {
        if (format === 'jsonl') {
          for (const row of iterator) {
            yield JSON.stringify({ runId: id, value: Number(row.value) }) + '\n';
          }
          return;
        }

        for (const row of iterator) {
          if (!first) yield '\n';
          first = false;
          yield String(Number(row.value));
        }
        if (!first) yield '\n';
      })()
    );
  }

  async exportJsonFile(id: number, destination: string): Promise<void> {
    const stream = createWriteStream(destination, { encoding: 'utf8' });
    const pipeline = (await import('node:stream/promises')).pipeline;
    await pipeline(this.exportJsonStream(id), stream);
  }
}

function explainStoredNumber(run: RunSummary, n: number): NumberExplanation {
  const index = Math.floor((n - run.l) / run.blockSize);
  const blockStart = run.l + index * run.blockSize;
  const blockEnd = Math.min(run.r, blockStart + run.blockSize - 1);
  const sqrtR = Math.floor(Math.sqrt(run.r));

  if (n === 0 || n === 1) {
    return {
      number: n,
      classification: n === 0 ? 'zero' : 'one',
      message: n === 0
        ? '0 按定义不是素数；这里不把它解释为具有素因子的合数。'
        : '1 按定义不是素数；这里不虚构素因子。',
      blockIndex: index,
      blockStart,
      blockEnd
    };
  }

  for (const p of basePrimesUpTo(sqrtR)) {
    if (p * p > n) break;
    if (n % p === 0) {
      const firstAtLeastBlockStart = p * Math.ceil(blockStart / p);
      const start = Math.max(p * p, firstAtLeastBlockStart);
      return {
        number: n,
        classification: 'composite',
        message: `${n} 是合数：${n} = ${p} × ${n / p}。分段筛在第 ${index} 块 [${blockStart},${blockEnd}] 中用基素数 ${p} 的倍数标记了它。`,
        divisor: p,
        quotient: n / p,
        blockIndex: index,
        blockStart,
        blockEnd,
        pSquaredStart: start === p * p
      };
    }
  }

  return {
    number: n,
    classification: 'prime',
    message:
      n <= sqrtR
        ? `${n} 是基素数，且筛选只从 p² 开始标记，因此不会被自己或更小的必要基素数划除。`
        : `${n} 未被任何不超过 sqrt(${run.r})=${sqrtR} 的必要基素数划除，因此是素数。`,
    blockIndex: index,
    blockStart,
    blockEnd
  };
}

export async function openDefaultStore(): Promise<PrimeRunStore> {
  const dataDir = process.env.PRIME_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });
  return new PrimeRunStore(path.join(dataDir, 'prime-runs.sqlite'));
}

export function expectedBlockCount(params: RunParams): number {
  return blockCount(params.l, params.r, params.blockSize);
}

export { ALGORITHM_VERSION };
