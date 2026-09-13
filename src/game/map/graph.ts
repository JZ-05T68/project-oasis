import { GameMap, NodeId } from '../types';

/**
 * 地图图算法工具：连通性、单点删除连通性（2-顶点连通校验）、
 * 路径枚举（带禁行集合与数量上限）。
 */

/** BFS 求最短路（不考虑禁行） */
export function shortestPath(map: GameMap, from: NodeId, to: NodeId): NodeId[] | null {
  const prev: Record<NodeId, NodeId | null> = { [from]: null };
  const queue: NodeId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path: NodeId[] = [];
      let p: NodeId | null = cur;
      while (p !== null) {
        path.unshift(p);
        p = prev[p];
      }
      return path;
    }
    for (const nb of map.adjacency[cur] ?? []) {
      if (!(nb in prev)) {
        prev[nb] = cur;
        queue.push(nb);
      }
    }
  }
  return null;
}

/**
 * 判断「删去 ban 节点后 from→to 是否仍连通」。
 * 用于 2-顶点连通校验：对每个候选节点 v，existsPathExcluding(map, city, mine, v)
 * 全部为真 ⇔ 存在两条内部节点完全不重合的路径。
 */
export function existsPathExcluding(
  map: GameMap,
  from: NodeId,
  to: NodeId,
  ban: NodeId,
): boolean {
  if (from === ban || to === ban) return false;
  const seen = new Set<NodeId>([from]);
  const queue: NodeId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const nb of map.adjacency[cur] ?? []) {
      if (nb === ban || seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return false;
}

export interface PathSearchResult {
  /** 找到的简单路径（不含起点 from；含终点 to；中间不经过 forbidden） */
  paths: NodeId[][];
  /** true 表示达到上限提前截断（即实际路径数 ≥ limit，视为“很多”） */
  truncated: boolean;
}

/**
 * 枚举 from→to 的简单路径。
 * @param forbidden 禁止经过的节点集合（例如去程已用的普通格；豁免节点不应放入）
 * @param limit 最多返回的路径数量（性能保护）
 */
export function enumeratePaths(
  map: GameMap,
  from: NodeId,
  to: NodeId,
  forbidden: Iterable<NodeId>,
  limit: number,
): PathSearchResult {
  const banned = new Set<NodeId>(forbidden);
  const paths: NodeId[][] = [];
  let truncated = false;
  const onPath = new Set<NodeId>([from]);
  const stack: NodeId[] = [from];

  const dfs = (cur: NodeId) => {
    if (truncated) return;
    for (const nb of map.adjacency[cur] ?? []) {
      if (paths.length >= limit) {
        truncated = true;
        return;
      }
      if (onPath.has(nb)) continue;
      if (banned.has(nb) && nb !== to) continue;
      if (nb === to) {
        paths.push([...stack, to].slice(1));
        continue;
      }
      if (banned.has(nb)) continue;
      onPath.add(nb);
      stack.push(nb);
      dfs(nb);
      stack.pop();
      onPath.delete(nb);
    }
  };

  dfs(from);
  return { paths, truncated };
}

/** 从 start 出发路网距离 ≤ radius 的所有节点（不含 start） */
export function nodesWithinRadius(map: GameMap, start: NodeId, radius: number): NodeId[] {
  const seen = new Set<NodeId>([start]);
  let frontier: NodeId[] = [start];
  for (let d = 0; d < radius; d++) {
    const next: NodeId[] = [];
    for (const cur of frontier) {
      for (const nb of map.adjacency[cur] ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return [...seen].filter((id) => id !== start);
}
