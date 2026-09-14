import { gameConfig } from '../config/gameConfig';
import { GameError } from '../types';
import type { TentId, TentItem } from '../types';

/**
 * 装备消耗规则（v0.1.2b：帐篷逐顶管理，稳定唯一 ID）。
 *
 * 每顶帐篷拥有稳定唯一 ID（tent-001 / tent-002 …）与独立的剩余沙漠耐久，
 * 例如 `[{id:'tent-001',charges:3},{id:'tent-002',charges:1}]` 表示 Tent A 3/3、Tent B 1/3。
 *
 * 为什么必须用 ID 而不是 array index：
 * 帐篷会被消耗（耐久归零）或被暴雨整顶报废，随后列表会重新排列；
 * 若 UI 用下标绑定，状态更新后下标会指向错误的帐篷。
 * 因此任何消耗都必须由调用方传入具体 TentId，系统绝不按位置自动选择。
 *
 * - 普通消耗（宿营/沙尘暴/绿洲修整/矿区等待）：耐久 -1，归零整顶消失；
 * - 草地暴雨：无论剩余耐久多少，整顶立即报废。
 */

export const TENT_ID_PREFIX = 'tent-';

/** 序号 → 稳定 TentId（001 起，三位补零） */
export function tentIdOf(serial: number): TentId {
  return `${TENT_ID_PREFIX}${String(serial).padStart(3, '0')}`;
}

/** TentId → 序号（解析失败返回 null） */
export function tentSerialOf(id: TentId): number | null {
  if (typeof id !== 'string' || !id.startsWith(TENT_ID_PREFIX)) return null;
  const n = Number(id.slice(TENT_ID_PREFIX.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** 展示名（由稳定 ID 派生，不随列表位置变化）：tent-001 → "Tent A" */
export function tentName(id: TentId): string {
  const serial = tentSerialOf(id);
  if (serial === null) return String(id);
  const letter = String.fromCharCode(65 + ((serial - 1) % 26));
  const cycle = Math.floor((serial - 1) / 26);
  return cycle === 0 ? `Tent ${letter}` : `Tent ${letter}${cycle + 1}`;
}

/** 按列表顺序创建若干顶全新帐篷（serial 从 startSerial 递增） */
export function createTents(count: number, startSerial: number, charges = gameConfig.tentDesertCharges): TentItem[] {
  const out: TentItem[] = [];
  for (let i = 0; i < count; i++) out.push({ id: tentIdOf(startSerial + i), charges });
  return out;
}

/** 按 TentId 查找帐篷；不存在返回 null */
export function findTent(tents: TentItem[], tentId: TentId | undefined): TentItem | null {
  if (tentId === undefined) return null;
  return tents.find((t) => t.id === tentId) ?? null;
}

/** 校验宿营/消耗时的帐篷选择，返回其在列表中的位置 */
function assertTentId(tents: TentItem[], tentId: TentId | undefined): number {
  if (tents.length === 0) {
    throw new GameError('NO_TENT', '需要帐篷，而你没有帐篷');
  }
  if (tentId === undefined || tentId === null || typeof tentId !== 'string' || tentId === '') {
    throw new GameError('TENT_REQUIRED', '必须先选择一顶具体帐篷');
  }
  const idx = tents.findIndex((t) => t.id === tentId);
  if (idx < 0) {
    throw new GameError('TENT_NOT_FOUND', `找不到帐篷 ${tentId}（可能已被消耗或报废）`);
  }
  return idx;
}

/** 普通消耗：指定帐篷耐久 -1，归零整顶消失 */
export function consumeTentCharge(tents: TentItem[], tentId: TentId | undefined): TentItem[] {
  const idx = assertTentId(tents, tentId);
  const next = tents.map((t) => ({ ...t }));
  next[idx].charges -= 1;
  if (next[idx].charges <= 0) next.splice(idx, 1);
  return next;
}

/** 草地暴雨：指定帐篷整顶立即报废（无论剩余耐久） */
export function consumeTentForRainstorm(tents: TentItem[], tentId: TentId | undefined): TentItem[] {
  const idx = assertTentId(tents, tentId);
  const next = tents.map((t) => ({ ...t }));
  next.splice(idx, 1);
  return next;
}

/** 逐顶展示：如 "A 3/3、B 1/3"；无帐篷返回 "无" */
export function tentLabel(tents: TentItem[]): string {
  if (tents.length === 0) return '无';
  return tents
    .map((t) => `${tentName(t.id).slice(5)} ${t.charges}/${gameConfig.tentDesertCharges}`)
    .join('、');
}

/** 剩余耐久合计 */
export function totalTentCharges(tents: TentItem[]): number {
  return tents.reduce((s, t) => s + t.charges, 0);
}

/** Bot/测试默认策略：优先使用剩余耐久最低的一顶（残值损失最小）；无帐篷返回 undefined */
export function lowestDurabilityTentId(tents: TentItem[]): TentId | undefined {
  if (tents.length === 0) return undefined;
  let best = tents[0];
  for (const t of tents) {
    if (t.charges < best.charges) best = t;
  }
  return best.id;
}
