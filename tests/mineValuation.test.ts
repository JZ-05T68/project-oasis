import { describe, it, expect } from 'vitest';
import { evaluateMine, computeGemPrice } from '../src/game/map/generate';
import { minCostRoundTrip, tileIdOf, isNormalTile } from '../src/game/map/grid';
import { gameConfig } from '../src/game/config/gameConfig';
import type { GameMap, GridTile, TerrainType, TileId, WeatherType } from '../src/game/types';

/**
 * 矿区价值公式测试（v0.1.2b：价格基准 = 最短合法往返方案的客观危险程度）。
 * 全部尺寸从 gameConfig.map 派生（不写死旧地图尺寸）。合成地图，完全确定。
 */

const ROWS = gameConfig.map.rows;
const COLS = gameConfig.map.cols;

function buildSyntheticMap(
  terrainFn: (row: number, col: number) => TerrainType,
  weatherFn: (row: number, col: number, day: number) => WeatherType = () => 'SUNNY',
  mineARow = 0,
  mineBRow = 3,
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
      weather[id] = Array.from({ length: gameConfig.maxDays + 4 }, (_, d) => weatherFn(r, c, d));
    }
  }
  return { rows: ROWS, cols: COLS, cityId, tiles, mines: [], weather, encounters: {}, drought: {} };
}

function mineTileOf(map: GameMap, slot: 'A' | 'B'): TileId {
  return Object.values(map.tiles).find((t) => t.terrain === 'MINE' && t.mineSlot === slot)!.id;
}

function priceOf(map: GameMap, slot: 'A' | 'B'): ReturnType<typeof evaluateMine> {
  return evaluateMine(map, slot, mineTileOf(map, slot), 1.0);
}

/** 全草图的城市↔矿区最短往返：两倍曼哈顿距离（两条路径分别先横后纵 / 先纵后横） */
const FULL_TRIP = 2 * (ROWS - 1 + (COLS - 1));

describe('定价公式（v0.1.2b 标定后）', () => {
  const cfg = gameConfig.mineValuation;

  it('单价 = clamp((base + 难度 × scale) × jitter) 且落在配置区间内', () => {
    expect(computeGemPrice(0, 1)).toBe(Math.max(cfg.clampMin, cfg.base));
    expect(computeGemPrice(-100, 1)).toBe(cfg.clampMin); // 极低难度 → 下限
    expect(computeGemPrice(1000, 1)).toBe(cfg.clampMax); // 极高难度 → 上限
    // 同一份代码路径被 evaluateMine 复用（单一来源）
    const m = buildSyntheticMap(() => 'GRASS');
    expect(priceOf(m, 'A').gemPrice).toBe(computeGemPrice(priceOf(m, 'A').difficultyScore, 1));
  });

  it('难度单调不减 → 单价单调不减（难度越高越值钱，但只由客观难度决定）', () => {
    let prev = -Infinity;
    for (let d = -50; d <= 150; d += 5) {
      const p = computeGemPrice(d, 1);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('旧的“难度 0 = 80 元”锚点已被重标定（难度 0 → 新区间下限）', () => {
    // 旧配置会把难度 0~35 全部钉在下限 80；新配置只在难度 < 0 时触底
    expect(cfg.base).toBe(cfg.clampMin);
    expect(cfg.base).toBeGreaterThan(80);
    expect(computeGemPrice(0, 1)).toBe(cfg.base);
    // 中段难度必须拉开差距，而不是全部挤在下限
    expect(computeGemPrice(40, 1) - computeGemPrice(0, 1)).toBeGreaterThan(50);
  });
});

describe('矿区价值评估（v0.1.2b 最短合法往返方案基准）', () => {
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

  it('全草图最远矿区（row=0）的往返长度 = 2 × 曼哈顿距离，普通格数 = 长度 - 2', () => {
    const m = buildSyntheticMap(allGrass, undefined, 0, 3);
    const a = priceOf(m, 'A');
    expect(a.detail.roundTripLength).toBe(FULL_TRIP);
    const normalTiles = FULL_TRIP - 2;
    expect(a.difficultyScore).toBe(Math.round(normalTiles * gameConfig.tileRisk.GRASS * 10) / 10);
    // 难度的确是价格基数：全草图进入上限区间
    expect(a.gemPrice).toBe(gameConfig.mineValuation.clampMax);
  });

  it('地形风险：草地走廊（本作高代价地形）比沙漠走廊评分更高', () => {
    const grassMap = buildSyntheticMap(allGrass);
    const desertMap = buildSyntheticMap(allDesert);
    expect(priceOf(grassMap, 'A').difficultyScore).toBeGreaterThan(priceOf(desertMap, 'A').difficultyScore);
  });

  it('距离成本：更远的矿区往返更长、评分更高（地形相同）', () => {
    const nearMap = buildSyntheticMap(allGrass, undefined, ROWS - 3, 2); // 离城市近（|5-2| ≥ 最小行距）
    const farMap = buildSyntheticMap(allGrass, undefined, 0, 3); // 离城市远
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

  it('随机扰动只小幅影响价格（jitter 0.9~1.1）', () => {
    const m = buildSyntheticMap(allGrass);
    const id = mineTileOf(m, 'A');
    const base = evaluateMine(m, 'A', id, 1.0);
    const low = evaluateMine(m, 'A', id, gameConfig.mineValuation.jitterMin);
    const high = evaluateMine(m, 'A', id, gameConfig.mineValuation.jitterMax);
    expect(low.gemPrice).toBeLessThanOrEqual(base.gemPrice);
    expect(high.gemPrice).toBeGreaterThanOrEqual(base.gemPrice);
    expect(high.gemPrice - low.gemPrice).toBeLessThanOrEqual(Math.ceil(base.gemPrice * 0.21));
  });

  it('任何合成地形下价格都落在配置区间内', () => {
    for (let i = 0; i < 20; i++) {
      const rowA = i % (ROWS - gameConfig.map.mineBottomForbiddenRows);
      const rowB = (rowA + gameConfig.map.mineMinRowGap) % (ROWS - gameConfig.map.mineBottomForbiddenRows);
      const map = buildSyntheticMap(allGrass, undefined, rowA, rowB);
      for (const mine of [priceOf(map, 'A'), priceOf(map, 'B')]) {
        expect(mine.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
        expect(mine.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
      }
    }
  });

  it('两矿独立评估：同一张图上 A/B 评分随各自环境变化', () => {
    const m = buildSyntheticMap(allGrass, undefined, ROWS - 3, 0);
    const a = priceOf(m, 'A');
    const b = priceOf(m, 'B');
    expect(b.detail.roundTripLength).toBeGreaterThan(a.detail.roundTripLength);
    expect(b.difficultyScore).toBeGreaterThan(a.difficultyScore);
  });
});
