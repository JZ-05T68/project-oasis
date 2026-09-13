import type {
  EncounterKind,
  GameMap,
  GridTile,
  MineInfo,
  MineSlot,
  TileId,
  WeatherType,
} from '../types';
import { gameConfig } from '../config/gameConfig';
import { hashSeed, nextRandom } from '../random/rng';
import {
  bfsPath,
  countNodeDisjointPaths,
  dijkstraPath,
  existsPathExcluding,
  gridNeighbors,
  tileIdOf,
} from './grid';

/**
 * v0.1.2 随机地图生成。
 *
 * - 10×12 格子；城市固定左下角 (rows-1, 0)；两个矿区固定在最右列 (col=cols-1)，
 *   行由 Seed 随机并满足最小行距。
 * - 普通格地形完全独立随机（与位置/路线无关）。
 * - 天气、遭遇、绿洲干涸、矿区价值全部在生成阶段按 Seed 确定。
 * - 合法性：城市与每个矿区之间存在两条内部格子完全不重合的路径
 *   （Menger 单点删除校验）；不满足时用 `seed#mapRetryN` 确定性重试。
 */

export const WEATHER_TABLE_DAYS = gameConfig.maxDays + 4;

/** 严重天气（用于矿区价值评估的天气负载） */
const SEVERE_WEATHER: ReadonlySet<WeatherType> = new Set([
  'HEAT',
  'SANDSTORM',
  'RAINSTORM',
  'MUD',
]);

type NormalTerrain = 'GRASS' | 'DESERT' | 'VILLAGE' | 'OASIS';

function rollTerrain(rng: () => number): NormalTerrain {
  const roll = rng();
  const p = gameConfig.terrainProbability;
  let acc = 0;
  for (const terrain of ['GRASS', 'DESERT', 'VILLAGE', 'OASIS'] as const) {
    acc += p[terrain] ?? 0;
    if (roll < acc) return terrain;
  }
  return 'GRASS';
}

function rollWeather(terrain: string, rng: () => number): WeatherType {
  const dist = gameConfig.weatherProbability[terrain] ?? { SUNNY: 1 };
  const roll = rng();
  let acc = 0;
  for (const [weather, p] of Object.entries(dist)) {
    acc += p;
    if (roll < acc) return weather as WeatherType;
  }
  const keys = Object.keys(dist);
  return keys[keys.length - 1] as WeatherType;
}

interface GenerateResult {
  map: GameMap;
  rngState: number;
}

function tryGenerate(mapSeed: string): GenerateResult | null {
  const { rows, cols, mineMinRowGap } = gameConfig.map;
  let rngState = hashSeed(mapSeed);
  const rng = (): number => {
    const [v, next] = nextRandom(rngState);
    rngState = next;
    return v;
  };

  // 1. 全图地形独立随机（行优先顺序，保证可复现）
  const tiles: Record<TileId, GridTile> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = tileIdOf(r, c);
      tiles[id] = { id, row: r, col: c, terrain: rollTerrain(rng) as GridTile['terrain'] };
    }
  }

  // 2. 城市固定左下角
  const cityId = tileIdOf(rows - 1, 0);
  tiles[cityId] = { id: cityId, row: rows - 1, col: 0, terrain: 'CITY' };

  // 3. 两个矿区：最右列，行随机，最小行距
  const rowA = Math.floor(rng() * rows);
  const candidates: number[] = [];
  for (let r = 0; r < rows; r++) {
    if (Math.abs(r - rowA) >= mineMinRowGap) candidates.push(r);
  }
  if (candidates.length === 0) return null; // 理论不可达（rows 过小），重试无意义但保持确定性
  const rowB = candidates[Math.floor(rng() * candidates.length)];
  const mineTiles: Array<{ slot: MineSlot; row: number }> = [
    { slot: 'A', row: rowA },
    { slot: 'B', row: rowB },
  ];
  for (const m of mineTiles) {
    const id = tileIdOf(m.row, cols - 1);
    tiles[id] = { id, row: m.row, col: cols - 1, terrain: 'MINE', mineSlot: m.slot };
  }
  const mineIds: Record<MineSlot, TileId> = {
    A: tileIdOf(rowA, cols - 1),
    B: tileIdOf(rowB, cols - 1),
  };

  const map: GameMap = {
    rows,
    cols,
    cityId,
    tiles,
    mines: [],
    weather: {},
    encounters: {},
    drought: {},
  };

  // 4. 合法性：城市到每个矿区存在两条内部格子完全不重合的路径
  for (const slot of ['A', 'B'] as const) {
    const mineId = mineIds[slot];
    for (const id of Object.keys(tiles)) {
      if (id === cityId || id === mineId) continue;
      if (!existsPathExcluding(map, cityId, mineId, id)) return null;
    }
  }

  // 5. 遭遇预生成：每个普通格（跳过城市/矿区），行优先
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = tileIdOf(r, c);
      const terrain = tiles[id].terrain;
      if (terrain === 'CITY' || terrain === 'MINE') continue;
      const roll = rng();
      let kind: EncounterKind | null = null;
      if (roll < gameConfig.encounter.baseProbability) {
        if (terrain === 'DESERT') kind = 'CARAVAN';
        else if (terrain === 'VILLAGE') kind = rng() < gameConfig.encounter.villageThiefRatio ? 'THIEF' : 'MARKET';
        else if (terrain === 'GRASS') kind = 'HERDSMAN';
        // 绿洲不额外塞遭遇（干涸是绿洲自身状态）
      }
      map.encounters[id] = kind;
    }
  }

  // 6. 绿洲干涸
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = tileIdOf(r, c);
      if (tiles[id].terrain !== 'OASIS') continue;
      map.drought[id] = rng() < gameConfig.oasisDroughtChance;
    }
  }

  // 7. 天气预生成（每格 × 每天）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = tileIdOf(r, c);
      const terrain = tiles[id].terrain;
      const list: WeatherType[] = [];
      for (let d = 0; d < WEATHER_TABLE_DAYS; d++) {
        list.push(rollWeather(terrain, rng));
      }
      map.weather[id] = list;
    }
  }

  // 8. 矿区价值评估（客观、与玩家行为无关）；扰动系数由主 rng 派生
  //    评估失败（贪心双策略均找不到合法往返组合）→ 返回 null，由
  //    generateWorld 用 seed#mapRetryN 确定性重试整张地图。
  const jitters: Record<MineSlot, number> = {
    A: Math.round((cfgJitter().min + rng() * (cfgJitter().max - cfgJitter().min)) * 100) / 100,
    B: Math.round((cfgJitter().min + rng() * (cfgJitter().max - cfgJitter().min)) * 100) / 100,
  };
  try {
    map.mines = mineTiles.map((m) => evaluateMine(map, m.slot, mineIds[m.slot], jitters[m.slot]));
  } catch {
    return null;
  }
  return { map, rngState };
}

