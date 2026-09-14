import type { GameState, TileId } from '../types';
import { bfsPath, isNormalTile } from '../map/grid';
import { returnViaFilterExcept } from './movement';

/**
 * v0.1.2a 提前判负裁判（内部信息，绝不向玩家展示数值）。
 *
 * 持续判断：以当前足迹、当前阶段与剩余时间，是否仍存在一条
 * 符合全部规则、能在剩余时间内完成的合法方案。
 *
 * 保守性设计：出界检查使用「乐观下界」——
 * 去程用最短路（忽略新去程对返程的烧格影响），因此
 * lowerBound ≤ 真实最短合法完成天数，绝不会误判必败。
 * 返程/矿区阶段使用精确 BFS（烧格集合已完全确定）。
 *
 * v0.1.2b 修正：返程通行的矿区豁免必须与 `getLegalMoves` 完全一致——
 * 当前矿区可穿透（豁免），只有另一座矿区不可作为通路。
 * 修正前两座矿区都被当作不可通行节点，会把
 * 「离开矿区后需要再次穿过当前矿区绕行」的合法局面误判为 NO_LEGAL_ROUTE。
 */

export type ViabilityVerdict =
  | { ok: true }
  | { ok: false; reason: 'NO_LEGAL_ROUTE' | 'INSUFFICIENT_TIME' };

export function evaluateViability(state: GameState): ViabilityVerdict {
  if (state.status !== 'ONGOING') return { ok: true };
  const remaining = state.maxDays - state.daysUsed;
  if (remaining < 0) return { ok: false, reason: 'INSUFFICIENT_TIME' };

  const burned = [...state.visitedOutbound, ...state.visitedReturn].filter((id) =>
    isNormalTile(state.map, id),
  );
  /** 返程/矿区阶段：当前矿区豁免、其它矿区禁行（与 getLegalMoves 一致） */
  const returnFilter = returnViaFilterExcept(state.map, state.mineEntranceId);

  if (state.phase === 'RETURN') {
    const d = bfsPath(state.map, state.position, state.map.cityId, burned, returnFilter);
    if (!d) return { ok: false, reason: 'NO_LEGAL_ROUTE' };
    if (d.length - 1 > remaining) return { ok: false, reason: 'INSUFFICIENT_TIME' };
    return { ok: true };
  }

  if (state.phase === 'MINING') {
    // 挖矿 0 天立即返程是合法选项：从当前矿区回城即可
    const d = bfsPath(state.map, state.position, state.map.cityId, burned, returnFilter);
    if (!d) return { ok: false, reason: 'NO_LEGAL_ROUTE' };
    if (d.length - 1 > remaining) return { ok: false, reason: 'INSUFFICIENT_TIME' };
    return { ok: true };
  }

  // OUTBOUND：对每个矿区做「去程最短 + 乐观返程最短」的下界估计
  let bestLowerBound: number | null = null;
  let anyReachable = false;
  for (const mine of state.map.mines) {
    const mineId = mine.tileId;
    const others = otherMineOf(state, mineId);
    // 去程：不能重走去程普通格、不能中途回城、不能穿过另一个矿区
    const d1 = bfsPath(state.map, state.position, mineId, burnedOutboundOnly(state), (id) => {
      if (id === state.map.cityId) return false; // 去程不允许中途回城
      return !others.includes(id);
    });
    if (!d1) continue;
    anyReachable = true;
    // 乐观返程：只烧掉既有足迹，不烧新去程（下界）；目的矿区豁免，另一矿区禁行
    const d2 = bfsPath(
      state.map,
      mineId,
      state.map.cityId,
      burned,
      returnViaFilterExcept(state.map, mineId),
    );
    if (!d2) continue; // 该矿在乐观口径下都无法返城 → 该方案不可行
    const lower = d1.length - 1 + d2.length - 1;
    if (bestLowerBound === null || lower < bestLowerBound) bestLowerBound = lower;
  }

  if (!anyReachable || bestLowerBound === null) {
    return { ok: false, reason: 'NO_LEGAL_ROUTE' };
  }
  if (bestLowerBound > remaining) {
    return { ok: false, reason: 'INSUFFICIENT_TIME' };
  }
  return { ok: true };
}

function otherMineOf(state: GameState, mineId: TileId): TileId[] {
  return state.map.mines.filter((m) => m.tileId !== mineId).map((m) => m.tileId);
}

function burnedOutboundOnly(state: GameState): TileId[] {
  return state.visitedOutbound.filter((id) => isNormalTile(state.map, id));
}
