import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runSegmentedSieve, trialDivisionPrimes } from '../src/sieve.js';
import { validateParams, ValidationError } from '../src/limits.js';
import { PrimeRunStore } from '../src/store.js';
import { createApp } from '../src/http.js';

describe('segmented sieve', () => {
  it('returns ten primes for [0,30]', () => {
    const result = runSegmentedSieve({ l: 0, r: 30, blockSize: 7 });
    assert.deepEqual(result.primes, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
    assert.equal(result.primeCount, 10);
    assert.equal(result.blockCount, 5);
  });

  it('supports singleton prime, singleton composite, zero, one and block size one', () => {
    assert.deepEqual(runSegmentedSieve({ l: 2, r: 2, blockSize: 1 }).primes, [2]);
    assert.deepEqual(runSegmentedSieve({ l: 49, r: 49, blockSize: 1 }).primes, []);
    assert.deepEqual(runSegmentedSieve({ l: 0, r: 1, blockSize: 1 }).primes, []);
  });

  it('covers p squared exactly on a block boundary and primes at low end', () => {
    const result = runSegmentedSieve({ l: 0, r: 64, blockSize: 25 });
    assert.ok(!result.primes.includes(25));
    assert.ok(!result.primes.includes(49));
    assert.ok(result.primes.includes(2));
    assert.ok(result.primes.includes(5));
    assert.deepEqual(result.primes, trialDivisionPrimes(0, 64));

    const explanation = result.explain(49);
    assert.equal(explanation.classification, 'composite');
    assert.equal(explanation.divisor, 7);
    assert.equal(49 % (explanation.divisor ?? 1), 0);
    assert.equal(explanation.quotient, 7);
  });

  it('matches independent trial division for many small intervals and block sizes', () => {
    const intervals: Array<[number, number]> = [
      [0, 0], [1, 1], [2, 2], [3, 3], [4, 4],
      [0, 50], [10, 60], [47, 53], [100, 200], [1, 2]
    ];
    for (const [l, r] of intervals) {
      const expected = trialDivisionPrimes(l, r);
      for (const blockSize of [1, 2, 7, 31, 1000]) {
        const result = runSegmentedSieve({ l, r, blockSize });
        assert.deepEqual(result.primes, expected, `[${l},${r}] block ${blockSize}`);
        assert.equal(result.primeCount, expected.length);
      }
    }
  });

  it('counts 78498 primes in [1,1000000]', () => {
    const result = runSegmentedSieve({ l: 1, r: 1_000_000, blockSize: 100_000 });
    assert.equal(result.primeCount, 78498);
    assert.deepEqual(result.primes, trialDivisionPrimes(1, 1_000_000));
  });

  it('keeps explanations consistent with stored results', () => {
    const result = runSegmentedSieve({ l: 0, r: 200, blockSize: 13 });
    for (const n of result.primes) {
      const explanation = result.explain(n);
      assert.equal(explanation.classification, 'prime');
      assert.equal(explanation.divisor, undefined);
    }
    for (let n = 4; n <= 200; n++) {
      if (!result.primes.includes(n)) {
        const explanation = result.explain(n);
        assert.equal(explanation.classification, 'composite');
        assert.ok(explanation.divisor && n % explanation.divisor === 0);
        assert.equal(explanation.quotient, n / explanation.divisor);
      }
    }
    assert.equal(result.explain(0).classification, 'zero');
    assert.equal(result.explain(1).classification, 'one');
  });

  it('rejects invalid and oversized ranges before computing', () => {
    assert.throws(() => validateParams({ l: 1.5, r: 10 }), ValidationError);
    assert.throws(() => validateParams({ l: '1.1', r: 10 }), ValidationError);
    assert.throws(() => validateParams({ l: 10, r: 9 }), ValidationError);
    assert.throws(() => validateParams({ l: 0, r: 10_000_000_001 }), ValidationError);
    assert.throws(() => validateParams({ l: 0, r: 1_000_001 }), ValidationError);
    assert.throws(() => validateParams({ l: 0, r: 10, blockSize: 0 }), ValidationError);
    assert.throws(() => validateParams({ l: 0, r: 10, blockSize: 1_000_001 }), ValidationError);
  });
});

describe('SQLite store and HTTP API', () => {
  it('persists completed reports, paginates and keeps block-size runs independent', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'prime-runs-'));
    const dbPath = path.join(dir, 'test.sqlite');
    const store = new PrimeRunStore(dbPath);

    const a = store.createAndCompute({ l: 0, r: 100, blockSize: 7 });
    const b = store.createAndCompute({ l: 0, r: 100, blockSize: 13 });
    assert.equal(a.status, 'complete');
    assert.equal(b.status, 'complete');
    assert.notEqual(a.id, b.id);
    assert.equal(a.primeCount, b.primeCount);

    const pageOne = store.getPrimePage(a.id, 5, 0);
    const pageTwo = store.getPrimePage(a.id, 5, 5);
    assert.equal(pageOne.total, 25);
    assert.deepEqual([...pageOne.primes, ...pageTwo.primes], trialDivisionPrimes(0, 100).slice(0, 10));
    assert.equal(store.explain(a.id, 100).explanation.divisor, 2);
    store.close();

    const reopened = new PrimeRunStore(dbPath);
    assert.equal(reopened.getRunOrThrow(a.id).primeCount, 25);
    assert.equal(reopened.getPrimePage(a.id, 1, 24).primes[0], 97);
    reopened.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('exposes HTTP endpoints and rejects decimals without success reports', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'prime-api-'));
    const store = new PrimeRunStore(path.join(dir, 'test.sqlite'));
    const server = createApp(store).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ l: 0, r: 30, blockSize: 7 })
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as { run: { id: number; primeCount: number } };
    assert.equal(created.run.primeCount, 10);

    const primesResponse = await fetch(`http://127.0.0.1:${port}/runs/${created.run.id}/primes?limit=3`);
    const primes = (await primesResponse.json()) as { primes: number[] };
    assert.deepEqual(primes.primes, [2, 3, 5]);

    const explainResponse = await fetch(`http://127.0.0.1:${port}/runs/${created.run.id}/explain?number=30`);
    const explanation = (await explainResponse.json()) as { explanation: { divisor?: number } };
    assert.equal(explanation.explanation.divisor, 2);

    const invalid = await fetch(`http://127.0.0.1:${port}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ l: 0.5, r: 10 })
    });
    assert.equal(invalid.status, 400);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.equal(store.list().filter((run) => run.status === 'complete').length, 1);
    assert.equal(store.list().filter((run) => run.status === 'failed').length, 1);
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});
