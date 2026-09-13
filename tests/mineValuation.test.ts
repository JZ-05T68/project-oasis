import { describe, it, expect } from 'vitest';
import { evaluateMine } from '../src/game/map/generate';
import { minCostRoundTrip, tileIdOf, isNormalTile } from '../src/game/map/grid';
import { gameConfig } from '../src/game/config/gameConfig';
import type { GameMap, GridTile, TerrainType, TileId, WeatherType } from '../src/game/types';

/**
 * 矿区价值公式测试（v0.1.2a：价格基准 = 最短合法往返方案的客观危险程度）。
 * 合成地图，完全确定。任何一项恶化都会推高评分/价格。
 */

const ROWS = 10;
const COLS = 12;

function buildSyntheticMap(
  terrainFn: (row: number, col: number) => TerrainType,
  weatherFn: (row: number, col: number, day: number) => WeatherType = () => 'SUNNY',
  mineARow = 0,
  mineBRow = 6,
): GameMap {
  const tiles: Record<TileId, GridTile> = {};
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = tileIdOf(r, c);
      tiles[id] = { id, row: r, col: c, terrain: terrainFn(r, c) };
    }
  }
  const cityId = tileIdOf(ROWS - 1, 0);
  tiles[cityId] = { id: cityId, row: ROWS - 1, col: 0, terrain: 'CITY' };
  for (const [slot, row] of [
    ['A', mineARow],
    ['B', mineBRow],
  ] as const) {
    const id = tileIdOf(row, COLS - 1);
    tiles[id] = { id, row, col: COLS - 1, terrain: 'MINE', mineSlot: slot };
  }
  const weather: Record<TileId, WeatherType[]> = {};
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = tileIdOf(r, c);
      weather[id] = Array.from({ length: 46 }, (_, d) => weatherFn(r, c, d));
    }
  }
  return {
    rows: ROWS,
    cols: COLS,
    cityId,
    tiles,
    mines: [],
    weather,
    encounters: {},
    drought: {},
  };
}

function mineTileOf(map: GameMap, slot: 'A' | 'B'): TileId {
  return Object.values(map.tiles).find((t) => t.terrain === 'MINE' && t.mineSlot === slot)!.id;
}

function priceOf(map: GameMap, slot: 'A' | 'B'): ReturnType<typeof evaluateMine> {
  return evaluateMine(map, slot, mineTileOf(map, slot), 1.0);
}

describe('矿区价值公式（v0.1.2a 最短合法往返方案基准）', () => {
  const allGrass = () => 'GRASS' as TerrainType;
  const allDesert = () => 'DESERT' as TerrainType;

  it('同图同参数完全可复现', () => {
    const m = buildSyntheticMap(allGrass);
    const a1 = priceOf(m, 'A');
    const a2 = priceOf(m, 'A');
    expect(a1.difficultyScore).toBe(a2.difficultyScore);
    expect(a1.gemPrice).toBe(a2.gemPrice);
  });

  it('往返方案的两条路径普通格完全不重合（合法性）', () => {
    const m = buildSyntheticMap(allGrass);
    const trip = minCostRoundTrip(m, m.cityId, mineTileOf(m, 'A'), () => 100);
    expect(trip).not.toBeNull();
    const normalA = trip!.pathA.filter((id) => isNormalTile(m, id));
    const normalB = trip!.pathB.filter((id) => isNormalTile(m, id));
    expect(normalA.some((id) => normalB.includes(id))).toBe(false);
  });

  it('价格基准 = 最短合法往返方案：全草图 Mine A(0,11) 的往返长度应为 40（20+20）', () => {
    const m = buildSyntheticMap(allGrass, undefined, 0, 5);
    const a = priceOf(m, 'A');
    expect(a.detail.roundTripLength).toBe(40);
    // 往返途经 38 个普通草格（端点城市/矿区不计风险），每格 7.0 → 266
    expect(a.difficultyScore).toBe(266);
  });

  it('地形风险：草地走廊（本作高代价地形）比沙漠走廊评分更高', () => {
    const grassMap = buildSyntheticMap(allGrass);
    const desertMap = buildSyntheticMap(allDesert);
    const grassScore = priceOf(grassMap, 'A').difficultyScore;
    const desertScore = priceOf(desertMap, 'A').difficultyScore;
    expect(grassScore).toBeGreaterThan(desertScore);
  });

  it('距离成本：更远的矿区往返更长、评分更高（地形相同）', () => {
    const nearMap = buildSyntheticMap(allGrass, undefined, 9, 3); // Mine A 在第 9 行（离城市近）
    const farMap = buildSyntheticMap(allGrass, undefined, 0, 3); // Mine A 在第 0 行（离城市远）
    const near = priceOf(nearMap, 'A');
    const far = priceOf(farMap, 'A');
    expect(far.detail.roundTripLength).toBeGreaterThan(near.detail.roundTripLength);
    expect(far.difficultyScore).toBeGreaterThan(near.difficultyScore);
  });

  it('天气与玩家行为不参与定价：不同天气表评分完全一致', () => {
    const sunny = buildSyntheticMap(allGrass, () => 'SUNNY');
    const severe = buildSyntheticMap(allGrass, () => 'SANDSTORM');
    expect(priceOf(sunny, 'A').difficultyScore).toBe(priceOf(severe, 'A').difficultyScore);
    expect(priceOf(sunny, 'A').gemPrice).toBe(priceOf(severe, 'A').gemPrice);
  });

  it('价格在 80~320 区间内；随机扰动只小幅影响价格（0.9~1.1）', () => {
    const m = buildSyntheticMap(allGrass);
    const base = evaluateMine(m, 'A', '0:11', 1.0);
    const low = evaluateMine(m, 'A', '0:11', gameConfig.mineValuation.jitterMin);
    const high = evaluateMine(m, 'A', '0:11', gameConfig.mineValuation.jitterMax);
    expect(low.gemPrice).toBeLessThanOrEqual(base.gemPrice);
    expect(high.gemPrice).toBeGreaterThanOrEqual(base.gemPrice);
    expect(high.gemPrice - low.gemPrice).toBeLessThanOrEqual(Math.ceil(base.gemPrice * 0.21));
    expect(base.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
    expect(base.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
    for (let i = 0; i < 20; i++) {
      const rowA = i % 10;
      const rowB = (rowA + 5) % 10;
      const map = buildSyntheticMap(allGrass, undefined, rowA, rowB);
      for (const mine of [priceOf(map, 'A'), priceOf(map, 'B')]) {
        expect(mine.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
        expect(mine.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
      }
    }
  });

  it('两矿独立评估：同一张图上 A/B 评分随各自环境变化', () => {
    // Mine A 周围全草（近），Mine B 在第 0 行（远）→ B 评分更高
    const m = buildSyntheticMap(allGrass, undefined, 9, 0);
    const a = priceOf(m, 'A');
    const b = priceOf(m, 'B');
    expect(b.detail.roundTripLength).toBeGreaterThan(a.detail.roundTripLength);
    expect(b.difficultyScore).toBeGreaterThan(a.difficultyScore);
  });
});
