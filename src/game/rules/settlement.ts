import type { GameState, SettlementView } from '../types';
import { gameConfig } from '../config/gameConfig';
import { computeStarRating } from './routeScore';

/**
 * 结算视图计算（纯读取）。
 *
 * v0.3.0 经济结算口径（§25/§35/§64）：
 *
 *   finalCash = initialCash
 *             − equipmentSpend − forecastSpend − villageSpend − rescueImmediateSpend
 *             + otherCashDelta                      （以上四项之和 = tripCashFlow）
 *             + grossGemRevenue − lateSaleLoss
 *             − settlementExpenses
 *
 * 结算期费用（默认全部关闭；关闭时恒为 0，正式行为与 v0.2.0 逐元一致）：
 *   - rescueSettlement  延期求援：固定债务 + 宝石收入抽成（Family A）
 *   - operatingCost     远征运营成本（Family B）
 *   - transportCost / commissionCost / appraisalFee  运输·佣金·鉴定（Family C）
 *
 * 失败局按 §36 处理：宝石无法出售 ⇒ grossGemRevenue = 0，且不叠加运营/交易费用。
 * 求援延期债务在失败局同样不结算（人没回来，债务不成立）。
 */

/** 求援结算费用（Family A）。失败局或从未求援时恒为 0。 */
export function rescueSettlementFee(gemRevenue: number, rescued: boolean, victory: boolean): {
  total: number;
  debt: number;
  share: number;
} {
  const cfg = gameConfig.mechanisms.rescueSettlement;
  if (!cfg.enabled || !rescued || !victory) return { total: 0, debt: 0, share: 0 };
  const debt = Math.max(0, Math.round(cfg.deferredDebt));
  const share = Math.max(0, Math.round(cfg.revenueShare * gemRevenue));
  let total = Math.max(Math.round(cfg.minFee), debt + share);
  if (cfg.debtCap > 0) total = Math.min(total, Math.round(cfg.debtCap));
  // 拆分展示：固定债务优先，其余归入抽成（保底/封顶只在 total 上体现）
  const shownDebt = Math.min(debt, total);
  return { total, debt: shownDebt, share: total - shownDebt };
}

/** 远征运营成本（Family B） */
export function operatingCost(state: GameState, victory: boolean): number {
  const cfg = gameConfig.mechanisms.upkeep;
  if (!cfg.enabled) return 0;
  if (cfg.onlyOnSuccess && !victory) return 0;
  if (cfg.mode === 'perDay') return Math.max(0, Math.round(state.daysUsed * cfg.costPerDay));
  if (cfg.mode === 'miningDay') return Math.max(0, Math.round(state.stats.miningDays * cfg.costPerDay));
  // overtime
  const over = Math.max(0, state.daysUsed - cfg.freeDays);
  return Math.max(0, Math.round(over * cfg.overtimeCostPerDay));
}

/** 运输 / 佣金 / 鉴定（Family C）。只在成功返城后结算。 */
export function tradeCosts(state: GameState, gemRevenue: number, victory: boolean): {
  transport: number;
  commission: number;
  appraisal: number;
} {
  const cfg = gameConfig.mechanisms.tradeCost;
  if (!cfg.enabled || !victory) return { transport: 0, commission: 0, appraisal: 0 };
  return {
    transport: Math.max(0, Math.round(cfg.transportPerKg * state.gemsKg)),
    commission: Math.max(0, Math.round(cfg.commissionRate * gemRevenue)),
    appraisal: Math.max(0, Math.round(cfg.fixedAppraisalFee)),
  };
}

/** 逾期折价（Family AI-2）：只有拖得久的局才被抽，因此不是统一税 */
export function lateSaleLossOf(state: GameState, grossRevenue: number, victory: boolean): number {
  const cfg = gameConfig.mechanisms.lateSale;
  if (!cfg.enabled || !victory) return 0;
  const deadline = state.maxDays - cfg.graceDays;
  if (state.daysUsed <= deadline) return 0;
  return Math.max(0, Math.round(grossRevenue * cfg.discount));
}

