#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateParams, ValidationError } from './limits.js';
import { openDefaultStore, PrimeRunStore } from './store.js';
import { runSegmentedSieve, trialDivisionPrimes } from './sieve.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'create':
      await withStore((store) => {
        const run = store.createAndCompute(normalizeRunArgs(args));
        console.log(JSON.stringify(run, null, 2));
      });
      break;
    case 'get':
      await withStore((store) => console.log(JSON.stringify(store.getRunOrThrow(requiredId(args[0])), null, 2)));
      break;
    case 'primes': {
      await withStore((store) => {
        const id = requiredId(args[0]);
        const options = parseOptions(args.slice(1));
        console.log(
          JSON.stringify(
            store.getPrimePage(
              id,
              Number(options.limit ?? 100),
              Number(options.offset ?? 0)
            ),
            null,
            2
          )
        );
      });
      break;
    }
    case 'explain':
      await withStore((store) =>
        console.log(JSON.stringify(store.explain(requiredId(args[0]), args[1]), null, 2))
      );
      break;
    case 'history':
      await withStore((store) => console.log(JSON.stringify(store.list(), null, 2)));
      break;
    case 'export': {
      const id = requiredId(args[0]);
      const options = parseOptions(args.slice(1));
      const format = String(options.format ?? 'txt');
      const out = typeof options.out === 'string' ? options.out : undefined;
      if (format !== 'txt' && format !== 'jsonl' && format !== 'json') {
        throw new ValidationError('INVALID_INTEGER', 'format 只能是 txt、jsonl 或 json');
      }
      await withStore(async (store) => {
        if (format === 'json' && out) {
          await store.exportJsonFile(id, out);
          console.error(`已写入 ${out}`);
          return;
        }
        if (process.stdout.isTTY && !out) {
          throw new ValidationError(
            'INVALID_RANGE',
            '导出大量结果时请重定向到文件，或对 JSON 使用 --out 文件路径；不会一次刷屏打印所有内容'
          );
        }
        if (out) {
          const fs = await import('node:stream/promises');
          const { createWriteStream } = await import('node:fs');
          const source = format === 'json'
            ? store.exportJsonStream(id)
            : store.exportLines(id, format);
          await fs.pipeline(source, createWriteStream(out));
          console.error(`已写入 ${out}`);
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const source = format === 'json'
            ? store.exportJsonStream(id)
            : store.exportLines(id, format);
          source.pipe(process.stdout);
          process.stdout.on('finish', () => resolve());
          process.stdout.on('error', reject);
        });
      });
      break;
    }
    case 'compare-blocks': {
      const params = parseOptions(args);
      const firstParams = validateParams({
        l: params.l,
        r: params.r,
        blockSize: Number(params.blockSizeA ?? 1)
      });
      const secondParams = validateParams({
        l: params.l,
        r: params.r,
        blockSize: Number(params.blockSizeB ?? 2)
      });
      const first = runSegmentedSieve(firstParams);
      const second = runSegmentedSieve(secondParams);
      const same =
        first.primeCount === second.primeCount &&
        first.primes.every((value, index) => value === second.primes[index]);
      console.log(JSON.stringify({
        same,
        a: summarizeComputation(first),
        b: summarizeComputation(second)
      }, null, 2));
      if (!same) process.exitCode = 1;
      break;
    }
    case 'demo':
      await demo();
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

function normalizeRunArgs(args: string[]): Record<string, string | number | boolean> {
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const options = parseOptions(args);
  if (positional.length > 0) options.l ??= positional[0];
  if (positional.length > 1) options.r ??= positional[1];
  if (positional.length > 2) options.blockSize ??= positional[2];
  return options;
}

function summarizeComputation(result: ReturnType<typeof runSegmentedSieve>) {
  return {
    input: result.params,
    blockCount: result.blockCount,
    primeCount: result.primeCount,
    algorithmVersion: result.algorithmVersion
  };
}

async function withStore(action: (store: PrimeRunStore) => void | Promise<void>): Promise<void> {
  const store = await openDefaultStore();
  try {
    await action(store);
  } finally {
    store.close();
  }
}

function requiredId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ValidationError('INVALID_INTEGER', '运行记录 id 必须是正整数');
  }
  return id;
}

function parseOptions(args: string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = args[index + 1];
      if (next === undefined || next.startsWith('--')) {
        result[key] = true;
      } else {
        result[key] = next;
        index++;
      }
    }
  }
  return result;
}

function usage(): void {
  console.log(`用法:
  npm run build
  npm start
  node dist/cli.js create --l 0 --r 30 --blockSize 7
  node dist/cli.js primes <id> --limit 100 --offset 0
  node dist/cli.js explain <id> 49
  node dist/cli.js history
  node dist/cli.js export <id> --format txt > primes.txt
  node dist/cli.js export <id> --format json --out report.json
  node dist/cli.js compare-blocks --l 1 --r 200 --blockSizeA 1 --blockSizeB 37
  node dist/cli.js demo`);
}

async function demo(): Promise<void> {
  const dataDir = path.resolve(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });
  const store = new PrimeRunStore(path.join(dataDir, 'prime-runs.sqlite'));
  try {
    for (const [l, r, blockSize] of [
      [0, 30, 7],
      [2, 2, 1],
      [49, 49, 10],
      [999_999_000, 1_000_000_000, 50_000]
    ] as const) {
      const run = store.createAndCompute({ l, r, blockSize });
      console.log(JSON.stringify(run));
      if (l <= 49 && r >= 49) {
        console.log(JSON.stringify(store.explain(run.id, 49)));
      }
    }
    console.log(`最近记录: ${store.list(4).length} 条（重启后仍可读取 data/prime-runs.sqlite）`);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ValidationError) {
    console.error(JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

export { trialDivisionPrimes };
