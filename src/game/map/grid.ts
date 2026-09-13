import type { GameMap, TileId } from '../types';

/**
 * 二维格子地图工具：坐标、四方向邻接、BFS / Dijkstra / 路径枚举。
 * 所有函数只依赖 GameMap 的公开结构（地形可见性由调用方通过 FairView 过滤）。
 */

export function tileIdOf(row: number, col: number): TileId {
  return `${row}:${col}`;
}

export function parseTileId(id: TileId): { row: number; col: number } {
  const [r, c] = id.split(':');
  return { row: Number(r), col: Number(c) };
}

export function inBounds(map: GameMap, row: number, col: number): boolean {
  return row >= 0 && row < map.rows && col >= 0 && col < map.cols;
}

/** 四方向邻居（上/下/左/右），自动裁剪边界 */
export function gridNeighbors(map: GameMap, id: TileId): TileId[] {
  const { row, col } = parseTileId(id);
  const out: TileId[] = [];
  if (row > 0) out.push(tileIdOf(row - 1, col));
  if (row < map.rows - 1) out.push(tileIdOf(row + 1, col));
  if (col > 0) out.push(tileIdOf(row, col - 1));
  if (col < map.cols - 1) out.push(tileIdOf(row, col + 1));
  return out;
}

/** 曼哈顿距离 */
export function manhattan(a: TileId, b: TileId): number {
  const pa = parseTileId(a);
  const pb = parseTileId(b);
  return Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col);
}

export function isNormalTile(map: GameMap, id: TileId): boolean {
  const t = map.tiles[id]?.terrain;
  return t === 'DESERT' || t === 'GRASS' || t === 'VILLAGE' || t === 'OASIS';
}

/**
 * BFS 最短路（跳数）。from/to 不受 forbidden 限制（起点必然已访问，终点为豁免格）。
 * nodeFilter 可进一步限制可通行节点（例如去程禁止路过另一个矿区）。
 */
export function bfsPath(
  map: GameMap,
  from: TileId,
  to: TileId,
  forbidden: Iterable<TileId> = [],
  nodeFilter?: (id: TileId) => boolean,
): TileId[] | null {
  const banned = new Set(forbidden);
  const prev = new Map<TileId, TileId | null>([[from, null]]);
  const queue: TileId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) {
      const path: TileId[] = [];
      let p: TileId | null = cur;
      while (p !== null) {
        path.unshift(p);
        p = prev.get(p) ?? null;
      }
      return path;
    }
    for (const nb of gridNeighbors(map, cur)) {
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
  path: TileId[];
  cost: number;
}

