import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { segmentedSieve, explainNumber, trialDivisionPrimes, basePrimes, isqrt } from "../src/sieve";
import { validateRange, ApiError } from "../src/validate";
import { Store } from "../src/store";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`ok - ${name}`); }
  catch (e) { console.error(`FAIL - ${name}`); console.error(e); process.exit(1); }
}

// 基础用例
test("[0,30] 十个素数", () => {
  const r = segmentedSieve(0, 30, 7);
  assert.deepEqual(r.primes, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  assert.equal(r.primes.length, 10);
  assert.equal(r.blockCount, 5);
});
test("[2,2] 只含 2", () => {
  assert.deepEqual(segmentedSieve(2, 2, 1).primes, [2]);
});
test("[49,49] 为空，因子为 7", () => {
  assert.deepEqual(segmentedSieve(49, 49, 1).primes, []);
  const e = explainNumber(49, 49, 49, 1);
  assert.equal(e.kind, "composite");
  if (e.kind === "composite") { assert.equal(e.factor, 7); assert.equal(49 % e.factor, 0); }
});
test("[1,1000000] 素数数量为 78498", () => {
  const r = segmentedSieve(1, 1_000_000, 100_000);
  assert.equal(r.primes.length, 78498);
});

// 与独立试除法对比多个小区间
test("小区间与试除法一致", () => {
  const cases: [number, number][] = [
    [0, 0], [0, 1], [1, 1], [0, 2], [2, 2], [3, 3], [4, 4],
    [0, 100], [90, 120], [48, 50], [49, 49], [121, 121], [120, 130],
    [2, 3], [997, 1009], [529, 529], [23, 29],
  ];
  for (const [L, R] of cases) {
    for (const bs of [1, 2, 3, 7, 1000]) {
      const got = segmentedSieve(L, R, bs).primes;
      assert.deepEqual(got, trialDivisionPrimes(L, R), `[${L},${R}] bs=${bs}`);
    }
  }
});

// 块边界恰为 p^2
test("块边界恰为 p^2 时平方被纳入", () => {
  // p=5, p^2=25，块 [25, 29] 起点即 25，必须被划除
  const r = segmentedSieve(25, 29, 5);
  assert.deepEqual(r.primes, [29]);
  // p=7, p^2=49 作为块起点
  const r2 = segmentedSieve(49, 55, 7);
  assert.deepEqual(r2.primes, [53]);
});

// 低端包含基素数本身
test("低端包含基素数本身时不被划掉", () => {
  const r = segmentedSieve(2, 10, 3);
  assert.deepEqual(r.primes, [2, 3, 5, 7]);
  const r2 = segmentedSieve(3, 3, 1);
  assert.deepEqual(r2.primes, [3]);
});

// 空结果 / 单元素 / 块大小一
test("空结果、单元素、块大小一", () => {
  assert.deepEqual(segmentedSieve(0, 1, 1).primes, []);
  assert.deepEqual(segmentedSieve(24, 28, 1).primes, []);
  assert.deepEqual(segmentedSieve(8, 8, 1).primes, []);
  assert.deepEqual(segmentedSieve(13, 13, 1).primes, [13]);
});

// 同一区间不同块大小结果一致
test("同一区间更换块大小结果完全相同", () => {
  const ref = segmentedSieve(0, 5000, 1).primes;
  for (const bs of [2, 3, 7, 64, 999, 5000, 5001]) {
    assert.deepEqual(segmentedSieve(0, 5000, bs).primes, ref, `bs=${bs}`);
  }
});

// 大起点小区间
test("较大起点的小区间", () => {
  const L = 9_999_000_000, R = 9_999_001_000;
  const r = segmentedSieve(L, R, 500);
  assert.ok(r.primes.length > 0);
  for (const p of r.primes) {
    assert.ok(p >= L && p <= R);
    for (const bp of basePrimes(isqrt(R))) {
      if (bp * bp > p) break;
      assert.notEqual(p % bp, 0);
    }
  }
  const e = explainNumber(L, L, R, 500);
  assert.equal(e.kind, "composite");
  if (e.kind === "composite") assert.equal(L % e.factor, 0);
});

// 解释一致性：合数因子确实整除，素数确实在结果中
test("解释与筛选结果一致", () => {
  const L = 100, R = 500, bs = 37;
  const primes = new Set(segmentedSieve(L, R, bs).primes);
  for (let n = L; n <= R; n++) {
    const e = explainNumber(n, L, R, bs);
    if (primes.has(n)) assert.equal(e.kind, "prime", `n=${n}`);
    else {
      assert.equal(e.kind, "composite", `n=${n}`);
      if (e.kind === "composite") {
        assert.equal(n % e.factor, 0);
        assert.equal(e.factor * e.quotient, n);
        assert.ok(n >= e.blockStart && n <= e.blockEnd);
      }
    }
  }
  const e0 = explainNumber(0, 0, 10, 3);
  const e1 = explainNumber(1, 0, 10, 3);
  assert.equal(e0.kind, "not-prime-by-definition");
  assert.equal(e1.kind, "not-prime-by-definition");
});

// 参数校验
test("非法范围与小数被拒绝", () => {
  const bad: [unknown, unknown, unknown][] = [
    [5, 1, 10], [0, 10_000_000_001, 10], [0, 1_000_001, 10],
    [0, 10, 0], [0, 10, 1_000_001], [0.5, 10, 10], [0, 10, 1.5],
    [-1, 10, 10], [0, -5, 10], ["a", 10, 10], [0, 10, null],
  ];
  for (const [L, R, bs] of bad) {
    assert.throws(() => validateRange(L, R, bs), ApiError, JSON.stringify([L, R, bs]));
  }
  assert.doesNotThrow(() => validateRange(0, 30, 7));
  assert.doesNotThrow(() => validateRange(9_999_999_000, 10_000_000_000, 1_000_000));
});

// 存储层：持久化、失败状态、独立记录
test("SQLite 持久化与失败状态", () => {
  const dbPath = path.join(__dirname, "..", "data", "test-store.db");
  fs.rmSync(dbPath, { force: true });
  let store = new Store(dbPath);
  const j1 = store.createAndRun(0, 30, 7);
  assert.equal(j1.status, "done");
  assert.equal(j1.prime_count, 10);
  // 同一区间不同块大小 → 独立记录
  const j2 = store.createAndRun(0, 30, 4);
  assert.notEqual(j1.id, j2.id);
  assert.deepEqual(store.getPrimes(j1.id, 100, 0).items, store.getPrimes(j2.id, 100, 0).items);
  // 非法参数不产生任务记录
  const before = store.listJobs().length;
  assert.throws(() => store.createAndRun(0.5, 10, 3));
  assert.throws(() => store.createAndRun(0, 2_000_000, 3));
  assert.equal(store.listJobs().length, before);
  // 分页
  assert.deepEqual(store.getPrimes(j1.id, 3, 0).items, [2, 3, 5]);
  assert.deepEqual(store.getPrimes(j1.id, 3, 3).items, [7, 11, 13]);
  // 模拟重启：重新打开数据库读取历史
  store.close();
  store = new Store(dbPath);
  const again = store.getJob(j1.id)!;
  assert.equal(again.status, "done");
  assert.deepEqual(store.getPrimes(j1.id, 100, 0).items, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  const e = store.explain(j1.id, 28);
  assert.equal(e.kind, "composite");
  if (e.kind === "composite") assert.equal(28 % e.factor, 0);
  store.close();
  fs.rmSync(dbPath, { force: true });
});

console.log(`\n全部 ${passed} 项测试通过`);
