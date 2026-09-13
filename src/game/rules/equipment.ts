import { gameConfig } from '../config/gameConfig';

/**
 * 装备消耗规则（帐篷 / 指南针）。
 * 帐篷以剩余沙漠耐久数组表示，例如 [3, 1] 表示两顶，剩余 3 与 1 次。
 * 确定性规则：需要消耗时总是选取当前剩余耐久最低的一顶。
 */

/** 沙尘暴中使用帐篷：耐久 -1，归零整顶消失 */
export function consumeTentForSandstorm(tents: number[]): number[] {
  if (tents.length === 0) throw new Error('没有帐篷可消耗');
  const next = [...tents];
  let idx = 0;
  for (let i = 1; i < next.length; i++) {
    if (next[i] < next[idx]) idx = i;
  }
  next[idx] -= 1;
  if (next[idx] <= 0) next.splice(idx, 1);
  return next;
}

/** 草地暴雨中使用帐篷：无论剩余耐久多少，整顶立即消耗 */
export function consumeTentForRainstorm(tents: number[]): number[] {
  if (tents.length === 0) throw new Error('没有帐篷可消耗');
  const next = [...tents];
  let idx = 0;
  for (let i = 1; i < next.length; i++) {
    if (next[i] < next[idx]) idx = i;
  }
  next.splice(idx, 1);
  return next;
}

export function tentLabel(tents: number[]): string {
  if (tents.length === 0) return '无';
  return tents.map((c) => `${c}/${gameConfig.tentDesertCharges}`).join(', ');
}
