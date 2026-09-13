import type { GameState, TileId } from '../types';
import { bfsPath, enumeratePaths, gridNeighbors, isNormalTile, manhattan } from '../map/grid';
import { gameConfig } from '../config/gameConfig';

/**
 * 移动合法性与路线不可重复规则（v0.1.2 二维格子版）。
 *
 * - 四方向移动，每格消耗 1 天。
 * - 去程：普通格不可重复（每格只会被"烧"一次）；不允许中途回城；
 *   进入任一矿区入口即进矿。
 * - 返程：不得经过去程已烧掉的普通格，返程自身也不得重复普通格。
 * - 豁免：城市与当前矿区。另一个矿区不是豁免格（返程不可进入）。
 */

export function getLegalMoves(state: GameState): TileId[] {
  if (state.status !== 'ONGOING') return [];
  const neighbors = gridNeighbors(state.map, state.position);

  if (state.phase === 'OUTBOUND') {
    return neighbors.filter((nb) => {
      const terrain = state.map.tiles[nb].terrain;
      if (terrain === 'CITY') return false; // 去程不允许中途回城
      if (terrain === 'MINE') return true; // 抵达矿区（A 或 B 均触发进矿）
      return !state.visitedOutbound.includes(nb); // 普通格不可重复
    });
  }
  if (state.phase === 'RETURN') {
    const otherMines = state.map.mines
      .filter((m) => m.tileId !== state.mineEntranceId)
      .map((m) => m.tileId);
    return neighbors.filter((nb) => {
      const terrain = state.map.tiles[nb].terrain;
      if (terrain === 'CITY') return true; // 回城 = 胜利
      if (nb === state.mineEntranceId) return true; // 当前矿区豁免
      if (otherMines.includes(nb)) return false; // 另一个矿区不是豁免格
      return !state.visitedOutbound.includes(nb) && !state.visitedReturn.includes(nb);
    });
  }
  return []; // MINING 阶段无移动（必须先选择开始返程）
}

/** 返程禁行集合：去程 ∪ 返程已用普通格（城市/当前矿区豁免不放入） */
export function returnForbiddenTiles(state: GameState): TileId[] {
  return [...state.visitedOutbound, ...state.visitedReturn].filter((id) =>
    isNormalTile(state.map, id),
  );
}

/** 从当前位置是否存在合法回城路径（BFS） */
export function hasLegalReturnPath(state: GameState): boolean {
  if (state.status !== 'ONGOING') return false;
  if (state.phase === 'OUTBOUND') return true; // 去程不做返程判定
  return bfsPath(state.map, state.position, state.map.cityId, returnForbiddenTiles(state)) !== null;
}

/** 枚举从矿区出发的合法返程路径（不含矿区，含城市），供风险评分使用 */
export function enumerateReturnPathsFromMine(state: GameState, limit: number) {
  const forbidden = state.visitedOutbound.filter((id) => isNormalTile(state.map, id));
  return enumeratePaths(state.map, state.position, state.map.cityId, forbidden, limit);
}

/** 情报揭示半径（曼哈顿距离，格） */
export function intelRadius(): number {
  return gameConfig.intelRevealRadius;
}

export { manhattan, gridNeighbors, isNormalTile };