/** Dijkstra 最小代价路（weightFn 返回进入该节点的代价，必须 > 0） */
export function dijkstraPath(
  map: GameMap,
  from: TileId,
  to: TileId,
  weightFn: (id: TileId) => number,
  forbidden: Iterable<TileId> = [],
  nodeFilter?: (id: TileId) => boolean,
): WeightedPath | null {
  const banned = new Set(forbidden);
  const dist = new Map<TileId, number>([[from, 0]]);
  const prev = new Map<TileId, TileId | null>([[from, null]]);
  const visited = new Set<TileId>();
  while (true) {
    let cur: TileId | null = null;
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
    for (const nb of gridNeighbors(map, cur)) {
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
  const path: TileId[] = [];
  let p: TileId | null = to;
  while (p !== null) {
    path.unshift(p);
    p = prev.get(p) ?? null;
  }
  return { path, cost: dist.get(to)! };
}

/**
 * 枚举 from→to 的简单路径（数量上限保护）。
 * forbidden 中的节点不可作为中间节点（to 例外）。
 * 带连通性剪枝：若目标已无法从当前前缀到达，立即回溯
 * （否则格子图上会把指数级的无效绕路全部枚举一遍）。
 */
export function enumeratePaths(
  map: GameMap,
  from: TileId,
  to: TileId,
  forbidden: Iterable<TileId>,
  limit: number,
): { paths: TileId[][]; truncated: boolean } {
  const banned = new Set(forbidden);
  const paths: TileId[][] = [];
  let truncated = false;
  const onPath = new Set<TileId>([from]);
  const stack: TileId[] = [from];

  /** 目标是否仍可从 nb 的未占用区域到达（或 nb 与目标相邻） */
  const canStillReach = (nb: TileId): boolean => {
    if (nb === to) return true;
    const seen = new Set<TileId>([nb]);
    const queue: TileId[] = [nb];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const t of gridNeighbors(map, cur)) {
        if (t === to) return true;
        if (seen.has(t) || onPath.has(t) || banned.has(t)) continue;
        seen.add(t);
        queue.push(t);
      }
    }
    return false;
  };

  const dfs = (cur: TileId) => {
    if (truncated) return;
    for (const nb of gridNeighbors(map, cur)) {
      if (paths.length >= limit) {
        truncated = true;
        return;
      }
      if (onPath.has(nb)) continue;
      if (nb === to) {
        paths.push([...stack, to].slice(1));
        continue;
      }
      if (banned.has(nb)) continue;
      if (!canStillReach(nb)) continue;
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

/**
 * 统计 from→to 的（近似）节点不重叠路径数：迭代使用 BFS 最短路并烧掉其内部节点，
 * 直到不存在路径或达到 countCap。用于评估“可替代返程走廊数量”（Menger 风格）。
 */
export function countNodeDisjointPaths(
  map: GameMap,
  from: TileId,
  to: TileId,
  forbidden: Iterable<TileId>,
  countCap: number,
): number {
  const burned = new Set(forbidden);
  let count = 0;
  while (count < countCap) {
    const path = bfsPath(map, from, to, burned);
    if (!path) break;
    count += 1;
    // 烧掉内部节点（不含 from/to）
    for (const id of path) {
      if (id !== from && id !== to) burned.add(id);
    }
  }
  return count;
}

/**
 * 地图合法性（Menger 单点删除校验）：
 * 删去任意一个非端点格子后 from→to 仍连通 ⇔ 存在两条内部格子完全不重合的路径。
 * 二维全通格子图天然满足，此校验作为生成保险与未来扩展（障碍物）的守门员。
 */
export function existsPathExcluding(
  map: GameMap,
  from: TileId,
  to: TileId,
  ban: TileId,
): boolean {
  if (from === ban || to === ban) return false;
  const seen = new Set<TileId>([from]);
  const queue: TileId[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const nb of gridNeighbors(map, cur)) {
      if (nb === ban || seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 最小费用往返方案（v0.1.2a 矿价基准）                                    */
/* ------------------------------------------------------------------ */

/**
 * 节点拆分最小费用流（SPFA 最短增广路，流量恒为 2）。
 *
 * 建模：from → to 的 2 单位「普通格节点不重复」流 ⇔ 一对内部普通格完全不重合的
 * 路径（from/to 为豁免端点，可共用）。两单位即去程 + 返程。
 *
 * 代价：主准则 = 普通格跳数（每格 1），次准则 = nodeCost 给出的正值化风险整数，
 * combined = hops * COST_SCALE + riskTenths。SSP 保证两次增广总代价 = 全局最小
 * 往返总长度，并在等长方案中确定性偏好累计风险更低者。
 */
export function minCostRoundTrip(
  map: GameMap,
  from: TileId,
  to: TileId,
  nodeCost: (id: TileId) => number,
  blocked: (id: TileId) => boolean = () => false,
): { pathA: TileId[]; pathB: TileId[]; totalCost: number } | null {
  const COST_SCALE = 100000;

  interface Edge {
    to: number;
    rev: number;
    cap: number;
    cost: number;
    fwd: boolean; // true = 前向边；false = 残量反向边
  }
  const edges: Edge[] = [];
  const graph: number[][] = [];
  const addNode = (): number => {
    graph.push([]);
    return graph.length - 1;
  };
  const addEdge = (u: number, v: number, cap: number, cost: number): void => {
    graph[u].push(edges.length);
    edges.push({ to: v, rev: edges.length + 1, cap, cost, fwd: true });
    graph[v].push(edges.length);
    edges.push({ to: u, rev: edges.length - 1, cap: 0, cost: -cost, fwd: false });
  };

  const S = addNode();
  const T = addNode();

  const inOf = new Map<TileId, number>();
  const outOf = new Map<TileId, number>();
  const tileOfIn = new Map<number, TileId>();
  for (const id of Object.keys(map.tiles)) {
    if (blocked(id)) continue; // 不可通行格（另一个矿区等）完全不参与建图
    const i = addNode();
    const o = addNode();
    inOf.set(id, i);
    outOf.set(id, o);
    tileOfIn.set(i, id);
    const isEndpoint = id === from || id === to;
    // 端点（城市/矿区）容量 2（豁免、可共用）；普通格容量 1（节点不重复约束）
    addEdge(i, o, isEndpoint ? 2 : 1, isEndpoint ? 0 : COST_SCALE + nodeCost(id));
  }
  for (const id of Object.keys(map.tiles)) {
    if (blocked(id)) continue;
    for (const nb of gridNeighbors(map, id)) {
      if (blocked(nb) || !inOf.has(nb)) continue;
      addEdge(outOf.get(id)!, inOf.get(nb)!, 1, 0);
    }
  }
  addEdge(S, inOf.get(from)!, 2, 0);
  addEdge(outOf.get(to)!, T, 2, 0);

  // ---- SPFA 最短增广路（残量网络含负边；SSP 保证无负环）----
  const spfa = (): { prevEdge: number[]; distT: number } | null => {
    const dist = new Array<number>(graph.length).fill(Infinity);
    const inQueue = new Array<boolean>(graph.length).fill(false);
    const prevEdge = new Array<number>(graph.length).fill(-1);
    dist[S] = 0;
    const queue: number[] = [S];
    inQueue[S] = true;
    while (queue.length > 0) {
      const u = queue.shift()!;
      inQueue[u] = false;
      for (const ei of graph[u]) {
        const e = edges[ei];
        if (e.cap <= 0) continue;
        if (dist[u] + e.cost < dist[e.to]) {
          dist[e.to] = dist[u] + e.cost;
          prevEdge[e.to] = ei;
          if (!inQueue[e.to]) {
            inQueue[e.to] = true;
            queue.push(e.to);
          }
        }
      }
    }
    return dist[T] < Infinity ? { prevEdge, distT: dist[T] } : null;
  };

  let totalCost = 0;
  for (let flow = 0; flow < 2; flow++) {
    const aug = spfa();
    if (!aug) return null; // 无法找到两单位节点不重复路径
    totalCost += aug.distT;
    let v = T;
    while (v !== S) {
      const ei = aug.prevEdge[v];
      const e = edges[ei];
      e.cap -= 1;
      edges[e.rev].cap += 1;
      v = edges[e.rev].to;
    }
  }

  // ---- 流分解：从 S 沿「承载流量」的前向边走两次，还原两条 from→to 路径 ----
  // 前向边 e 的当前流量 = edges[e.rev].cap（初始反向 cap 为 0，按单位增减）。
  const walkPath = (): TileId[] => {
    const path: TileId[] = [];
    // S → in(from)
    let u = -1;
    for (const ei of graph[S]) {
      const e = edges[ei];
      if (e.fwd && edges[e.rev].cap > 0) {
        edges[e.rev].cap -= 1;
        e.cap += 1;
        u = e.to;
        break;
      }
    }
    let guard = 0;
    while (guard++ < 2000) {
      const tile = tileOfIn.get(u);
      if (tile !== undefined) {
        // in 节点：消耗 in→out 节点边
        path.push(tile);
        let advanced = false;
        for (const ei of graph[u]) {
          const e = edges[ei];
          if (e.fwd && e.to === outOf.get(tile) && edges[e.rev].cap > 0) {
            edges[e.rev].cap -= 1;
            e.cap += 1;
            u = e.to;
            advanced = true;
            break;
          }
        }
        if (!advanced) throw new Error('minCostRoundTrip 流分解失败（in 节点）');
      } else {
        // out 节点：沿邻接前向边走；到达 to 的 out 节点时走向 T 结束
        if (u === outOf.get(to)) {
          for (const ei of graph[u]) {
            const e = edges[ei];
            if (e.fwd && e.to === T && edges[e.rev].cap > 0) {
              edges[e.rev].cap -= 1;
              e.cap += 1;
              return path;
            }
          }
          throw new Error('minCostRoundTrip 流分解失败（终边）');
        }
        let advanced = false;
        for (const ei of graph[u]) {
          const e = edges[ei];
          if (e.fwd && e.to !== T && edges[e.rev].cap > 0) {
            edges[e.rev].cap -= 1;
            e.cap += 1;
            u = e.to;
            advanced = true;
            break;
          }
        }
        if (!advanced) throw new Error('minCostRoundTrip 流分解失败（out 节点）');
      }
    }
    throw new Error('minCostRoundTrip 流分解超限');
  };

  const pathA = walkPath();
  const pathB = walkPath();
  return { pathA, pathB, totalCost };
}
