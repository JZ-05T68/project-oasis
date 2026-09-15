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

  /* ---- v0.2.0 Outcome 拆分（§5/§46/§47） ---- */
  const netProfit = finalAssets - gameConfig.startCash;
  const expeditionOutcome: SettlementView['expeditionOutcome'] = victory ? 'SURVIVED' : 'FAILED';
  const economicOutcome: SettlementView['economicOutcome'] =
    netProfit > 0 ? 'PROFITABLE' : netProfit === 0 ? 'BREAK_EVEN' : 'UNPROFITABLE';

  /**
   * 结算文案（§47 建议）——刻意把「远征完成」与「经济盈亏」分开表述，
   * 因为「成功返城但亏损」是一种真实且合法的结果，不是游戏失败。
   */
  let verdictHeadline: string;
  let verdictDetail: string;
  if (!victory) {
    verdictHeadline = '远征失败';
    verdictDetail = '你未能完成本次远征。';
  } else if (economicOutcome === 'PROFITABLE') {
    verdictHeadline = '远征成功';
    verdictDetail = '你安全返回城市，并实现盈利。';
  } else if (economicOutcome === 'BREAK_EVEN') {
    verdictHeadline = '远征完成';
    verdictDetail = '你安全返回城市，本次远征刚好保本。';
  } else {
    verdictHeadline = '远征完成';
    verdictDetail = '你安全返回城市，但本次远征产生亏损。';
  }

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
    netProfit,
    /* ---- v0.2.0 ---- */
    expeditionOutcome,
    economicOutcome,
    initialCash: gameConfig.startCash,
    verdictHeadline,
    verdictDetail,
    villageServiceSpent: state.stats.villageServiceSpent ?? 0,
    villageServicesUsed: state.stats.villageServicesUsed ?? 0,
    villageStaminaRecovered: state.stats.villageStaminaRecovered ?? 0,
    surgeMiningUses: state.stats.surgeMiningUses ?? 0,
    surgeMiningExtraKg: state.stats.surgeMiningExtraKg ?? 0,
    emergencyRescues: state.stats.emergencyRescues ?? 0,
    emergencyRescueCost: state.stats.emergencyRescueCost ?? 0,
    returnIntelTiles: state.stats.returnIntelTiles ?? 0,
  };
}
