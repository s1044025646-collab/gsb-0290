export const ALGO_VERSION = "segmented-eratosthenes/1.0.0";

export const MAX_R = 10_000_000_000;
export const MAX_INTERVAL_LEN = 1_000_000;
export const MAX_BLOCK_SIZE = 1_000_000;

export interface BlockMark {
  prime: number;
  firstMultiple: number;
}

export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while ((r + 1) * (r + 1) <= n) r++;
  while (r * r > n) r--;
  return r;
}

export function basePrimes(limit: number): number[] {
  if (limit < 2) return [];
  const sieve = new Uint8Array(limit + 1);
  const primes: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] === 0) {
      primes.push(i);
      if (i <= limit / i) {
        for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
      }
    }
  }
  return primes;
}

export interface SegmentResult {
  primes: number[];
  blockCount: number;
}

export function segmentedSieve(L: number, R: number, blockSize: number): SegmentResult {
  const primes: number[] = [];
  const bases = basePrimes(isqrt(R));
  const len = R - L + 1;
  const blockCount = Math.ceil(len / blockSize);
  for (let b = 0; b < blockCount; b++) {
    const lo = L + b * blockSize;
    const hi = Math.min(lo + blockSize - 1, R);
    const size = hi - lo + 1;
    const composite = new Uint8Array(size);
    for (const p of bases) {
      if (p * p > hi) break;
      const ceilMultiple = Math.ceil(lo / p) * p;
      let start = Math.max(p * p, ceilMultiple);
      for (let m = start; m <= hi; m += p) composite[m - lo] = 1;
    }
    for (let i = 0; i < size; i++) {
      const n = lo + i;
      if (n >= 2 && composite[i] === 0) primes.push(n);
    }
  }
  return { primes, blockCount };
}

export type Explanation =
  | { kind: "not-prime-by-definition"; n: number; reason: string }
  | { kind: "prime"; n: number; reason: string }
  | {
      kind: "composite";
      n: number;
      factor: number;
      quotient: number;
      blockIndex: number;
      blockStart: number;
      blockEnd: number;
      reason: string;
    };

export function explainNumber(n: number, L: number, R: number, blockSize: number): Explanation {
  if (n < 2) {
    return {
      kind: "not-prime-by-definition",
      n,
      reason: `${n} 按定义不是素数（素数是大于 1 且只有 1 和自身两个正因数的整数），不虚构素因子。`,
    };
  }
  const bases = basePrimes(isqrt(R));
  for (const p of bases) {
    if (p * p > n) break;
    if (n % p === 0) {
      const blockIndex = Math.floor((n - L) / blockSize);
      const blockStart = L + blockIndex * blockSize;
      const blockEnd = Math.min(blockStart + blockSize - 1, R);
      return {
        kind: "composite",
        n,
        factor: p,
        quotient: n / p,
        blockIndex,
        blockStart,
        blockEnd,
        reason: `${n} = ${p} × ${n / p}，基素数 ${p} 在分块 ${blockIndex}（[${blockStart}, ${blockEnd}]）中将其划除。`,
      };
    }
  }
  return {
    kind: "prime",
    n,
    reason: `${n} 未被任何不超过 sqrt(${R}) 的必要基素数划除，因此是素数。`,
  };
}

export function trialDivisionPrimes(L: number, R: number): number[] {
  const out: number[] = [];
  for (let n = Math.max(2, L); n <= R; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) { prime = false; break; }
    }
    if (prime) out.push(n);
  }
  return out;
}
