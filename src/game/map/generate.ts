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
  existsPathExcluding,
  minCostRoundTrip,
  tileIdOf,
} from './grid';

/**
 * v0.1.2 随机地图生成（v0.1.2b 真人试玩修正）。
 *
 * - 8×9 格子（72 格）；城市固定左下角 (rows-1, 0) = (7,0)；两个矿区固定在最右列
 *   (col=cols-1 = 8)，行由 Seed 在「合法行区间」内随机并满足最小行距。
 * - 矿区禁止出现在最下方 `mineBottomForbiddenRows` 行（row 6 / 7），
 *   否则城市固定左下时矿区刷到右下会让远征距离过短。
 * - 尺寸相关的全部数值都从 gameConfig.map 派生，代码中不出现旧尺寸硬编码。
 * - 普通格地形完全独立随机（与位置/路线无关）。
 * - 天气、遭遇、绿洲干涸、矿区价值全部在生成阶段按 Seed 确定。
 * - 合法性：城市与每个矿区之间存在两条内部格子完全不重合的路径
 *   （Menger 单点删除校验）；不满足时用 `seed#mapRetryN` 确定性重试。
 * - 矿区价值 = 最短合法往返方案的客观风险（v0.1.2a）。
 */

export const WEATHER_TABLE_DAYS = gameConfig.maxDays + 4;

type NormalTerrain = 'GRASS' | 'DESERT' | 'VILLAGE' | 'OASIS';

/** 矿区合法行区间（含端点）：0 ~ rows-1-mineBottomForbiddenRows */
export function mineLegalRowRange(): { min: number; max: number } {
  const { rows, mineBottomForbiddenRows } = gameConfig.map;
  return { min: 0, max: rows - 1 - mineBottomForbiddenRows };
}

/** 矿区合法行列表（升序） */
export function mineLegalRows(): number[] {
  const { min, max } = mineLegalRowRange();
  const out: number[] = [];
  for (let r = min; r <= max; r++) out.push(r);
  return out;
}

/** 城市坐标（固定左下角，由地图尺寸派生） */
export function cityCoords(): { row: number; col: number } {
  return { row: gameConfig.map.rows - 1, col: 0 };
}

/** 矿区列（固定最右列，由地图尺寸派生） */
export function mineCol(): number {
  return gameConfig.map.cols - 1;
}


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

  // 3. 两个矿区：最右列，行在合法区间内随机，最小行距
  //    合法行 = [0, rows-1-mineBottomForbiddenRows]（8 行为 0~5；row 6/7 禁止）
  const legalRows = mineLegalRows();
  const rowA = legalRows[Math.floor(rng() * legalRows.length)];
  const candidates: number[] = legalRows.filter((r) => Math.abs(r - rowA) >= mineMinRowGap);
  if (candidates.length === 0) return null; // 行区间过小（配置错误），保持确定性重试
  const rowB = candidates[Math.floor(rng() * candidates.length)];
  const mineColIdx = cols - 1;
  const mineTiles: Array<{ slot: MineSlot; row: number }> = [
    { slot: 'A', row: rowA },
    { slot: 'B', row: rowB },
  ];
  for (const m of mineTiles) {
    const id = tileIdOf(m.row, mineColIdx);
    tiles[id] = { id, row: m.row, col: mineColIdx, terrain: 'MINE', mineSlot: m.slot };
  }
  const mineIds: Record<MineSlot, TileId> = {
    A: tileIdOf(rowA, mineColIdx),
    B: tileIdOf(rowB, mineColIdx),
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

function cfgJitter(): { min: number; max: number } {
  return { min: gameConfig.mineValuation.jitterMin, max: gameConfig.mineValuation.jitterMax };
}

/**
 * 宝石单价公式（v0.1.2b 单一来源）。
 *
 * 价格基数 **只** 由该矿区「最短合法往返方案」的客观危险程度（difficultyScore）
 * 决定，再乘上小幅品质/行情 jitter，最后夹在本局配置区间内。
 *
 * 玩家的实际行为（绕路、多踩沙漠/草地、受伤、烧帐篷、用指南针、原地等待）
 * 完全不出现在这个公式里——因此不存在「走得越危险卖得越贵」的刷价漏洞。
 */
export function computeGemPrice(
  difficultyScore: number,
  jitter: number,
  cfg: { base: number; scale: number; clampMin: number; clampMax: number } = gameConfig.mineValuation,
): number {
  return Math.max(
    cfg.clampMin,
    Math.min(cfg.clampMax, Math.round((cfg.base + difficultyScore * cfg.scale) * jitter)),
  );
}

export function evaluateMine(map: GameMap, slot: MineSlot, mineId: TileId, jitter: number): MineInfo {
  const cfg: { base: number; scale: number; clampMin: number; clampMax: number } =
    gameConfig.mineValuation;
  const cityId = map.cityId;

  /**
   * v0.1.2a 价格基准：该矿区「最短合法往返方案」（城市→矿区→城市，
   * 去返程普通格不重复）的客观危险程度。
   * - 主准则：往返总长度最小（最小费用流，精确）；
   * - 同长度：取累计客观风险最低者（确定性次准则）。
   * 与玩家实际路线完全无关——绕路/受伤/用装备不可能抬高价格。
   */
  const trip = minCostRoundTrip(
    map,
    cityId,
    mineId,
    (id) => positiveRiskTenths(map, id),
    (id) => id !== mineId && map.tiles[id].terrain === 'MINE',
  );
  if (!trip) {
    // Menger 校验保证不会发生；发生则由 tryGenerate 确定性重试整张地图
    throw new Error(`矿区 ${mineId} 无合法往返路线`);
  }
  const routeTiles = [...trip.pathA, ...trip.pathB].filter(
    (id) => id !== cityId && id !== mineId,
  );
  const routeTilesSet = new Set<TileId>(routeTiles);
  if (routeTilesSet.size !== routeTiles.length) {
    throw new Error(`矿区 ${mineId} 往返方案普通格重叠（内部错误）`);
  }
  const roundTripRisk =
    Math.round([...routeTilesSet].reduce((s, id) => s + tileRiskOf(map, id), 0) * 10) / 10;
  const roundTripLength = trip.pathA.length + trip.pathB.length - 2; // 端点城市/矿区各计一次

  const difficultyScore = roundTripRisk;
  const stars = computeStarRating(difficultyScore);
  const gemPrice = computeGemPrice(difficultyScore, jitter, cfg);


  return {
    slot,
    tileId: mineId,
    row: map.tiles[mineId].row,
    col: map.tiles[mineId].col,
    gemPrice,
    difficultyScore,
    estimatedRisk: stars,
    detail: {
      roundTripLength,
      roundTripRisk,
      jitter,
    },
  };
}

/** 正值化风险（十分位整数）：村庄/绿洲的负风险用小正值表示“有吸引力” */
function positiveRiskTenths(map: GameMap, id: TileId): number {
  const r = tileRiskOf(map, id);
  return Math.round(Math.min(10, Math.max(0.5, r)) * 10);
}

export function computeStarRating(score: number): number {
  let stars = 1;
  for (const t of gameConfig.starThresholds) {
    if (score >= t) stars += 1;
  }
  return Math.min(5, stars);
}
