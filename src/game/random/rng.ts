/**
 * 可复现随机数：xmur3 字符串散列 + mulberry32 PRNG。
 * rngState 是 uint32 内部状态，保存在 GameState 中即可序列化与复现。
 */

/** 将字符串 Seed 散列为 uint32 初始状态 */
export function hashSeed(seed: string): number {
  // xmur3
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 从 uint32 状态推进一步，返回 [0,1) 随机数与新状态 */
export function nextRandom(state: number): [number, number] {
  // mulberry32
  let t = (state + 0x6d2b79f5) | 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return [value, t >>> 0];
}

/** 生成随机 Seed 字符串（开发模式之外的新游戏用） */
export function randomSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
