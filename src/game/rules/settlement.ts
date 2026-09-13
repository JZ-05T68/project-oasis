import { GameState, SettlementView } from '../types';
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
  let outbound: number;
  if (outboundDays !== null) {
    outbound = outboundDays;
  } else {
    // 未进入过矿区：全部天数都算去程
    outbound = state.daysUsed;
  }
  const mining = miningDays;
  let ret: number;
  if (returnStartDay !== null) {
    ret = state.daysUsed - returnStartDay;
  } else {
    ret = 0;
  }

  return {
    outcome: state.status,
    defeatReason: state.defeatReason,
    seed: state.seed,
    daysUsed: state.daysUsed,
    outboundDays: outbound,
    miningDays: mining,
    returnDays: ret,
    forecastCount: state.stats.forecastCount,
    gemsKg: state.gemsKg,
    routeScore: state.routeScore,
    stars: state.routeScore !== null ? computeStarRating(state.routeScore) : null,
    baseGemPrice: state.baseGemPrice,
    marketFactor: state.marketFactor,
    gemPrice: state.gemPrice,
    gemRevenue,
    equipmentSpent: state.equipmentSpent,
    cashRemaining: state.cash,
    finalAssets,
    netProfit: finalAssets - gameConfig.startCash,
  };
}
