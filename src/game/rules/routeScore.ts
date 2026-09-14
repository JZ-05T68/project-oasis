import type { GameState, TileId } from '../types';
import { gameConfig } from '../config/gameConfig';
import { isNormalTile, returnViaFilterExcept } from './movement';
import { countNodeDisjointPaths, dijkstraPath } from '../map/grid';

/**
 * 路线风险评分（v0.1.2）。
 *
 * 评分只用于统计与展示（结算页风险评级、调试、仿真分析），
 * 【不】影响宝石售价——售价在地图生成时按矿区客观价值确定。
 */

export interface RouteScoreResult {
  score: number;
  stars: number;
  outboundRisk: number;
  returnRisk: number;
  /** 节点不重叠返程路径数（可替代返程走廊数） */
  returnPathCount: number;
  returnPathTruncated: boolean;
}

function tileRiskOf(state: GameState, id: TileId): number {
  return gameConfig.tileRisk[state.map.tiles[id].terrain] ?? 0;
}

/** 节点不重叠返程路径计数（Menger 风格，上限 4；当前矿区可穿透，其它矿区禁行） */
function countNodeDisjointReturnPaths(state: GameState, forbidden: TileId[]): { count: number; truncated: boolean } {
  const filter = returnViaFilterExcept(state.map, state.mineEntranceId);
  const count = countNodeDisjointPaths(state.map, state.position, state.map.cityId, forbidden, 4, filter);
  return { count, truncated: count >= 4 };
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

/** 计算进矿时刻的路线风险评分（基于玩家实际去程路径的统计值） */
export function computeRouteScore(state: GameState): RouteScoreResult {
  const mineId = state.position;
  const cityId = state.map.cityId;

  const outboundTiles = state.visitedOutbound.filter((id) => {
    if (id === cityId || id === mineId) return false;
    return isNormalTile(state.map, id);
  });
  const outboundRisk = outboundTiles.reduce((s, id) => s + tileRiskOf(state, id), 0);
  const outboundLen = state.visitedOutbound.length - 1;

  // 最优返程：风险加权 Dijkstra（避开去程已烧格）
  const forbidden = state.visitedOutbound.filter((id) => isNormalTile(state.map, id));
  const bestReturn = dijkstraPath(
    state.map,
    mineId,
    cityId,
    (id) => Math.min(10, Math.max(0.5, tileRiskOf(state, id))),
    forbidden,
    returnViaFilterExcept(state.map, mineId),
  );
  if (!bestReturn) {
    throw new Error('computeRouteScore 前置条件不满足：不存在合法返程路径');
  }
  const returnRisk = bestReturn.path.reduce((s, id) => s + tileRiskOf(state, id), 0);
  const minReturnLen = bestReturn.path.length - 1;
  const { count: disjointCount, truncated } = (() => {
    const r = countNodeDisjointReturnPaths(state, forbidden);
    return { count: r.count, truncated: r.truncated };
  })();

  const slack = state.maxDays - (outboundLen + minReturnLen);
  const slackPenalty =
    slack < gameConfig.slackComfortDays
      ? (gameConfig.slackComfortDays - slack) * gameConfig.slackPenaltyPerDay
      : 0;

  const effectiveCount = truncated ? 4 : disjointCount;
  const scarcityPenalty =
    effectiveCount >= 4
      ? gameConfig.scarcityPenaltyByPathCount[3]
      : gameConfig.scarcityPenaltyByPathCount[effectiveCount - 1];

  const score = Math.round((outboundRisk + returnRisk + slackPenalty + scarcityPenalty) * 10) / 10;
  return {
    score,
    stars: computeStarRating(score),
    outboundRisk: Math.round(outboundRisk * 10) / 10,
    returnRisk: Math.round(returnRisk * 10) / 10,
    returnPathCount: disjointCount,
    returnPathTruncated: truncated,
  };
}
