/**
 * Forecast Score —— 天气预报定价方案的评价函数。
 *
 * 设计原则（来自 Forecast Economy Autonomous Lab 规则）：
 *  - 目标**不是**让 ForecastBot 的 EV 最大化；
 *  - 而是找到「有时值得买、有时不值得买」的真实策略选项；
 *  - 同时保证不买预报依然完全可玩，且滥用预报会明显吃亏。
 *
 * 因此总分由「健康度分量」与「惩罚项」组成：
 *   noForecastViability  20  NoForecast 仍然完全可玩
 *   purchaseDiversity    20  Adaptive 购买率落在 20%~70%（不是 0% 也不是 100%）
 *   forecastEVBalance    20  Adaptive 与 NoForecast 的 EV 差距小（互有胜负）
 *   decisionUtility      15  有效预报率（看了真的改行动）
 *   packUsage            15  套餐使用率（买了用不掉 = 套餐太大）
 *   damageEfficiency     10  每 100 元预报支出换来的伤害减少
 *   abusePenalty        -25  ForecastAbuser 成为最优 → 重罚
 *   dominantOpening     -15  Adaptive 几乎开局必买 → 固定开局模板
 */
import type { BotSummary } from '../../src/simulation/metrics';
import type { ForecastSummary } from '../../src/simulation/metrics';

export interface ScoreBreakdown {
  total: number;
  noForecastViability: number;
  purchaseDiversity: number;
  forecastEVBalance: number;
  decisionUtility: number;
  packUsage: number;
  damageEfficiency: number;
  abusePenalty: number;
  dominantOpeningPenalty: number;
  notes: string[];
}

export interface ScoreInputs {
  /** 用于包/局统计的对局数（每个 Bot 的 runs 相同，取第一个） */
  runsPerBot: number;
  summaries: Record<string, BotSummary>;
  /**
   * UI 一致性分量（0~1）：由浏览器 E2E 验收结果注入。
   * 自动化搜索阶段默认 1（因为搜索不验证 UI），最终候选必须由浏览器验收复核。
   */
  uiConsistency?: number;
}

