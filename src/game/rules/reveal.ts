import type { GameState, TileId } from '../types';
import { gameConfig } from '../config/gameConfig';
import { isNormalTile, manhattan } from '../map/grid';

/**
 * 情报揭示（v0.1.2）：商队选项 B / 牧民指引。
 * 免费揭示当前格曼哈顿距离 ≤N 的未知普通格地形，不消耗时间。
 */

export function isTerrainKnown(state: GameState, tileId: TileId): boolean {
  const terrain = state.map.tiles[tileId]?.terrain;
  if (terrain === 'CITY' || terrain === 'MINE') return true;
  return state.explored.includes(tileId) || state.intelKnown.includes(tileId);
}

/** 执行情报揭示，返回新揭示的格子列表（直接修改传入的可变克隆） */
export function revealIntelAround(state: GameState, from: TileId): TileId[] {
  return revealIntelAroundRadius(state, from, gameConfig.intelRevealRadius);
}

/** 指定半径的情报揭示（loadReturn.surveyRadius 用；与 revealIntelAround 同一套规则） */
export function revealIntelAroundRadius(state: GameState, from: TileId, radius: number): TileId[] {
  const revealed: TileId[] = [];
  for (const id of Object.keys(state.map.tiles)) {
    if (manhattan(from, id) > radius) continue;
    if (!isNormalTile(state.map, id)) continue;
    if (isTerrainKnown(state, id)) continue;
    state.intelKnown.push(id);
    revealed.push(id);
  }
  return revealed.sort((a, b) => a.localeCompare(b));
}
