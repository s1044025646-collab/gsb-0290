export const MAX_R = 10_000_000_000;
export const MAX_INTERVAL_LENGTH = 1_000_000;
export const MAX_BLOCK_SIZE = 1_000_000;
export const MIN_BLOCK_SIZE = 1;

export const ALGORITHM_VERSION = 'segmented-sieve-ts-v1';

export type ErrorCode =
  | 'INVALID_INTEGER'
  | 'INVALID_RANGE'
  | 'RANGE_TOO_LARGE'
  | 'INTERVAL_TOO_LONG'
  | 'INVALID_BLOCK_SIZE'
  | 'BLOCK_SIZE_TOO_LARGE'
  | 'NOT_FOUND'
  | 'RUN_NOT_COMPLETE'
  | 'NUMBER_OUTSIDE_RANGE'
  | 'UNSUPPORTED_MEDIA'
  | 'CONFLICT';

export class ValidationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export interface RangeInput {
  l: number;
  r: number;
  blockSize: number;
}

export interface RunParams {
  l: number;
  r: number;
  blockSize: number;
}

function toNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value === 'string' && value.trim() !== '') {
    const text = value.trim();
    if (!/^\d+$/.test(text)) {
      throw new ValidationError(
        'INVALID_INTEGER',
        `${fieldName} 必须是非负整数，不能是小数、科学计数法或其他非整数文本`
      );
    }
    value = text;
  }

  if (typeof value === 'boolean' || value === null || value === '') {
    throw new ValidationError('INVALID_INTEGER', `${fieldName} 必须是非负整数`);
  }

  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ValidationError('INVALID_INTEGER', `${fieldName} 必须是安全范围内的非负整数`);
  }
  return n;
}

export function validateParams(input: {
  l?: unknown;
  r?: unknown;
  blockSize?: unknown;
}): RunParams {
  const l = toNonNegativeInteger(input.l, 'l');
  const r = toNonNegativeInteger(input.r, 'r');
  const rawBlockSize = input.blockSize === undefined || input.blockSize === '' ? 100_000 : input.blockSize;
  const blockSize = toNonNegativeInteger(rawBlockSize, 'blockSize');

  if (l > r) {
    throw new ValidationError('INVALID_RANGE', 'l 不能大于 r；输入按闭区间 [l,r] 处理');
  }
  if (r > MAX_R) {
    throw new ValidationError(
      'RANGE_TOO_LARGE',
      `r 不能超过 ${MAX_R}（一百亿），以保证计算前完成资源边界校验`
    );
  }

  const intervalLength = r - l + 1;
  if (intervalLength > MAX_INTERVAL_LENGTH) {
    throw new ValidationError(
      'INTERVAL_TOO_LONG',
      `闭区间长度不能超过 ${MAX_INTERVAL_LENGTH.toLocaleString('en-US')}`
    );
  }

  if (blockSize < MIN_BLOCK_SIZE) {
    throw new ValidationError('INVALID_BLOCK_SIZE', `blockSize 不能小于 ${MIN_BLOCK_SIZE}`);
  }
  if (blockSize > MAX_BLOCK_SIZE) {
    throw new ValidationError(
      'BLOCK_SIZE_TOO_LARGE',
      `blockSize 不能超过 ${MAX_BLOCK_SIZE.toLocaleString('en-US')}`
    );
  }

  return { l, r, blockSize };
}

export function blockCount(l: number, r: number, blockSize: number): number {
  return Math.floor((r - l) / blockSize) + 1;
}

export function blockIndexOf(value: number, l: number, blockSize: number): number {
  return Math.floor((value - l) / blockSize);
}

export function blockBounds(
  index: number,
  l: number,
  r: number,
  blockSize: number
): { blockStart: number; blockEnd: number } {
  const blockStart = l + index * blockSize;
  const blockEnd = Math.min(r, blockStart + blockSize - 1);
  return { blockStart, blockEnd };
}
