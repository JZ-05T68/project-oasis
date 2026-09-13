import type { FairMap, FairView } from './fairView';

/**
 * Bot 侧图算法工具：全部只依赖 FairView 的公开信息
 * （完整路网拓扑按游戏规则始终可见；地形按战争迷雾过滤）。
 */

/** BFS 最短路（跳数）；forbidden 为禁行节点集合；nodeFilter 可进一步过滤可通行节点。
 * 注意：起点/终点本身不受 forbidden 限制（起点必然已被访问过，终点=城市/矿区为豁免格）。 */
export function bfsPath(
  map: FairMap,
  from: string,
  to: string,
  forbidden: Iterable<string> = [],
  nodeFilter?: (id: string) => boolean,
): string[] | null {
  const banned = new Set(forbidden);
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
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
    for (const nb of map.adjacency[cur] ?? []) {
      if (prev.has(nb)) continue;
      if (banned.has(nb) && nb !== to) continue;
      if (nodeFilter && !nodeFilter(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  return null;
}

export interface WeightedPath {
  path: string[];
  cost: number;
}

/** Dijkstra 最小代价路（weightFn 返回进入该节点的代价，必须 > 0）。
 * 起点/终点不受 forbidden 限制（同 bfsPath）。 */
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
  // 小图用简单优先队列（数组扫描）即可
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
    for (const nb of map.adjacency[cur] ?? []) {
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

/** 返程禁行集合：去程 ∪ 返程已用普通格（城市/矿区豁免；与引擎规则一致） */
export function returnForbidden(view: FairView): Set<string> {
  const banned = new Set<string>([...view.visitedOutbound, ...view.visitedReturn]);
  banned.delete(view.map.cityId);
  for (const m of view.map.mineIds) banned.delete(m);
  return banned;
}

/** 从当前位置到城市的最短合法返程移动数（不存在时为 null） */
export function minReturnDays(view: FairView): number | null {
  const path = bfsPath(view.map, view.position, view.map.cityId, returnForbidden(view));
  return path ? path.length - 1 : null;
}

/** 安全权重表（SafeBot / ForecastBot 使用）：草地并非安全地形 */
export const SAFE_WEIGHTS: Record<string, number> = {
  DESERT: 5,
  GRASS: 2.5,
  VILLAGE: 0.4,
  OASIS: 0.5,
  CITY: 1,
  MINE: 1,
};
