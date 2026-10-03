import * as path from "node:path";
import * as fs from "node:fs";
import { Store } from "./store";
import { startServer } from "./api";

const DB_PATH = process.env.SIEVE_DB ?? path.join(process.cwd(), "data", "sieve.db");

function usage(): never {
  console.log(`区间素数分段筛选 CLI
用法: node dist/src/cli.js <命令> [参数]

命令:
  serve [--port N]                 启动 API 服务（默认端口 0 = 自动选空闲端口）
  run <L> <R> <blockSize>          创建并计算区间任务
  list                             列出历史任务
  primes <jobId> [offset] [limit]  分页读取素数
  explain <jobId> <n>              解释 n 为何是素数/被剔除
  export <jobId> <json|txt> <file> 导出结果到文件（不在终端打印）
  demo                             运行演示`);
  process.exit(1);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) usage();
  const store = new Store(DB_PATH);

  if (cmd === "serve") {
    const pi = args.indexOf("--port");
    const port = pi >= 0 ? Number(args[pi + 1]) : Number(process.env.PORT ?? 0);
    const { port: actual } = await startServer(store, port);
    console.log(`API 服务已启动: http://127.0.0.1:${actual}`);
    return;
  }
  if (cmd === "run") {
    const [L, R, bs] = args.map(Number);
    const job = store.createAndRun(L, R, bs);
    console.log(JSON.stringify(job, null, 2));
    process.exit(job.status === "done" ? 0 : 2);
  }
  if (cmd === "list") {
    for (const j of store.listJobs()) {
      console.log(`#${j.id} [${j.L}, ${j.R}] block=${j.block_size} ${j.status} count=${j.prime_count ?? "-"} ${j.error ?? ""}`);
    }
    return;
  }
  if (cmd === "primes") {
    const [id, offset = "0", limit = "100"] = args;
    const r = store.getPrimes(Number(id), Number(limit), Number(offset));
    console.log(`total=${r.total} offset=${offset} 返回 ${r.items.length} 个:`);
    console.log(r.items.join(" "));
    return;
  }
  if (cmd === "explain") {
    const [id, n] = args;
    try {
      const e = store.explain(Number(id), Number(n));
      console.log(JSON.stringify(e, null, 2));
    } catch (err) {
      console.error(`错误: ${err instanceof Error ? err.message : err}`);
      process.exit(2);
    }
    return;
  }
  if (cmd === "export") {
    const [id, format = "json", file] = args;
    if (!file) { console.error("必须指定输出文件，避免在终端打印大量内容"); process.exit(2); }
    const job = store.getJob(Number(id));
    if (!job || job.status !== "done") { console.error("任务不存在或未成功完成"); process.exit(2); }
    const out = fs.createWriteStream(file);
    if (format === "txt") {
      for (const p of store.iteratePrimes(job.id)) out.write(`${p}\n`);
    } else if (format === "json") {
      out.write(JSON.stringify({ job, primes: [] as number[] }).replace("]", ""));
      let first = true;
      for (const p of store.iteratePrimes(job.id)) { out.write((first ? "" : ",") + String(p)); first = false; }
      out.write("]}");
    } else { console.error("format 仅支持 json 或 txt"); process.exit(2); }
    out.end();
    console.log(`已导出到 ${file}`);
    return;
  }
  if (cmd === "demo") {
    const j1 = store.createAndRun(0, 30, 7);
    console.log(`[0,30] 块大小 7: ${j1.prime_count} 个素数`);
    console.log("  ", store.getPrimes(j1.id, 100, 0).items.join(" "));
    console.log("  解释 28:", store.explain(j1.id, 28).reason);
    console.log("  解释 29:", store.explain(j1.id, 29).reason);
    console.log("  解释 1:", store.explain(j1.id, 1).reason);
    const j2 = store.createAndRun(9_999_000_000, 9_999_001_000, 500);
    console.log(`[9999000000, 9999001000] 块大小 500: ${j2.prime_count} 个素数`);
    console.log("  ", store.getPrimes(j2.id, 100, 0).items.join(" "));
    const j3 = store.createAndRun(0, 30, 4);
    console.log(`[0,30] 块大小 4（独立记录 #${j3.id}）: ${j3.prime_count} 个素数，结果与 #${j1.id} 一致: ${
      JSON.stringify(store.getPrimes(j1.id, 100, 0).items) === JSON.stringify(store.getPrimes(j3.id, 100, 0).items)}`);
    return;
  }
  usage();
}

main().catch((e) => { console.error(e); process.exit(1); });