/** 目标区间：Adaptive 购买率健康带 */
export const PURCHASE_BAND = { lo: 20, hi: 70, ideal: 45 } as const;
/** Adaptive 相对 NoForecast 的 EV 允许区间（比例） */
export const EV_BAND = { lo: -0.12, hi: 0.12 } as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function forecastScore(input: ScoreInputs): ScoreBreakdown {
  const notes: string[] = [];
  const s = input.summaries;
  const none = s['NoForecastBot'];
  const light = s['LightForecastBot'];
  const adaptive = s['AdaptiveForecastBot'];
  const heavy = s['HeavyForecastBot'];
  const abuser = s['ForecastAbuserBot'];
  if (!none || !adaptive || !light || !heavy || !abuser) {
    throw new Error('forecastScore 需要全部 5 个预报 Bot 的结果');
  }
  const ui = clamp(input.uiConsistency ?? 1, 0, 1);

  /* --- 1. NoForecast 可玩性（20） --- */
  // 胜率 85% 记满分；EV 必须为正
  const winPart = clamp(none.winRate / 85, 0, 1) * 12;
  const evPart = none.evNetProfitAllRuns > 0 ? 8 : clamp(1 + none.evNetProfitAllRuns / 2000, 0, 0) * 4;
  const noForecastViability = round2((winPart + evPart) * ui);
  if (none.winRate < 60) notes.push(`NoForecast 胜率仅 ${none.winRate}%：不买预报已不再完全可玩`);
  if (none.evNetProfitAllRuns <= 0) notes.push(`NoForecast EV ${none.evNetProfitAllRuns} ≤ 0：不买预报是负期望`);

  /* --- 2. 购买率多样性（20） --- */
  const pr = adaptive.forecast.purchaseRate;
  let purchaseDiversity: number;
  if (pr <= 0) {
    purchaseDiversity = 0;
    notes.push('Adaptive 购买率 0%：天气预报形同不存在');
  } else if (pr >= 100) {
    purchaseDiversity = 0;
    notes.push('Adaptive 购买率 100%：变成必买');
  } else {
    // 以理想值 45% 为中心，在 [0, ideal] 与 [ideal, 100] 两段各自线性衰减到带宽边缘
    const d = pr <= PURCHASE_BAND.ideal
      ? 1 - (PURCHASE_BAND.ideal - pr) / PURCHASE_BAND.ideal
      : 1 - (pr - PURCHASE_BAND.ideal) / (100 - PURCHASE_BAND.ideal);
    purchaseDiversity = round2(clamp(d, 0, 1) * 20);
    if (pr < PURCHASE_BAND.lo || pr > PURCHASE_BAND.hi) {
      notes.push(`Adaptive 购买率 ${pr}% 落在健康带 ${PURCHASE_BAND.lo}~${PURCHASE_BAND.hi}% 之外`);
    }
  }

  /* --- 3. EV 平衡（20） --- */
  const base = Math.max(1, Math.abs(none.evNetProfitAllRuns));
  const delta = (adaptive.evNetProfitAllRuns - none.evNetProfitAllRuns) / base;
  let forecastEVBalance: number;
  if (delta < EV_BAND.lo) {
    forecastEVBalance = 0;
    notes.push(`Adaptive EV 比 NoForecast 低 ${(delta * 100).toFixed(1)}%：买预报是纯亏`);
  } else if (delta > EV_BAND.hi) {
    forecastEVBalance = round2(clamp(1 - (delta - EV_BAND.hi) / 0.35, 0, 1) * 20);
    notes.push(`Adaptive EV 比 NoForecast 高 ${(delta * 100).toFixed(1)}%：预报开始碾压不买`);
  } else {
    forecastEVBalance = 20;
  }

  /* --- 4. 决策有效性（15） --- */
  const dur = adaptive.forecast.decisionUtilityRate;
  const decisionUtility = round2(clamp(dur / 45, 0, 1) * 15);
  if (adaptive.forecast.avgChargesUsed !== 0 && dur < 10) {
    notes.push(`有效预报率仅 ${dur}%：绝大多数预报只是"看一眼"`);
  }

  /* --- 5. 套餐使用率（15） --- */
  const uso = adaptive.forecast.packUsageRate;
  let packUsage: number;
  if (adaptive.forecast.avgPacks === 0) {
    packUsage = 0;
  } else if (uso >= 85) {
    packUsage = 15;
  } else if (uso < 50) {
    packUsage = round2(clamp((uso / 50) * 7.5, 0, 7.5));
    notes.push(`套餐使用率 ${uso}% < 50%：套餐太大，买来的次数用不掉`);
  } else {
    packUsage = round2(7.5 + ((uso - 50) / 35) * 7.5);
  }

  /* --- 6. 每 100 元换来的伤害减少（10） --- */
  // 参考锚点：0.35 点/100 元 记满分（沙尘暴/暴雨一格的量级）
  const damageEfficiency = round2(clamp(adaptive.forecast.damageReductionPer100 / 0.35, 0, 1) * 10);

  /* --- 惩罚：Abuser 统治（-25） --- */
  const allEVs = [none, light, adaptive, heavy, abuser].map((b) => b.evNetProfitAllRuns);
  const maxEV = Math.max(...allEVs);
  let abusePenalty = 0;
  if (abuser.evNetProfitAllRuns >= maxEV) {
    abusePenalty = 25;
    notes.push('ForecastAbuser EV 全场第一：预报被滥用成为最优策略');
  } else if (abuser.evNetProfitAllRuns > adaptive.evNetProfitAllRuns) {
    abusePenalty = 12;
    notes.push('ForecastAbuser EV 高于 Adaptive：过度购买没有被惩罚');
  }
  if (heavy.evNetProfitAllRuns >= maxEV) {
    abusePenalty = Math.max(abusePenalty, 18);
    notes.push('HeavyForecastBot EV 全场第一：过度囤预报反而占优');
  }
  // 滥用者胜率也碾压 → 加重
  if (abuser.winRate >= none.winRate) {
    abusePenalty = Math.min(25, abusePenalty + 6);
    notes.push(`ForecastAbuser 胜率 ${abuser.winRate}% ≥ NoForecast ${none.winRate}%`);
  }

  /* --- 惩罚：固定开局模板（-15） --- */
  let dominantOpeningPenalty = 0;
  if (adaptive.forecast.purchaseRate > 90) {
    dominantOpeningPenalty = 15;
    notes.push(`Adaptive ${adaptive.forecast.purchaseRate}% 的局都买了预报：Possible Dominant Forecast Opening`);
  } else if (adaptive.forecast.purchaseRate > 82) {
    dominantOpeningPenalty = 7;
    notes.push(`Adaptive 购买率 ${adaptive.forecast.purchaseRate}% 偏高，存在固定开局风险`);
  }

  const total = round2(
    noForecastViability +
      purchaseDiversity +
      forecastEVBalance +
      decisionUtility +
      packUsage +
      damageEfficiency -
      abusePenalty -
      dominantOpeningPenalty,
  );

  return {
    total,
    noForecastViability,
    purchaseDiversity,
    forecastEVBalance,
    decisionUtility,
    packUsage,
    damageEfficiency,
    abusePenalty,
    dominantOpeningPenalty,
    notes,
  };
}

export const SCORE_WEIGHTS = {
  noForecastViability: 20,
  purchaseDiversity: 20,
  forecastEVBalance: 20,
  decisionUtility: 15,
  packUsage: 15,
  damageEfficiency: 10,
  abusePenaltyMax: -25,
  dominantOpeningMax: -15,
} as const;

export type { ForecastSummary };
