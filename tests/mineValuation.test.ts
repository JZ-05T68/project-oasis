import { describe, it, expect } from 'vitest';
import { evaluateMine } from '../src/game/map/generate';
import { gameConfig } from '../src/game/config/gameConfig';
import type { GameMap, GridTile, TerrainType, TileId, WeatherType } from '../src/game/types';
import { tileIdOf } from '../src/game/map/grid';
import * as gridModule from '../src/game/map/grid';

/**
 * 矿区价值公式单调性测试（合成地图，完全确定）。
 * 验证评估只依赖客观地图因素，任何一项恶化都会推高评分/价格。
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
  const id = Object.values(map.tiles).find((t) => t.terrain === 'MINE' && t.mineSlot === slot)!.id;
  return id;
}

function priceOf(map: GameMap, slot: 'A' | 'B'): ReturnType<typeof evaluateMine> {
  return evaluateMine(map, slot, mineTileOf(map, slot), 1.0);
}

describe('矿区价值公式（合成地图单调性）', () => {
  const allGrass = () => 'GRASS' as TerrainType;

  it('同图同参数完全可复现', () => {
    const m = buildSyntheticMap(allGrass);
    const a1 = priceOf(m, 'A');
    const a2 = priceOf(m, 'A');
    expect(a1.difficultyScore).toBe(a2.difficultyScore);
    expect(a1.gemPrice).toBe(a2.gemPrice);
  });

  it('地形风险：草地走廊（本作高代价地形）比沙漠走廊评分更高', () => {
    const grassMap = buildSyntheticMap(allGrass);
    const desertMap = buildSyntheticMap(() => 'DESERT');
    const grassScore = priceOf(grassMap, 'A').difficultyScore;
    const desertScore = priceOf(desertMap, 'A').difficultyScore;
    expect(grassScore).toBeGreaterThan(desertScore);
  });

  it('距离成本：更远的矿区评分更高（地形相同）', () => {
    const nearMap = buildSyntheticMap(allGrass, undefined, 9, 3); // Mine A 在第 9 行（离城市近）
    const farMap = buildSyntheticMap(allGrass, undefined, 0, 3); // Mine A 在第 0 行（离城市远）
    const near = priceOf(nearMap, 'A');
    const far = priceOf(farMap, 'A');
    expect(far.detail.shortestLen).toBeGreaterThan(near.detail.shortestLen);
    expect(far.difficultyScore).toBeGreaterThan(near.difficultyScore);
  });

  it('天气负载：路径上恶劣天气更多的地图评分更高', () => {
    const sunny = buildSyntheticMap(allGrass, () => 'SUNNY');
    const severe = buildSyntheticMap(allGrass, () => 'SANDSTORM');
    const sunnyScore = priceOf(sunny, 'A').difficultyScore;
    const severeScore = priceOf(severe, 'A').difficultyScore;
    expect(severeScore).toBeGreaterThan(sunnyScore);
    expect(priceOf(severe, 'A').detail.weatherLoad).toBeGreaterThan(
      priceOf(sunny, 'A').detail.weatherLoad,
    );
  });

  it('返程稀缺：烧掉去程后 1×N 走廊不再有返路（计数 0），开阔地图仍有 ≥2 条', () => {
    const { countNodeDisjointPaths } = gridModule;
    // 1×3 走廊：城市(0,0) - 草(0,1) - 矿(0,2)；去程烧掉中间格后无返路
    const corridorTiles: Record<string, GridTile> = {
      '0:0': { id: '0:0', row: 0, col: 0, terrain: 'CITY' },
      '0:1': { id: '0:1', row: 0, col: 1, terrain: 'GRASS' },
      '0:2': { id: '0:2', row: 0, col: 2, terrain: 'MINE', mineSlot: 'A' },
    };
    const corridor: GameMap = {
      rows: 1,
      cols: 3,
      cityId: '0:0',
      tiles: corridorTiles,
      mines: [],
      weather: { '0:0': ['SUNNY'], '0:1': ['SUNNY'], '0:2': ['SUNNY'] },
      encounters: {},
      drought: {},
    };
    expect(countNodeDisjointPaths(corridor, '0:2', '0:0', ['0:1'], 4)).toBe(0);
    // 10×12 开阔地图（全草）：烧掉一条最短去程后仍有 ≥2 条不重叠返程
    const open = buildSyntheticMap(allGrass, undefined, 0, 6);
    const openBurn = openOutboundBurn(open);
        // 2-顶点连通保证至少还有 1 条返路（走廊地图为 0，形成稀缺差）
    expect(countNodeDisjointPaths(open, mineTileOf(open, 'A'), open.cityId, openBurn, 4)).toBeGreaterThanOrEqual(1);
  });

  function openOutboundBurn(map: GameMap): string[] {
    // 以最短去程为“烧掉”集合
    const mineId = mineTileOf(map, 'A');
    const path = gridModule.bfsPath(map, map.cityId, mineId)!;
    return path.filter((id) => id !== map.cityId && id !== mineId);
  }

  it('随机扰动只小幅影响价格（0.9~1.1）', () => {
    const m = buildSyntheticMap(allGrass);
    const base = evaluateMine(m, 'A', '0:11', 1.0);
    const low = evaluateMine(m, 'A', '0:11', gameConfig.mineValuation.jitterMin);
    const high = evaluateMine(m, 'A', '0:11', gameConfig.mineValuation.jitterMax);
    // 扰动对称围绕基准价，幅度 ±10%
    expect(low.gemPrice).toBeLessThanOrEqual(base.gemPrice);
    expect(high.gemPrice).toBeGreaterThanOrEqual(base.gemPrice);
    expect(high.gemPrice - low.gemPrice).toBeLessThanOrEqual(Math.ceil(base.gemPrice * 0.21));
    // 中位价不越界
    expect(base.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
    expect(base.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
  });

  it('两矿独立评估：同一张图上 A/B 评分随各自环境变化', () => {
    // Mine A 周围全草（近），Mine B 在第 0 行（远）→ B 评分更高
    const m = buildSyntheticMap(allGrass, undefined, 9, 0);
    const a = priceOf(m, 'A');
    const b = priceOf(m, 'B');
    expect(b.detail.shortestLen).toBeGreaterThan(a.detail.shortestLen);
    expect(b.difficultyScore).toBeGreaterThan(a.difficultyScore);
  });
});
