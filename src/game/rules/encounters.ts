import { GameMap, NodeId } from '../types';
import { gameConfig } from '../config/gameConfig';
import { nextRandom } from '../random/rng';
import { WEATHER_TABLE_DAYS } from './weather';

/**
 * 遭遇系统：与天气严格分离。
 * 开局按 Seed 预生成每节点 × 每天的遭遇 roll 值（[0,1)），
 * 进入格子的当天按地形阈值判定；单次 roll 只产生至多一种遭遇，
 * 因此村庄的盗贼与繁荣市集天然互斥。同一天天气与遭遇可以同时发生。
 */

export function generateEncounterRollTable(
  map: GameMap,
  rngState: number,
): { rolls: Record<NodeId, number[]>; rngState: number } {
  const rolls: Record<NodeId, number[]> = {};
  let state = rngState;
  for (const nodeId of Object.keys(map.nodes)) {
    const list: number[] = [];
    for (let d = 0; d < WEATHER_TABLE_DAYS; d++) {
      const [roll, next] = nextRandom(state);
      state = next;
      list.push(roll);
    }
    rolls[nodeId] = list;
  }
  return { rolls, rngState: state };
}

/** 绿洲是否干涸：开局按 Seed 逐绿洲确定，首次抵达时揭晓 */
export function generateDroughtTable(
  map: GameMap,
  rngState: number,
): { drought: Record<NodeId, boolean>; rngState: number } {
  const drought: Record<NodeId, boolean> = {};
  let state = rngState;
  for (const nodeId of Object.keys(map.nodes)) {
    if (map.nodes[nodeId].terrain !== 'OASIS') continue;
    const [roll, next] = nextRandom(state);
    state = next;
    drought[nodeId] = roll < gameConfig.oasisDroughtChance;
  }
  return { drought, rngState: state };
}

/** 查询遭遇 roll；超出预生成范围时返回 1（无遭遇） */
export function encounterRollForDay(
  rolls: Record<NodeId, number[]>,
  nodeId: NodeId,
  day: number,
): number {
  const list = rolls[nodeId];
  if (!list || day < 1 || day > list.length) return 1;
  return list[day - 1];
}

export interface EncounterJudgement {
  kind: 'CARAVAN' | 'THIEF' | 'MARKET' | 'HERDSMAN' | null;
}

/** 按地形与 roll 值判定遭遇种类 */
export function judgeEncounter(terrain: string, roll: number): EncounterJudgement {
  const p = gameConfig.encounterProbability[terrain] ?? {};
  switch (terrain) {
    case 'DESERT':
      return { kind: roll < (p.CARAVAN ?? 0) ? 'CARAVAN' : null };
    case 'VILLAGE': {
      const thief = p.THIEF ?? 0;
      const market = p.MARKET ?? 0;
      if (roll < thief) return { kind: 'THIEF' };
      if (roll < thief + market) return { kind: 'MARKET' };
      return { kind: null };
    }
    case 'GRASS':
      return { kind: roll < (p.HERDSMAN ?? 0) ? 'HERDSMAN' : null };
    default:
      return { kind: null };
  }
}
