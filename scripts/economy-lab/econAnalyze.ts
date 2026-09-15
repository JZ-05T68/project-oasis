import type { BotSummary, RunResult } from '../../src/simulation/metrics';
import { aggregateBot, aggregateOutcome } from '../../src/simulation/metrics';

/**
 * v0.3.0 Economic Independence Lab —— 分析核心（§25/§26/§27/§28/§62~§65）。
 *
 * 一级指标（§28 Economic Independence Score 的分子）：
 *   completionRate        目标 68~72%（硬约束，§22）
 *   profitableRate        目标 42~48%
 *   profitAmongCompleted  健康参考 60~70%
 *   completedLossShare    目标 20~30%（总体口径）
 *   decisionChange        目标 >10%（§43 G5）
 *
 * 所有比例都同时给 95% CI（§42）。
 */

const HIGH_PROFIT_THRESHOLD = 3000; // §63 四层分布里"高收益"的切分点（文档化，不随候选变）

export interface EconMetrics {
  variant: string;
  bot: string;
  runs: number;
  errors: number;
  summary: BotSummary;
  outcome: ReturnType<typeof aggregateOutcome>;

  /* ---- 一级指标 ---- */
  completionRate: number;
  profitableRate: number;
  profitAmongCompleted: number;
  /** 成功返城局里「亏损或保本」占比（§43 G4 用总体口径，这里给成功局口径） */
  completedLossShare: number;
  /** 总体口径：全部开局里「成功返城但亏损」的占比（§43 G4） */
  overallCompletedLossShare: number;
  breakEvenShare: number;
  /** |Completion − Profitability|，理想 ≈25pp（§29） */
  gapPP: number;

  /* ---- 95% CI ---- */
  ci: {
    completion: [number, number];
    profitability: [number, number];
    profitAmongCompleted: [number, number];
    completedLossShare: [number, number];
  };

  /* ---- §63 四层 Outcome ---- */
  layers: {
    failed: number;
    survivedLoss: number;
    survivedProfit: number;
    survivedHighProfit: number;
  };

  /* ---- §64 经济瀑布（均值，元） ---- */
  waterfall: {
    initialCash: number;
    equipmentSpend: number;
    forecastSpend: number;
    villageSpend: number;
    rescueImmediateSpend: number;
    tripCashFlow: number;
    otherCashDelta: number;
    grossGemRevenue: number;
    lateSaleLoss: number;
    rescueSettlement: number;
    rescueDeferredDebt: number;
    rescueRevenueShare: number;
    operatingCost: number;
    transportCost: number;
    commissionCost: number;
    appraisalFee: number;
    settlementExpenses: number;
    finalCash: number;
    netProfit: number;
  };
  /** 分组瀑布：成功盈利 / 成功亏损 / 求援局 / 非求援局 */
  groups: Record<string, GroupWaterfall>;

  /* ---- §65 利润分布 ---- */
  profitDist: { min: number; p10: number; p25: number; median: number; p75: number; p90: number; max: number; mean: number };
  lossDist: { n: number; mean: number; median: number; max: number };

  /* ---- §9 求援支配检查 ---- */
  rescue: {
    useRate: number;
    /** 求援局里的完成率 % */
    completionAmongRescued: number;
    /** 求援局里的盈利率 % */
    profitabilityAmongRescued: number;
    avgDebt: number;
    avgShare: number;
    /** 非求援局盈利率 %（与上面对比，决定是否形成"求援=亏损"的可解释故事） */
    profitabilityAmongNonRescued: number;
    completionAmongNonRescued: number;
    dominance: boolean;
  };

  /* ---- §27 谁在亏钱（成功亏损局的原因归因） ---- */
  lossAttribution: {
    n: number;
    rescuedShare: number;
    longTripShare: number;
    heavyEquipmentShare: number;
    otherShare: number;
  };

  /* ---- 决策改变率（§31 aware vs blind / vs 基线） ---- */
  dc: EconDecisionChange;

  /* ---- 机制使用多样性（§28） ---- */
  diversity: {
    rescueUseRate: number;
    dropRate: number;
    miningDaysEntropy: number;
    topMiningDayShare: number;
    distinctMiningDays: number;
    avgMiningDays: number;
  };

  /* ---- 失败结构（§24） ---- */
  topFailureReason: string;
  topFailureShare: number;

  /* ---- §43 G9~G12 既有机制健康度 ---- */
  health: {
    /** 天气预报购买率 %（G9） */
    forecastBuyRate: number;
    /** 两矿使用率 %（G10） */
    mineAShare: number;
    mineBShare: number;
    /** 负重返程惩罚平均天数（G12） */
    avgLoadPenaltyDays: number;
    /** 平均总天数 / 平均采矿天数（G11 观测） */
    avgDaysUsed: number;
    avgGemsKg: number;
  };

