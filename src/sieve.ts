import { ALGORITHM_VERSION, blockBounds, blockIndexOf, type RunParams } from './limits.js';

export interface NumberExplanation {
  number: number;
  classification: 'prime' | 'composite' | 'zero' | 'one';
  message: string;
  divisor?: number;
  quotient?: number;
  blockIndex?: number;
  blockStart?: number;
  blockEnd?: number;
  pSquaredStart?: boolean;
}

export interface SieveResult {
  params: RunParams;
  algorithmVersion: typeof ALGORITHM_VERSION;
  blockCount: number;
  primeCount: number;
  primes: number[];
  explain(n: number): NumberExplanation;
}

export function basePrimesUpTo(limit: number): number[] {
  if (limit < 2) return [];
  const sieve = new Uint8Array(limit + 1);

  for (let p = 2; p * p <= limit; p++) {
    if (!sieve[p]) {
      for (let multiple = p * p; multiple <= limit; multiple += p) {
        sieve[multiple] = 1;
      }
    }
  }

  const primes: number[] = [];
  for (let n = 2; n <= limit; n++) {
    if (!sieve[n]) primes.push(n);
  }
  return primes;
}

function integerSqrt(n: number): number {
  return Math.floor(Math.sqrt(n));
}

export function runSegmentedSieve(params: RunParams): SieveResult {
  const { l, r, blockSize } = params;
  const sqrtR = integerSqrt(r);
  const basePrimes = basePrimesUpTo(sqrtR);
  const totalBlocks = Math.floor((r - l) / blockSize) + 1;
  const primes: number[] = [];

  const isComposite = new Uint8Array(r - l + 1);
  if (l === 0) isComposite[0] = 1;
  if (l <= 1 && r >= 1) isComposite[1 - l] = 1;

  for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
    const { blockStart, blockEnd } = blockBounds(blockIndex, l, r, blockSize);

    for (const p of basePrimes) {
      const firstAtLeastBlockStart = p * Math.ceil(blockStart / p);
      let first = Math.max(p * p, firstAtLeastBlockStart);

      for (let multiple = first; multiple <= blockEnd; multiple += p) {
        isComposite[multiple - l] = 1;
      }
    }
  }

  for (let n = l; n <= r; n++) {
    if (!isComposite[n - l]) primes.push(n);
  }

  function explain(n: number): NumberExplanation {
    if (!Number.isSafeInteger(n) || n < l || n > r) {
      throw new RangeError(`数字 ${n} 不在闭区间 [${l},${r}] 内`);
    }

    const index = blockIndexOf(n, l, blockSize);
    const bounds = blockBounds(index, l, r, blockSize);

    if (n === 0) {
      return {
        number: 0,
        classification: 'zero',
        message: '0 按定义不是素数；这里不把它解释为具有素因子的合数。',
        blockIndex: index,
        blockStart: bounds.blockStart,
        blockEnd: bounds.blockEnd
      };
    }

    if (n === 1) {
      return {
        number: 1,
        classification: 'one',
        message: '1 按定义不是素数；这里不虚构素因子。',
        blockIndex: index,
        blockStart: bounds.blockStart,
        blockEnd: bounds.blockEnd
      };
    }

    if (!isComposite[n - l]) {
      return {
        number: n,
        classification: 'prime',
        message:
          n <= sqrtR
            ? `${n} 是基素数，且筛选只从 p² 开始标记，因此不会被自己或更小的必要基素数划除。`
            : `${n} 未被任何不超过 sqrt(${r})=${sqrtR} 的必要基素数划除，因此是素数。`,
        blockIndex: index,
        blockStart: bounds.blockStart,
        blockEnd: bounds.blockEnd
      };
    }

    for (const p of basePrimes) {
      if (p * p > n) break;
      if (n % p === 0) {
        const quotient = n / p;
        const firstAtLeastBlockStart = p * Math.ceil(bounds.blockStart / p);
        const start = Math.max(p * p, firstAtLeastBlockStart);
        return {
          number: n,
          classification: 'composite',
          message: `${n} 是合数：${n} = ${p} × ${quotient}。分段筛在第 ${index} 块 [${bounds.blockStart},${bounds.blockEnd}] 中用基素数 ${p} 的倍数标记了它。`,
          divisor: p,
          quotient,
          blockIndex: index,
          blockStart: bounds.blockStart,
          blockEnd: bounds.blockEnd,
          pSquaredStart: start === p * p
        };
      }
    }

    throw new Error(`解释结果与筛选结果不一致：${n} 被标记但未找到整除它的基素数`);
  }

  return {
    params,
    algorithmVersion: ALGORITHM_VERSION,
    blockCount: totalBlocks,
    primeCount: primes.length,
    primes,
    explain
  };
}

export function trialDivisionPrimes(l: number, r: number): number[] {
  const result: number[] = [];
  for (let n = Math.max(2, l); n <= r; n++) {
    let prime = true;
    for (let p = 2; p * p <= n; p++) {
      if (n % p === 0) {
        prime = false;
        break;
      }
    }
    if (prime) result.push(n);
  }
  return result;
}