/** 生成世界；合法性不满足时用 seed#mapRetryN 确定性重试 */
export function generateWorld(seed: string): GameMap {
  const maxRetries = gameConfig.map.maxRetries;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const mapSeed = attempt === 0 ? seed : `${seed}#mapRetry${attempt}`;
    const result = tryGenerate(mapSeed);
    if (result) return result.map;
  }
  throw new Error(`地图生成失败（超过 ${maxRetries} 次重试）：seed=${seed}`);
}

/* ------------------------------------------------------------------ */
/* 矿区价值评估（客观，地图生成时一次计算）                                */
/* ------------------------------------------------------------------ */

function tileRiskOf(map: GameMap, id: TileId): number {
  return gameConfig.tileRisk[map.tiles[id].terrain] ?? 0;
}

/** Dijkstra 权重：地形风险的正值化版本（村庄/绿洲的负风险用小正值表示“有吸引力”） */
function routeWeight(map: GameMap, id: TileId): number {
  return Math.min(10, Math.max(0.5, tileRiskOf(map, id)));
}

function isSevere(w: WeatherType): boolean {
  return SEVERE_WEATHER.has(w);
}

function cfgJitter(): { min: number; max: number } {
  return { min: gameConfig.mineValuation.jitterMin, max: gameConfig.mineValuation.jitterMax };
}

