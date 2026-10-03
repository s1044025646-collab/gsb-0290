# 区间素数分段筛选与合数剔除解释后端

纯本地后端服务：输入闭区间 `[L, R]`，用**分段埃拉托斯特尼筛**列出区间内全部素数、统计数量，并能解释某个合数为什么被剔除。仅提供 HTTP API 与 CLI，无前端。技术栈：TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，零原生依赖、零外部服务）。

## 运行要求

- Windows 本地，Node.js >= 22.5（建议 24+，开发环境为 Node 25）
- 不需要 Docker / WSL / 网络 / 任何在线 API

## 快速开始

```powershell
npm install        # 仅安装 typescript 与 @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认端口 0 = 自动选择空闲端口）
npm run demo       # 运行演示（[0,30]、大起点小区间、块大小对比）
```

CLI 直接使用：`node dist/src/cli.js <命令>`，或 `npm run cli -- <命令>`。

## 约束与参数校验

- 只处理非负整数；`L <= R`；小数、负数、非数字一律在计算前拒绝（错误码 `INVALID_PARAM` / `INVALID_RANGE`）
- `R <= 100 亿`（`RANGE_TOO_LARGE`）
- 区间长度 `R - L + 1 <= 1,000,000`（`INTERVAL_TOO_LONG`）
- 分块大小 `1 <= blockSize <= 1,000,000`（`INVALID_BLOCK`）
- 所有值都在安全整数范围内，校验通过才会创建任务记录，非法输入不会留下任何任务

## 算法说明

1. 先用普通埃氏筛求出所有不超过 `sqrt(R)` 的**基素数**。
2. 把 `[L, R]` 切成若干块（每块至多 `blockSize` 个，最后一块允许更短），对每块开一个 `blockSize` 大小的标记数组。
3. 对每个基素数 `p`，块内起始标记位置取 `max(p*p, ceil(块起点/p)*p)`：
   - 从 `p*p` 开始是因为更小的倍数已被更小的素数划掉；
   - 这样当 `p` 本身落在区间内时不会被自己划掉；
   - 平方边界（如 25、49）作为块起点时也会被正确划除。
4. 块内未被划除且 `>= 2` 的数即为素数。0 和 1 按定义不是素数。

**内存为什么与 R 不成正比**：任意时刻只持有两块数据——不超过 `sqrt(R)` 的基素数表（R=100 亿时 sqrt 为 10 万，仅约 9592 个素数）和一个 `blockSize` 字节的块标记数组。因此内存占用是 `O(sqrt(R) + blockSize)`，而不是 `O(R)`；从不对 `0..R` 整体分配数组。块大小只是执行参数，不影响返回结果与顺序。

## API

默认监听 `127.0.0.1`，端口可用 `--port` 或环境变量 `PORT` 指定，传 `0` 自动选空闲端口。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查与算法版本 |
| POST | `/jobs` | 创建并计算任务，body: `{"L":0,"R":30,"blockSize":7}` |
| GET | `/jobs` | 历史任务列表（`limit`/`offset`） |
| GET | `/jobs/:id` | 任务报告（范围、块数、素数总数、状态、算法版本） |
| GET | `/jobs/:id/primes?offset=0&limit=100` | 分页读取素数（升序） |
| GET | `/jobs/:id/explain?n=28` | 解释 n：素数说明未被任何必要基素数划除；合数给出一个实际整除它的基素数、倍数关系与所在分块；0/1 按定义解释 |
| GET | `/jobs/:id/export?format=json\|txt` | 流式导出全部素数（JSON 或逐行文本），不在终端打印 |

错误统一返回 `{"error": 错误码, "message": 中文说明}`。

## CLI

```
node dist/src/cli.js serve [--port N]                 启动 API 服务
node dist/src/cli.js run <L> <R> <blockSize>          创建并计算任务
node dist/src/cli.js list                             历史任务
node dist/src/cli.js primes <jobId> [offset] [limit]  分页读取素数
node dist/src/cli.js explain <jobId> <n>              查询剔除原因
node dist/src/cli.js export <jobId> <json|txt> <file> 导出到文件
node dist/src/cli.js demo                             演示
```

## 持久化

- SQLite 数据库保存在项目内 `data/sieve.db`（可用环境变量 `SIEVE_DB` 覆盖）。
- `jobs` 表保存参数、状态、素数总数、块数、算法版本与错误信息；`primes` 表保存每个任务的素数明细。
- 只有状态为 `done` 的任务才能查询成功报告；计算异常时任务标记为 `failed` 并清空部分结果，不会留下看似完整的计数。
- 重启后无需重新筛选即可读取已完成报告；同一区间用不同块大小计算会生成独立记录，可互相比较。

## 测试

`npm test` 覆盖：`[0,30]` 十个素数、`[2,2]`、`[49,49]` 为空且因子为 7、`[1,1000000]` 共 78498 个素数、多个小区间与独立试除法全量对比、块边界恰为 p²、低端含基素数本身、空结果、单元素、块大小一、同区间不同块大小结果一致、解释因子确实整除原数、非法范围与小数被拒绝、SQLite 重启后读取历史。

## 限制

- 单区间最长 100 万、R 最大 100 亿（保证在安全整数内、计算秒级完成）。
- 不做密码学大素数生成、随机素性检验、完整整数分解；解释接口只给出**一个**实际整除的基素数而非完整分解。
- 计算为同步执行，超大区间任务会阻塞事件循环（本地单机工具的可接受取舍）。
- `node:sqlite` 在 Node 25 仍带 Experimental 警告，功能稳定可用。
