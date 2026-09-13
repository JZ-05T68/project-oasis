import { GameState, NodeId } from '../types';
import { gameConfig } from '../config/gameConfig';
import { nodesWithinRadius } from '../map/graph';

/**
 * 情报揭示：商队选项 B / 牧民指引。
 * 免费揭示当前节点路网距离 ≤N 的未知普通格地形，不消耗时间。
 * 只揭示「普通格」（草地/沙漠/村庄/绿洲）；城市与矿区开局已知。
 */

export function isTerrainKnown(state: GameState, nodeId: NodeId): boolean {
  const terrain = state.map.nodes[nodeId]?.terrain;
  if (terrain === 'CITY' || terrain === 'MINE') return true;
  return state.explored.includes(nodeId) || state.intelKnown.includes(nodeId);
}

/** 执行情报揭示，返回新揭示的节点 id 列表（直接修改传入的可变克隆） */
export function revealIntelAround(state: GameState, from: NodeId): NodeId[] {
  const radius = gameConfig.intelRevealRadius;
  const candidates = nodesWithinRadius(state.map, from, radius);
  const revealed: NodeId[] = [];
  for (const id of candidates) {
    const terrain = state.map.nodes[id].terrain;
    if (terrain !== 'GRASS' && terrain !== 'DESERT' && terrain !== 'VILLAGE' && terrain !== 'OASIS') {
      continue;
    }
    if (isTerrainKnown(state, id)) continue;
    state.intelKnown.push(id);
    revealed.push(id);
  }
  return revealed;
}