export function evaluateMine(map: GameMap, slot: MineSlot, mineId: TileId, jitter: number): MineInfo {
  const cfg = gameConfig.mineValuation;
  const cityId = map.cityId;
  const isMineTile = (id: TileId) => map.tiles[id].terrain === 'MINE';
  /** 路径中的普通格（去返程“烧格”与风险统计口径一致） */
  const normalTilesOf = (path: TileId[]): TileId[] =>
    path.filter((id) => id !== cityId && id !== mineId && !isMineTile(id));
  // 任何路线都不得穿过矿区格（走进矿区即触发进矿，不是过路）
  const notAnyMine = (id: TileId) => !isMineTile(id);

  // 最短路径长度（跳数）
  const shortest = bfsPath(map, cityId, mineId);
  const shortestLen = shortest ? shortest.length - 1 : map.rows + map.cols;

  interface RoutePair {
    outboundPath: TileId[];
    outboundRisk: number;
    returnPath: TileId[];
    returnRisk: number;
    pairCost: number;
  }

  const makePair = (outboundPath: TileId[], returnPath: TileId[]): RoutePair => {
    const outboundTiles = normalTilesOf(outboundPath);
    const returnTiles = normalTilesOf(returnPath);
    const outboundRisk = outboundTiles.reduce((s, id) => s + tileRiskOf(map, id), 0);
    const returnRisk = returnTiles.reduce((s, id) => s + tileRiskOf(map, id), 0);
    const pairCost = outboundRisk * cfg.outboundRiskWeight + returnRisk * cfg.returnRiskWeight;
    return { outboundPath, outboundRisk, returnPath, returnRisk, pairCost };
  };

  const candidates: RoutePair[] = [];

  /**
   * 策略 1（去程优先）：从矿区每个邻格方向接近，保证覆盖所有可行走廊。
   * 对每个候选去程计算“烧掉它之后”的最优合法返程——与真实玩家的最优规划一致，
   * 不会把“自己封死自己”的坏路线记为 0 风险。
   */
  const seenOutbound = new Set<string>();
  for (const nb of gridNeighbors(map, mineId)) {
    const approach = dijkstraPath(map, cityId, nb, (id) => routeWeight(map, id), [], notAnyMine);
    if (!approach) continue;
    const outboundPath = [...approach.path, mineId];
    const key = outboundPath.join('>');
    if (seenOutbound.has(key)) continue;
    seenOutbound.add(key);
    const bestReturn = dijkstraPath(
      map, mineId, cityId, (id) => routeWeight(map, id), normalTilesOf(outboundPath), notAnyMine,
    );
    if (bestReturn) candidates.push(makePair(outboundPath, bestReturn.path));
  }

  /**
   * 策略 2（返程优先，兜底）：角矿区可能被“最低风险去程”封死归途，
   * 但 Menger 校验保证不共享普通格的双路径客观存在。先贪心一条返程，
   * 再在返程烧格约束下找去程；仍失败则由 tryGenerate 确定性重试整张地图。
   */
  if (candidates.length === 0) {
    const ret = dijkstraPath(map, mineId, cityId, (id) => routeWeight(map, id), [], notAnyMine);
    if (ret) {
      const out = dijkstraPath(
        map, cityId, mineId, (id) => routeWeight(map, id), normalTilesOf(ret.path),
        (id) => id === mineId || notAnyMine(id),
      );
      if (out) candidates.push(makePair(out.path, ret.path));
    }
  }

  if (candidates.length === 0) {
    // 无合法往返组合（贪心双策略均失败）；交给 tryGenerate 换派生 Seed 重试
    throw new Error(`矿区 ${mineId} 无合法往返路线`);
  }
  const best = candidates.reduce((a, b) => (b.pairCost < a.pairCost ? b : a));

  const returnPathCount = countNodeDisjointPaths(
    map, mineId, cityId, normalTilesOf(best.outboundPath), cfg.returnPathCountCap,
  );

  // 天气负载：去返程路径格的平均恶劣天气天数
  const returnTiles = normalTilesOf(best.returnPath);
  const outboundTiles = normalTilesOf(best.outboundPath);
  const routeTilesSet = new Set<TileId>([...outboundTiles, ...returnTiles]);
  let severeTotal = 0;
  for (const id of routeTilesSet) {
    const table = map.weather[id];
    for (let d = 0; d < gameConfig.maxDays; d++) {
      if (table[d] && isSevere(table[d])) severeTotal += 1;
    }
  }
  const weatherLoad = routeTilesSet.size === 0 ? 0 : severeTotal / routeTilesSet.size;

  const scarcityPenalty =
    Math.max(0, cfg.minReturnAlternatives - returnPathCount) * cfg.scarcityPerMissing;

  const difficultyScore =
    Math.round(
      (shortestLen * cfg.distanceWeight +
        best.outboundRisk * cfg.outboundRiskWeight +
        best.returnRisk * cfg.returnRiskWeight +
        scarcityPenalty +
        weatherLoad * cfg.weatherWeight) *
        10,
    ) / 10;

  const stars = computeStarRating(difficultyScore);
  const gemPrice = Math.max(
    cfg.clampMin,
    Math.min(cfg.clampMax, Math.round((cfg.base + difficultyScore * cfg.scale) * jitter)),
  );

  return {
    slot,
    tileId: mineId,
    row: map.tiles[mineId].row,
    col: map.tiles[mineId].col,
    gemPrice,
    difficultyScore,
    estimatedRisk: stars,
    detail: {
      shortestLen,
      outboundRisk: Math.round(best.outboundRisk * 10) / 10,
      returnRisk: Math.round(best.returnRisk * 10) / 10,
      returnPathCount,
      weatherLoad: Math.round(weatherLoad * 100) / 100,
      jitter,
    },
  };
}

export function computeStarRating(score: number): number {
  let stars = 1;
  for (const t of gameConfig.starThresholds) {
    if (score >= t) stars += 1;
  }
  return Math.min(5, stars);
}
