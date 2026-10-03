import { MAX_R, MAX_INTERVAL_LEN, MAX_BLOCK_SIZE } from "./sieve";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function checkInt(name: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new ApiError("INVALID_PARAM", `${name} 必须是非负整数，收到: ${JSON.stringify(v)}`);
  }
  if (v < 0) throw new ApiError("INVALID_PARAM", `${name} 不能为负数`);
  if (!Number.isSafeInteger(v)) throw new ApiError("INVALID_PARAM", `${name} 超出安全整数范围`);
  return v;
}

export function validateRange(L: unknown, R: unknown, blockSize: unknown): { L: number; R: number; blockSize: number } {
  const l = checkInt("L", L);
  const r = checkInt("R", R);
  const bs = checkInt("blockSize", blockSize);
  if (l > r) throw new ApiError("INVALID_RANGE", `要求 L <= R，收到 L=${l}, R=${r}`);
  if (r > MAX_R) throw new ApiError("RANGE_TOO_LARGE", `R 不能超过 ${MAX_R}（一百亿）`);
  if (r - l + 1 > MAX_INTERVAL_LEN) throw new ApiError("INTERVAL_TOO_LONG", `区间长度不能超过 ${MAX_INTERVAL_LEN}`);
  if (bs < 1) throw new ApiError("INVALID_BLOCK", "blockSize 必须 >= 1");
  if (bs > MAX_BLOCK_SIZE) throw new ApiError("INVALID_BLOCK", `blockSize 不能超过 ${MAX_BLOCK_SIZE}`);
  return { L: l, R: r, blockSize: bs };
}