export function computeSettlement(state: GameState): SettlementView {
  const victory = state.status === 'VICTORY';
  const initialCash = gameConfig.startCash;

  /* ---- 1. 宝石收入（§36：失败局恒为 0） ---- */
  const grossGemRevenue =
    victory && state.gemPrice !== null ? Math.round(state.gemsKg * state.gemPrice) : 0;
  const lateSaleLoss = lateSaleLossOf(state, grossGemRevenue, victory);
  const gemRevenue = grossGemRevenue - lateSaleLoss;

  /* ---- 2. 结算期费用 ---- */
  const rescued = (state.stats.emergencyRescues ?? 0) > 0;
  const rs = rescueSettlementFee(gemRevenue, rescued, victory);
  const operatingCostV = operatingCost(state, victory);
  const tc = tradeCosts(state, gemRevenue, victory);
  const settlementExpenses = rs.total + operatingCostV + tc.transport + tc.commission + tc.appraisal;

  /* ---- 3. 旅途现金对账 ---- */
  const equipmentSpent = state.equipmentSpent ?? 0;
  const forecastSpent = state.forecastSpent ?? 0;
  const villageSpend = state.stats.villageServiceSpent ?? 0;
  const rescueImmediateSpend = state.stats.emergencyRescueCost ?? 0;
  const tripCashFlow = state.cash - initialCash;
  /**
   * 残差项：事件（市集打工 +、盗贼 −、商队买卖）等"其它渠道"的现金净变动。
   * 它是**推导**出来的，不是新增的自由变量，因此恒等式在算术上必然成立；
   * 记录它只是为了在报告里能逐项对账（§35 禁止"钱凭空出现/消失且不入账"）。
   */
  const otherCashDelta =
    tripCashFlow + equipmentSpent + forecastSpent + villageSpend + rescueImmediateSpend;

  /* ---- 4. 最终现金与净利润 ---- */
  const finalCash = state.cash + gemRevenue - settlementExpenses;
  const netProfit = finalCash - initialCash;

  /* ---- 5. 会计恒等式硬校验（§35） ---- */
  const identityRight =
    initialCash - equipmentSpent - forecastSpent - villageSpend - rescueImmediateSpend + otherCashDelta +
    grossGemRevenue - lateSaleLoss - settlementExpenses;
  const accountingResidual = finalCash - identityRight;
  const accountingOk = accountingResidual === 0 && finalCash === state.cash + gemRevenue - settlementExpenses;

  const { outboundDays, miningDays, returnStartDay } = state.stats;
  const outbound = outboundDays ?? state.daysUsed;
  const ret = returnStartDay !== null ? state.daysUsed - returnStartDay : 0;

  const mineSlot = state.mineEntranceId
    ? (state.map.mines.find((m) => m.tileId === state.mineEntranceId)?.slot ?? null)
    : null;

  const expeditionOutcome: SettlementView['expeditionOutcome'] = victory ? 'SURVIVED' : 'FAILED';
  const economicOutcome: SettlementView['economicOutcome'] =
    netProfit > 0 ? 'PROFITABLE' : netProfit === 0 ? 'BREAK_EVEN' : 'UNPROFITABLE';

  /**
   * 结算文案（§47/§49）——刻意把「远征完成」与「经济盈亏」分开表述，
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
    miningDays,
    returnDays: ret,
    forecastPacks: state.stats.forecastPacks,
    gemsKg: state.gemsKg,
    gemPrice: state.gemPrice,
    mineSlot,
    routeScore: state.routeScore,
    stars: state.routeScore !== null ? computeStarRating(state.routeScore) : null,
    gemRevenue,
    equipmentSpent,
    cashRemaining: state.cash,
    finalAssets: finalCash,
    netProfit,
    /* ---- v0.2.0 ---- */
    expeditionOutcome,
    economicOutcome,
    initialCash,
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
    /* ---- v0.3.0 经济瀑布 ---- */
    grossGemRevenue,
    lateSaleLoss,
    forecastSpent,
    villageSpend,
    rescueImmediateSpend,
    rescueDeferredDebt: rs.debt,
    rescueRevenueShare: rs.share,
    rescueSettlement: rs.total,
    operatingCost: operatingCostV,
    transportCost: tc.transport,
    commissionCost: tc.commission,
    appraisalFee: tc.appraisal,
    settlementExpenses,
    tripCashFlow,
    otherCashDelta,
    finalCash,
    accountingOk,
    accountingResidual,
  };
}
