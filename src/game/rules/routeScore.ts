import { GameState, NodeId } from '../types';
import { gameConfig } from '../config/gameConfig';
import { nextRandom } from '../random/rng';
import { enumerateReturnPathsFromMine } from './movement';

/**
 * 路线难度评分与宝石定价。
 *
 * 评分评估的是「路线客观风险」，不是玩家实际受到的伤害——
 * 故意不用帐篷挨打、故意迷路都不会提高售价，无法靠受伤刷价。
 *
 * score = 去程地形风险 + 最优合法返程地形风险 + 时间冗余惩罚 + 返程稀缺惩罚
 * baseGemPrice = clamp(round(80 + score × K), 80, 320)
 * finalGemPrice = round(baseGemPrice × marketFactor)，marketFactor ∈ [0.95, 1.05] 由 Seed 决定
 */

export interface RouteScoreResult {
  score: number;
  stars: number;
  baseGemPrice: number;
  marketFactor: number;
  gemPrice: number;
  outboundRisk: number;
  returnRisk: number;
  returnPathCount: number;
  returnPathTruncated: boolean;
  rngState: number;
}

function tileRiskOf(state: GameState, nodeId: NodeId): number {
  const terrain = state.map.nodes[nodeId].terrain;
  return gameConfig.tileRisk[terrain] ?? 0;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function computeStarRating(score: number): number {
  let stars = 1;
  for (const t of gameConfig.starThresholds) {
    if (score >= t) stars += 1;
  }
  return Math.min(5, stars);
}

export function starLabel(stars: number): string {
  return '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars);
}

/**
 * 计算进入矿区时刻的路线难度与定价。
 * 前置条件：state.position 为矿区入口，visitedOutbound 已包含完整去程。
 * 返回 marketFactor 及更新后的 rngState（由引擎写回 GameState）。
 */
export function computeRouteScore(state: GameState): RouteScoreResult {
  const mineId = state.position;
  const cityId = state.map.cityId;

  // 去程：只统计普通格（城市/矿区豁免，不计风险）
  const outboundTiles = state.visitedOutbound.filter((id) => {
    if (id === cityId || id === mineId) return false;
    const t = state.map.nodes[id].terrain;
    return t !== 'CITY' && t !== 'MINE';
  });
  const outboundRisk = outboundTiles.reduce((sum, id) => sum + tileRiskOf(state, id), 0);
  const outboundLen = state.visitedOutbound.length - 1; // 移动次数

  // 返程：在避开去程普通格的前提下枚举合法路径（矿区入口与城市豁免）
  const { paths, truncated } = enumerateReturnPathsFromMine(state, gameConfig.returnPathSearchLimit);
  if (paths.length === 0) {
    throw new Error('computeRouteScore 前置条件不满足：不存在合法返程路径');
  }
  let returnRisk = Infinity;
  let minReturnLen = Infinity;
  for (const p of paths) {
    const risk = p.reduce((sum, id) => sum + tileRiskOf(state, id), 0);
    if (risk < returnRisk) returnRisk = risk;
    if (p.length < minReturnLen) minReturnLen = p.length;
  }

  // 时间冗余：42 天与（去程 + 最短返程）之差
  const slack = gameConfig.maxDays - (outboundLen + minReturnLen);
  const slackPenalty =
    slack < gameConfig.slackComfortDays
      ? (gameConfig.slackComfortDays - slack) * gameConfig.slackPenaltyPerDay
      : 0;

  // 返程稀缺惩罚
  const effectiveCount = truncated ? gameConfig.returnPathSearchLimit : paths.length;
  const scarcityPenalty =
    effectiveCount >= 4
      ? gameConfig.scarcityPenaltyByPathCount[3]
      : gameConfig.scarcityPenaltyByPathCount[effectiveCount - 1];

  const score = round1(outboundRisk + returnRisk + slackPenalty + scarcityPenalty);

  const base = Math.max(
    gameConfig.priceMin,
    Math.min(gameConfig.priceMax, Math.round(gameConfig.priceBase + score * gameConfig.priceMultiplier)),
  );
  const [roll, rngState] = nextRandom(state.rngState);
  const marketFactor =
    Math.round(
      (gameConfig.marketFactorMin + roll * (gameConfig.marketFactorMax - gameConfig.marketFactorMin)) * 100,
    ) / 100;
  const gemPrice = Math.round(base * marketFactor);

  return {
    score,
    stars: computeStarRating(score),
    baseGemPrice: base,
    marketFactor,
    gemPrice,
    outboundRisk: round1(outboundRisk),
    returnRisk: round1(returnRisk),
    returnPathCount: paths.length,
    returnPathTruncated: truncated,
    rngState,
  };
}

/** 进入矿区时向玩家展示的预估售价区间（真实成交价必在其中） */
export function estimatePriceBand(baseGemPrice: number): [number, number] {
  const lo = Math.round(baseGemPrice * gameConfig.marketFactorMin);
  const hi = Math.round(baseGemPrice * gameConfig.marketFactorMax);
  return [lo, hi];
}
