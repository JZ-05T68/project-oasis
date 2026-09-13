import { gameConfig } from '../config/gameConfig';

/**
 * 装备消耗规则（v0.1.2a：帐篷逐顶管理，玩家指明使用哪一顶）。
 *
 * 每顶帐篷独立记录剩余沙漠耐久，例如 [3, 1] 表示 Tent A 3/3、Tent B 1/3。
 * 任何消耗都必须由调用方传入具体下标，系统绝不自动选择：
 * - 普通消耗（宿营/沙尘暴/绿洲修整/矿区等待）：耐久 -1，归零整顶消失；
 * - 草地暴雨：无论剩余耐久多少，整顶立即报废。
 */

function assertIndex(tents: number[], tentIndex: number | undefined): number {
  if (tents.length === 0) throw new Error('没有帐篷可消耗');
  if (tentIndex === undefined || !Number.isInteger(tentIndex)) {
    throw new Error('必须指明使用哪一顶帐篷');
  }
  if (tentIndex < 0 || tentIndex >= tents.length) {
    throw new Error(`帐篷编号无效：${tentIndex}`);
  }
  return tentIndex;
}

/** 普通消耗：指定帐篷耐久 -1，归零整顶消失 */
export function consumeTentCharge(tents: number[], tentIndex: number | undefined): number[] {
  const idx = assertIndex(tents, tentIndex);
  const next = [...tents];
  next[idx] -= 1;
  if (next[idx] <= 0) next.splice(idx, 1);
  return next;
}

/** 草地暴雨：指定帐篷整顶立即报废（无论剩余耐久） */
export function consumeTentForRainstorm(tents: number[], tentIndex: number | undefined): number[] {
  const idx = assertIndex(tents, tentIndex);
  const next = [...tents];
  next.splice(idx, 1);
  return next;
}

/** 帐篷展示名（A/B/C… 按持有顺序） */
export function tentName(index: number): string {
  return `Tent ${String.fromCharCode(65 + index)}`;
}

/** 逐顶展示：如 "A 3/3、B 1/3"；无帐篷返回 "无" */
export function tentLabel(tents: number[]): string {
  if (tents.length === 0) return '无';
  return tents
    .map((c, i) => `${tentName(i).slice(5)} ${c}/${gameConfig.tentDesertCharges}`)
    .join('、');
}

/** Bot/测试默认策略：优先使用剩余耐久最低的一顶（残值损失最小） */
export function lowestDurabilityIndex(tents: number[]): number {
  if (tents.length === 0) throw new Error('没有帐篷可消耗');
  let idx = 0;
  for (let i = 1; i < tents.length; i++) {
    if (tents[i] < tents[idx]) idx = i;
  }
  return idx;
}