  /* ---- §35 会计 ---- */
  accountingViolations: number;
  maxResidual: number;
}

export interface GroupWaterfall {
  n: number;
  initialCash: number;
  tripCashFlow: number;
  grossGemRevenue: number;
  lateSaleLoss: number;
  rescueSettlement: number;
  operatingCost: number;
  otherSettlement: number;
  settlementExpenses: number;
  finalCash: number;
  netProfit: number;
  daysUsed: number;
  miningDays: number;
  gemsKg: number;
}

export interface EconDecisionChange {
  n: number;
  overall: number;
  mining: number;
  rescue: number;
  dropCargo: number;
  outcomeFlip: number;
  profitFlip: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
function pct(k: number, n: number): number {
  return r2((k / Math.max(1, n)) * 100);
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}
/** 正态近似 95% CI（§42） */
function ci95(p: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const pp = p / 100;
  const se = Math.sqrt(Math.max(0, pp * (1 - pp)) / n);
  return [r2(Math.max(0, (pp - 1.96 * se) * 100)), r2(Math.min(100, (pp + 1.96 * se) * 100))];
}
function normalizeEntropy(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0 || counts.length <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / n;
    h -= p * Math.log(p);
  }
  return r2(h / Math.log(counts.length));
}

function groupWaterfall(rs: RunResult[]): GroupWaterfall {
  const n = rs.length;
  return {
    n,
    initialCash: 2000,
    tripCashFlow: r2(mean(rs.map((x) => x.tripCashFlow ?? 0))),
    grossGemRevenue: r2(mean(rs.map((x) => x.grossGemRevenue ?? 0))),
    lateSaleLoss: r2(mean(rs.map((x) => x.lateSaleLoss ?? 0))),
    rescueSettlement: r2(mean(rs.map((x) => x.rescueSettlement ?? 0))),
    operatingCost: r2(mean(rs.map((x) => x.operatingCost ?? 0))),
    otherSettlement: r2(
      mean(rs.map((x) => (x.transportCost ?? 0) + (x.commissionCost ?? 0) + (x.appraisalFee ?? 0))),
    ),
    settlementExpenses: r2(mean(rs.map((x) => x.settlementExpenses ?? 0))),
    finalCash: r2(mean(rs.map((x) => x.finalCash ?? x.finalAssets))),
    netProfit: r2(mean(rs.map((x) => x.netProfit))),
    daysUsed: r2(mean(rs.map((x) => x.daysUsed))),
    miningDays: r2(mean(rs.map((x) => x.miningDays))),
    gemsKg: r2(mean(rs.map((x) => x.gemsKg))),
  };
}

