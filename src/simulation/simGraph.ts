import type { FairMap, FairView } from './fairView';
import { desertExtraDaysForLoad } from '../game/rules/mining';

/**
 * Bot 侧图算法工具：全部只依赖 FairView 的公开信息
 * （格子坐标与四方向拓扑按规则始终可见；地形按战争迷雾过滤）。
 */

/** BFS 最短路（跳数）；起点/终点不受 forbidden 限制 */
export function bfsPath(
  map: FairMap,
  from: string,
  to: string,
  forbidden: Iterable<string> = [],
  nodeFilter?: (id: string) => boolean,
): string[] | null {
  const banned = new Set(forbidden);
  const prev = new Map<string, string | null>([[from, null]]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path: string[] = [];
      let p: string | null = cur;
      while (p !== null) {
        path.unshift(p);
        p = prev.get(p) ?? null;
      }
      return path;
    }
    for (const nb of map.neighbors(cur)) {
      if (prev.has(nb)) continue;
      if (banned.has(nb) && nb !== to) continue;
      if (nodeFilter && !nodeFilter(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  return null;
}

/** 从目标出发的 BFS 距离场（含目标自身 = 0）。目标不可达时返回 null。
 *  用于「不绕远路的选择」：只考虑能保持最短路长度的下一步。 */
export function bfsDistMap(
  map: FairMap,
  to: string,
  forbidden: Iterable<string> = [],
  nodeFilter?: (id: string) => boolean,
): Map<string, number> | null {
  const banned = new Set(forbidden);
  const dist = new Map<string, number>([[to, 0]]);
  const queue: string[] = [to];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of map.neighbors(cur)) {
      if (dist.has(nb)) continue;
      if (banned.has(nb) && nb !== to) continue;
      if (nodeFilter && !nodeFilter(nb)) continue;
      dist.set(nb, dist.get(cur)! + 1);
      queue.push(nb);
    }
  }
  return dist.size > 1 ? dist : null;
}

export interface WeightedPath {
  path: string[];
  cost: number;
}

/** Dijkstra 最小代价路（weightFn 返回进入该节点的代价，必须 > 0） */
export function dijkstraPath(
  map: FairMap,
  from: string,
  to: string,
  weightFn: (id: string) => number,
  forbidden: Iterable<string> = [],
  nodeFilter?: (id: string) => boolean,
): WeightedPath | null {
  const banned = new Set(forbidden);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string | null>([[from, null]]);
  const visited = new Set<string>();
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        cur = id;
      }
    }
    if (cur === null) return null;
    if (cur === to) break;
    visited.add(cur);
    for (const nb of map.neighbors(cur)) {
      if (visited.has(nb)) continue;
      if (banned.has(nb) && nb !== to) continue;
      if (nodeFilter && !nodeFilter(nb)) continue;
      const w = weightFn(nb);
      if (w <= 0) throw new Error('dijkstraPath 权重必须为正');
      const nd = best + w;
      if (nd < (dist.get(nb) ?? Infinity)) {
        dist.set(nb, nd);
        prev.set(nb, cur);
      }
    }
  }
  const path: string[] = [];
  let p: string | null = to;
  while (p !== null) {
    path.unshift(p);
    p = prev.get(p) ?? null;
  }
  return { path, cost: dist.get(to)! };
}

/** 返程禁行集合：去程 ∪ 返程已用普通格（城市/当前矿区豁免不放入） */
export function returnForbidden(view: FairView): Set<string> {
  const banned = new Set<string>([...view.visitedOutbound, ...view.visitedReturn]);
  banned.delete(view.map.cityId);
  if (view.mineEntranceId) banned.delete(view.mineEntranceId);
  return banned;
}

/**
 * 返程可通行节点过滤：当前矿区豁免（可穿透），只有其它矿区不可作为通路
 * —— 必须与引擎 getLegalMoves / evaluateViability 完全一致，
 * 否则 Bot 会规划出引擎判定为非法的路线。
 */
export function returnViaFilter(view: FairView): (id: string) => boolean {
  const blocked = view.map.mineIds.filter((id) => id !== view.mineEntranceId);
  return (id: string) => !blocked.includes(id);
}

/** 从当前位置到城市的最短合法返程移动数（不存在时为 null） */
export function minReturnDays(view: FairView): number | null {
  const path = bfsPath(view.map, view.position, view.map.cityId, returnForbidden(view), returnViaFilter(view));
  return path ? path.length - 1 : null;
}

/* ------------------------------------------------------------------ */
/* 负重感知返程规划（Candidate Family D 的 Bot 侧全部逻辑）                */
/* ------------------------------------------------------------------ */
/**
 * 关键约束：返程必经「全新的格子」＝战争迷雾，地形未知。
 * 因此 Bot **不能**知道前面哪格是沙漠；它只能用公开先验做期望估计。
 * 公开先验：普通格地形概率 GRASS .4 / DESERT .3 / VILLAGE .2 / OASIS .1。
 *
 * 于是「进入一格」的期望天数：
 *   已知地形 → 1 + (是沙漠 ? extraDays : 0)
 *   未知地形 → 1 + 0.30 × extraDays        （按公开的沙漠先验折算）
 * 这是纯粹的期望值规划，不涉及任何上帝视角。
 */
export const DESERT_PRIOR = 0.3;

export function expectedMoveDays(view: FairView, tileId: string): number {
  const cfg = view.rules.loadReturn;
  if (!cfg.enabled) return 1;
  const extra = desertExtraDaysForLoad(view.gemsKg);
  if (extra <= 0) return 1;
  const terrain = view.map.tiles[tileId]?.terrain ?? null;
  if (terrain === 'DESERT') return 1 + extra;
  if (terrain === null) return 1 + DESERT_PRIOR * extra;
  return 1;
}

/** 从源头保证 Bot 与引擎用同一套负重分级公式 */
export function loadExtraPerDesertTile(gemsKg: number): number {
  return desertExtraDaysForLoad(gemsKg);
}

/** 以「期望天数」为权重的返程最短代价（机制关闭时退化为 minReturnDays） */
export function minReturnCostLoadAware(view: FairView): number | null {
  if (!view.rules.loadReturn.enabled || view.gemsKg < view.rules.loadReturn.thresholdKg) {
    return minReturnDays(view);
  }
  const r = dijkstraPath(
    view.map,
    view.position,
    view.map.cityId,
    (id) => expectedMoveDays(view, id),
    returnForbidden(view),
    returnViaFilter(view),
  );
  return r ? r.cost : null;
}

/** 「丢到阈值以下」之后回到基础规则的最短返程天数（用于评估丢货能省几天） */
export function minReturnDaysIfDropped(view: FairView): number | null {
  return minReturnDays(view);
}

/* ------------------------------------------------------------------ */
/* 地图地形构成（用于判断一条走廊的沙漠比例）                              */
/* ------------------------------------------------------------------ */

/** 安全权重表：草地并非安全地形 */
export const SAFE_WEIGHTS: Record<string, number> = {
  DESERT: 5,
  GRASS: 2.5,
  VILLAGE: 0.4,
  OASIS: 0.5,
  CITY: 1,
  MINE: 1,
};
