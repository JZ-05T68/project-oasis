import type { EncounterKind, GameMap, TileId } from '../types';

/**
 * 遭遇查询（v0.1.2）：遭遇在地图生成阶段按 Seed 预生成到每个普通格，
 * 每格每局最多触发一次（首次进入时）。天气与遭遇严格分离。
 */

export function pregeneratedEncounter(map: GameMap, tileId: TileId): EncounterKind | null {
  return map.encounters[tileId] ?? null;
}