export function computeEconMetrics(
  variant: string,
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): EconMetrics {
  const summary = aggregateBot(results);
  const outcome = aggregateOutcome(results);
  const n = Math.max(1, results.length);

  const completed = results.filter((r) => (r.expeditionCompleted ?? r.status === 'VICTORY') && !r.error);
  const profitable = results.filter((r) => r.netProfit > 0 && !r.error);
  const completedProfitable = completed.filter((r) => r.netProfit > 0);
  const completedLoss = completed.filter((r) => r.netProfit <= 0);
  const breakEven = completed.filter((r) => r.netProfit === 0);
  const highProfit = completed.filter((r) => r.netProfit > HIGH_PROFIT_THRESHOLD);

  const completionRate = pct(completed.length, n);
  const profitableRate = pct(profitable.length, n);
  const profitAmongCompleted = pct(completedProfitable.length, completed.length);
  const completedLossShare = pct(completedLoss.length, completed.length);
  const overallCompletedLossShare = pct(completedLoss.length, n);

  /* ---- 求援支配检查（§9） ---- */
  const rescued = results.filter((r) => (r.emergencyRescues ?? 0) > 0);
  const nonRescued = results.filter((r) => (r.emergencyRescues ?? 0) === 0);
  const completedOf = (rs: RunResult[]) => rs.filter((r) => (r.expeditionCompleted ?? r.status === 'VICTORY') && !r.error).length;
  const profitableOf = (rs: RunResult[]) => rs.filter((r) => r.netProfit > 0 && !r.error).length;
  const rescueUseRate = pct(rescued.length, n);

  /* ---- §27 谁在亏钱：成功亏损局归因 ---- */
  const medianDays = (() => {
    const ds = completed.map((r) => r.daysUsed).sort((a, b) => a - b);
    return quantile(ds, 0.5);
  })();
  const medianEquip = (() => {
    const es = completed.map((r) => r.equipmentSpent).sort((a, b) => a - b);
    return quantile(es, 0.5);
  })();
  let aRescue = 0, aLong = 0, aEquip = 0, aOther = 0;
  for (const r of completedLoss) {
    if ((r.rescueSettlement ?? 0) > 0) aRescue += 1;
    else if (r.daysUsed > medianDays) aLong += 1;
    else if (r.equipmentSpent > medianEquip) aEquip += 1;
    else aOther += 1;
  }
  const ln = Math.max(1, completedLoss.length);

  /* ---- 利润分布 ---- */
  const profits = completed.map((r) => r.netProfit).sort((a, b) => a - b);
  const losses = completedLoss.map((r) => r.netProfit).sort((a, b) => a - b);

  /* ---- 决策改变（相对基线，同 Bot 同 Seed） ---- */
  const dc = computeEconDecisionChange(results, baseBySeed);

  /* ---- 失败结构 ---- */
  const failed = results.filter((r) => r.status !== 'VICTORY' || r.error);
  const reasonCounts: Record<string, number> = {};
  for (const r of failed) {
    const k = r.defeatReason ?? 'UNKNOWN';
    reasonCounts[k] = (reasonCounts[k] ?? 0) + 1;
  }
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  /* ---- 会计 ---- */
  const violations = results.filter((r) => r.accountingOk === false).length;
  const maxResidual = results.reduce((a, r) => Math.max(a, Math.abs(r.accountingResidual ?? 0)), 0);

  /* ---- 采矿多样性 ---- */
  const dayCounts = new Map<number, number>();
  for (const r of results) dayCounts.set(r.miningDays, (dayCounts.get(r.miningDays) ?? 0) + 1);
  const counts = [...dayCounts.values()];

  return {
    variant,
    bot: summary.bot,
    runs: results.length,
    errors: summary.errors,
    summary,
    outcome,
    completionRate,
    profitableRate,
    profitAmongCompleted,
    completedLossShare,
    overallCompletedLossShare,
    breakEvenShare: pct(breakEven.length, completed.length),
    gapPP: r2(Math.abs(completionRate - profitableRate)),
    ci: {
      completion: ci95(completionRate, n),
      profitability: ci95(profitableRate, n),
      profitAmongCompleted: ci95(profitAmongCompleted, completed.length),
      completedLossShare: ci95(overallCompletedLossShare, n),
    },
    layers: {
      failed: pct(failed.length, n),
      survivedLoss: pct(completedLoss.length, n),
      survivedProfit: pct(completedProfitable.filter((r) => r.netProfit <= HIGH_PROFIT_THRESHOLD).length, n),
      survivedHighProfit: pct(highProfit.length, n),
    },
    waterfall: {
      initialCash: 2000,
      equipmentSpend: r2(mean(results.map((x) => x.equipmentSpent))),
      forecastSpend: r2(mean(results.map((x) => x.forecastSpent ?? 0))),
      villageSpend: r2(mean(results.map((x) => x.villageSpend ?? 0))),
      rescueImmediateSpend: r2(mean(results.map((x) => x.rescueImmediateSpend ?? 0))),
      tripCashFlow: r2(mean(results.map((x) => x.tripCashFlow ?? 0))),
      otherCashDelta: r2(mean(results.map((x) => x.otherCashDelta ?? 0))),
      grossGemRevenue: r2(mean(results.map((x) => x.grossGemRevenue ?? 0))),
      lateSaleLoss: r2(mean(results.map((x) => x.lateSaleLoss ?? 0))),
      rescueSettlement: r2(mean(results.map((x) => x.rescueSettlement ?? 0))),
      rescueDeferredDebt: r2(mean(results.map((x) => x.rescueDeferredDebt ?? 0))),
      rescueRevenueShare: r2(mean(results.map((x) => x.rescueRevenueShare ?? 0))),
      operatingCost: r2(mean(results.map((x) => x.operatingCost ?? 0))),
      transportCost: r2(mean(results.map((x) => x.transportCost ?? 0))),
      commissionCost: r2(mean(results.map((x) => x.commissionCost ?? 0))),
      appraisalFee: r2(mean(results.map((x) => x.appraisalFee ?? 0))),
      settlementExpenses: r2(mean(results.map((x) => x.settlementExpenses ?? 0))),
      finalCash: r2(mean(results.map((x) => x.finalCash ?? x.finalAssets))),
      netProfit: r2(mean(results.map((x) => x.netProfit))),
    },
    groups: {
      all: groupWaterfall(results),
      completedProfit: groupWaterfall(completedProfitable),
      completedLoss: groupWaterfall(completedLoss),
      rescued: groupWaterfall(rescued),
      nonRescued: groupWaterfall(nonRescued),
    },
    profitDist: {
      min: quantile(profits, 0),
      p10: quantile(profits, 0.1),
      p25: quantile(profits, 0.25),
      median: quantile(profits, 0.5),
      p75: quantile(profits, 0.75),
      p90: quantile(profits, 0.9),
      max: quantile(profits, 1),
      mean: r2(mean(profits)),
    },
    lossDist: {
      n: losses.length,
      mean: r2(mean(losses)),
      median: quantile(losses, 0.5),
      max: quantile(losses, 1),
    },
    rescue: {
      useRate: rescueUseRate,
      completionAmongRescued: pct(completedOf(rescued), rescued.length),
      profitabilityAmongRescued: pct(profitableOf(rescued), rescued.length),
      avgDebt: r2(mean(rescued.map((x) => x.rescueDeferredDebt ?? 0))),
      avgShare: r2(mean(rescued.map((x) => x.rescueRevenueShare ?? 0))),
      profitabilityAmongNonRescued: pct(profitableOf(nonRescued), nonRescued.length),
      completionAmongNonRescued: pct(completedOf(nonRescued), nonRescued.length),
      dominance: rescueUseRate > 70,
    },
    lossAttribution: {
      n: completedLoss.length,
      rescuedShare: pct(aRescue, ln),
      longTripShare: pct(aLong, ln),
      heavyEquipmentShare: pct(aEquip, ln),
      otherShare: pct(aOther, ln),
    },
    dc,
    diversity: {
      rescueUseRate,
      dropRate: pct(results.filter((r) => (r.droppedKg ?? 0) > 0).length, n),
      miningDaysEntropy: normalizeEntropy(counts),
      topMiningDayShare: pct(Math.max(0, ...counts), n),
      distinctMiningDays: dayCounts.size,
      avgMiningDays: r2(mean(results.map((r) => r.miningDays))),
    },
    topFailureReason: topReason?.[0] ?? '—',
    topFailureShare: pct(topReason?.[1] ?? 0, failed.length),
    health: {
      forecastBuyRate: pct(results.filter((r) => (r.forecastPacks ?? 0) > 0).length, n),
      mineAShare: pct(results.filter((r) => r.mineSlot === 'A').length, n),
      mineBShare: pct(results.filter((r) => r.mineSlot === 'B').length, n),
      avgLoadPenaltyDays: r2(mean(results.map((r) => r.loadPenaltyDays ?? 0))),
      avgDaysUsed: r2(mean(results.map((r) => r.daysUsed))),
      avgGemsKg: r2(mean(results.map((r) => r.gemsKg))),
    },
    accountingViolations: violations,
    maxResidual,
  };
}

