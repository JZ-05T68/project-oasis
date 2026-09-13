import type { GameState, SettlementView } from '../types';
import { gameConfig } from '../config/gameConfig';
import { computeStarRating } from './routeScore';

/**
 * 结算视图计算（纯读取）。
 * 胜利：finalAssets = 剩余现金 + 宝石销售额；netProfit = finalAssets - 2000。
 * 失败：宝石无法出售，销售额为 0。
 */
export function computeSettlement(state: GameState): SettlementView {
  const victory = state.status === 'VICTORY';
  const gemRevenue = victory && state.gemPrice !== null ? Math.round(state.gemsKg * state.gemPrice) : 0;
  const finalAssets = state.cash + gemRevenue;

  const { outboundDays, miningDays, returnStartDay } = state.stats;
  const outbound = outboundDays ?? state.daysUsed;
  const ret = returnStartDay !== null ? state.daysUsed - returnStartDay : 0;

  const mineSlot = state.mineEntranceId
    ? (state.map.mines.find((m) => m.tileId === state.mineEntranceId)?.slot ?? null)
    : null;

  return {
    outcome: state.status,
    defeatReason: state.defeatReason,
    seed: state.seed,
    daysUsed: state.daysUsed,
    maxDays: state.maxDays,
    outboundDays: outbound,
    miningDays: miningDays,
    returnDays: ret,
    forecastPacks: state.stats.forecastPacks,
    gemsKg: state.gemsKg,
    gemPrice: state.gemPrice,
    mineSlot,
    routeScore: state.routeScore,
    stars: state.routeScore !== null ? computeStarRating(state.routeScore) : null,
    gemRevenue,
    equipmentSpent: state.equipmentSpent,
    cashRemaining: state.cash,
    finalAssets,
    netProfit: finalAssets - gameConfig.startCash,
  };
}
