# 区间素数分段筛选服务

这是一个只包含后端 API 与 CLI 的 Windows 本地服务，用 TypeScript、Node.js 和 SQLite 实现。它对闭区间 `[L,R]` 执行自行编写的分段埃拉托斯特尼筛，保存素数结果，并解释区间内某个合数为什么被剔除。

不包含前端、Docker、WSL、在线 API、密码学大素数生成、随机素性检验或完整整数分解。

## 环境要求

- Windows 本地 Node.js 22.5 或更新版本；开发验证使用 Node.js 25.5.0。
- SQLite 使用 Node 内置的 `node:sqlite`（当前 Node 会输出 experimental warning，不影响运行）。
- 依赖仅包含 TypeScript 与 Node 类型定义。

## 范围与校验

输入必须是安全范围内的非负整数：

- `R <= 10,000,000,000`（一百亿）。
- 闭区间长度 `R-L+1 <= 1,000,000`。
- `1 <= blockSize <= 1,000,000`。
- 小数、科学计数法文本、负数、非数字文本、`L>R` 或超界请求会在计算前拒绝。

超限输入不会产生 `complete` 成功报告。计算异常会把执行记录标成 `failed`，不会写入看似完整的部分素数计数。

## 构建、测试、启动

```powershell
npm install
npm run build
npm test
npm start
```

默认 `PORT=0`，服务会让操作系统选择空闲端口，启动日志会显示实际地址，例如 `http://127.0.0.1:53124`。需要固定端口时：

```powershell
$env:PORT="3000"
npm start
```

数据默认存放在项目内的 `data/prime-runs.sqlite`。也可以设置：

```powershell
$env:PRIME_DATA_DIR="$PWD\data"
```

## 算法说明

1. 计算 `sqrt(R)`，用普通埃氏筛取得所有不超过 `sqrt(R)` 的基素数。
2. 不分配 `0..R` 的大数组，只为当前闭区间分配长度 `R-L+1` 的标记。
3. 按 `blockSize` 将闭区间分成多个块；块大小可以是 1，也可以不整除区间长度，最后一块允许更短。
4. 对每个基素数 `p`，在每块的起始标记位置为：

```text
max(p², 不小于该块起点的最小 p 倍数)
```

因此当低端区间包含 `p` 本身时，不会把 `p` 划掉；当块边界或标记起点恰为 `p²` 时，平方边界会被纳入。
5. 从起始位置开始按步长 `p` 标记，直到当前块闭区间终点。
6. `0` 和 `1` 单独按非素数定义处理，不虚构素因子。
7. 收集未标记数，按升序输出。

内存主要由两部分决定：

- 基素数筛数组长度约为 `sqrt(R)+1`，例如 `R=10^10` 时约为 `100,001`，而不是 `10,000,000,001`。
- 分段标记数组长度为区间长度，当前上限为 `1,000,001`。

因此内存与 `sqrt(R)` 和区间长度有关，不与 `R` 本身成正比。`blockSize` 是执行分块参数，只影响分块数与倍数循环的局部组织；所有块仍覆盖同一闭区间，所以返回的素数集合、数量和顺序不随块大小改变。同一区间使用不同块大小会保存为独立执行记录，可比较摘要。

## HTTP API

### 创建并计算

```http
POST /runs
Content-Type: application/json

{"l":0,"r":30,"blockSize":7}
```

`blockSize` 省略时默认 `100000`。

### 读取报告

```http
GET /runs/{id}
GET /runs/{id}/primes?limit=100&offset=0
GET /runs/{id}/explain?number=49
GET /runs?limit=20&offset=0
```

只有状态为 `complete` 的记录才能读取成功报告、分页、解释或导出。

### 导出

```http
GET /runs/{id}/export?format=txt
GET /runs/{id}/export?format=jsonl
GET /runs/{id}/export?format=json
```

接口使用流式响应，不要求一次性把全部文本放入内存。

### 错误格式

```json
{"error":{"code":"INVALID_INTEGER","message":"l 必须是非负整数..."}}
```

常用错误码：`INVALID_INTEGER`、`INVALID_RANGE`、`RANGE_TOO_LARGE`、`INTERVAL_TOO_LONG`、`INVALID_BLOCK_SIZE`、`BLOCK_SIZE_TOO_LARGE`、`NOT_FOUND`、`RUN_NOT_COMPLETE`、`NUMBER_OUTSIDE_RANGE`、`UNSUPPORTED_MEDIA`。

## CLI

```powershell
node dist/src/cli.js create 0 30 7
node dist/src/cli.js history
node dist/src/cli.js get <id>
node dist/src/cli.js primes <id> --limit 100 --offset 0
node dist/src/cli.js explain <id> 49
node dist/src/cli.js export <id> --format txt > primes.txt
node dist/src/cli.js export <id> --format jsonl > primes.jsonl
node dist/src/cli.js export <id> --format json --out report.json
node dist/src/cli.js compare-blocks --l 1 --r 200 --blockSizeA 1 --blockSizeB 37
node dist/src/cli.js demo
```

为避免大量结果一次刷屏，`txt/jsonl` 导出需要重定向或 `--out`；JSON 摘要使用 `--out` 写入文件。

## 已验证示例

- `[0,30]`：10 个素数。
- `[2,2]`：只含 2。
- `[49,49]`：素数结果为空；49 可由基素数 7 整除，`49 = 7 × 7`。
- `[1,1000000]`：78498 个素数。
- 多个小区间与独立试除法逐项比较。
- 覆盖块大小 1、块大小不整除区间长度、最后短块、块边界恰为 `p²`、低端包含基素数、空结果和单元素区间。
- 同一区间更换块大小，素数结果完全一致。
- 每个返回的合数因子都验证为实际整除数。
- 较大起点小区间演示为 `[999999000,1000000000]`；CLI 演示后可重启，再用 `history/get/primes` 从 SQLite 读取。

## 限制

- 这是教学/分析型整数区间服务，不用于密码学素数选择。
- 为了保证运行时间和本地资源可预测，当前硬性拒绝超过一百亿、超过一百万区间长度或超过一百万块大小的请求。
- 合数解释只返回一个在分段筛中实际使用的必要基素数因子及倍数关系，不输出完整因子分解，也不枚举全部标记操作。