/**
 * 逐局配对决策改变（§31）。
 * `rescue`：求援**使用与否**出现差异（负债感知最直接的行为证据）。
 * `profitFlip`：盈利/亏损状态与基线相反 —— 这是本轮最想要的"经济决策改变"。
 */
export function computeEconDecisionChange(
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): EconDecisionChange {
  const out: EconDecisionChange = { n: 0, overall: 0, mining: 0, rescue: 0, dropCargo: 0, outcomeFlip: 0, profitFlip: 0 };
  if (!baseBySeed) return out;
  let overall = 0, mining = 0, rescue = 0, drop = 0, flip = 0, pflip = 0;
  for (const r of results) {
    const b = baseBySeed.get(r.seed);
    if (!b) continue;
    out.n += 1;
    const dMining = r.miningDays !== b.miningDays;
    const dRescue = ((r.emergencyRescues ?? 0) > 0) !== ((b.emergencyRescues ?? 0) > 0);
    const dDrop = (r.droppedKg ?? 0) !== (b.droppedKg ?? 0);
    const cA = r.expeditionCompleted ?? r.status === 'VICTORY';
    const cB = b.expeditionCompleted ?? b.status === 'VICTORY';
    const dFlip = cA !== cB;
    const dPFlip = (r.netProfit > 0) !== (b.netProfit > 0);
    if (dMining) mining += 1;
    if (dRescue) rescue += 1;
    if (dDrop) drop += 1;
    if (dFlip) flip += 1;
    if (dPFlip) pflip += 1;
    if (dMining || dRescue || dDrop) overall += 1;
  }
  const n = Math.max(1, out.n);
  out.overall = pct(overall, n);
  out.mining = pct(mining, n);
  out.rescue = pct(rescue, n);
  out.dropCargo = pct(drop, n);
  out.outcomeFlip = pct(flip, n);
  out.profitFlip = pct(pflip, n);
  return out;
}

export function indexBySeed(results: RunResult[]): Map<string, RunResult> {
  const m = new Map<string, RunResult>();
  for (const r of results) m.set(r.seed, r);
  return m;
}

export { HIGH_PROFIT_THRESHOLD };
export type { RunResult, BotSummary };
