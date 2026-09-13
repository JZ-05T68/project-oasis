import { GameState, NodeId } from '../types';
import { enumeratePaths } from '../map/graph';

/**
 * 移动合法性与路线不可重复规则。
 *
 * - 去程：普通格不可重复；不允许中途重新进入城市；进入任一矿区入口即进矿。
 * - 返程：不得经过去程已用普通格，返程自身也不得重复普通格。
 * - 豁免：城市（终点）与三个矿区入口（宝库格）。
 */

export function isNormalTile(state: GameState, nodeId: NodeId): boolean {
  const t = state.map.nodes[nodeId]?.terrain;
  return t === 'DESERT' || t === 'GRASS' || t === 'VILLAGE' || t === 'OASIS';
}

export function getLegalMoves(state: GameState): NodeId[] {
  if (state.status !== 'ONGOING') return [];
  const { adjacency } = state.map;
  const neighbors = adjacency[state.position] ?? [];

  if (state.phase === 'OUTBOUND') {
    return neighbors.filter((nb) => {
      const terrain = state.map.nodes[nb].terrain;
      if (terrain === 'CITY') return false; // 去程不允许中途回城
      if (terrain === 'MINE') return true; // 到达宝库
      return !state.visitedOutbound.includes(nb); // 普通格不可重复
    });
  }
  if (state.phase === 'RETURN') {
    return neighbors.filter((nb) => {
      const terrain = state.map.nodes[nb].terrain;
      if (terrain === 'CITY') return true; // 回城 = 胜利
      if (terrain === 'MINE') return true; // 宝库格豁免
      // 返程不得与去程、返程已用普通格重复
      return !state.visitedOutbound.includes(nb) && !state.visitedReturn.includes(nb);
    });
  }
  return []; // MINING 阶段无移动（必须先选择开始返程）
}

/** 返程禁行集合：去程 ∪ 返程已用普通格（城市/矿区豁免不放入） */
export function returnForbiddenTiles(state: GameState): NodeId[] {
  return [...state.visitedOutbound, ...state.visitedReturn].filter((id) => isNormalTile(state, id));
}

/**
 * 从当前位置是否存在合法回城路径。
 * 用于「返程路线中断」判定与采矿入口封死判定。
 */
export function hasLegalReturnPath(state: GameState): boolean {
  if (state.status !== 'ONGOING') return false;
  if (state.phase === 'OUTBOUND') return true; // 去程不做返程判定
  const { paths } = enumeratePaths(state.map, state.position, state.map.cityId, returnForbiddenTiles(state), 1);
  return paths.length > 0;
}

/** 枚举从矿区入口出发的合法返程路径（不含入口，含城市），供路线评分使用 */
export function enumerateReturnPathsFromMine(state: GameState, limit: number) {
  const forbidden = state.visitedOutbound.filter((id) => isNormalTile(state, id));
  return enumeratePaths(state.map, state.position, state.map.cityId, forbidden, limit);
}
