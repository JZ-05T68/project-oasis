/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 评价函数。
 *
 * 与 v0.1.4 的 miningScore/returnScore 的关键区别（§36~§38）：
 *   1. **不再把旧 winRate 当核心**，改用 Completion / Profitability 双区间目标；
 *   2. 区间目标：健康带内视为**近似等价**（§37 明确要求"不要 69.9% 比 71.5% 高几十分"）；
 *   3. 新增 economyIndependence 分量（§18）：惩罚 Completion ≈ Profitability；
 *   4. 新增 failureDiversity（§26）与 complexityPenalty（§42）与 villageDominance（§13）。
 *
 * 绝对分值不重要，**能排序**才重要。
 */

export interface OutcomeScoreInput {
  /** 合理玩家代理的完成率 %（§1） */
  completion: number;
  /** 合理玩家代理的总体盈利率 %（§2） */
  profitability: number;
  /** 成功局里的盈利率 % */
  profitAmongCompleted: number;
  /** 决策改变率（整体）% */
  decisionChange: number;
  /** 新机制动作差异率 % */
  newMechanismChange: number;
  /** 单一采矿模板占比 % */
  topMiningDayShare: number;
  distinctMiningDays: number;
  /** 失败结构 */
  topFailureShare: number;
  topFailureReason: string;
  staminaDeathRate: number;
  timeoutRate: number;
  /** 经济 */
  ev: number;
  baseEv: number;
  /** 机制行为 */
  villageStopGivenVisit: number;
  surgeUseRate: number;
  rescueUseRate: number;
  /** 复杂度（§42 预算：≤1 状态变量、≤1 公式、≤1 按钮） */
  complexity: { stateVars: number; formulas: number; buttons: number };
  /** 返程路线切换率 %（Goal B 的既有空间不得被压掉） */
  routeSwitchRate: number;
  baseRouteSwitchRate: number;
  /** Forecast 健康（§22：购买率 15~80%） */
  forecastPurchaseRate: number;
}

export interface OutcomeScore {
  total: number;
  parts: Record<string, number>;
  penalties: Record<string, number>;
  notes: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
function ramp(x: number, a: number, b: number, ra: number, rb: number): number {
  if (a === b) return ra;
  const t = clamp((x - a) / (b - a), 0, 1);
  return ra + t * (rb - ra);
}

/** 区间目标：带内满分，带外线性衰减（§37/§38 的核心） */
function bandScore(x: number, lo: number, hi: number, full: number, falloffOut: number, falloffWidth: number): number {
  if (x >= lo && x <= hi) return full;
  const dist = x < lo ? lo - x : x - hi;
  const t = clamp(dist / falloffWidth, 0, 1);
  return r2(full - t * falloffOut);
}

export const OUTCOME_TARGETS = {
  completion: { center: 70, lo: 68, hi: 72, /** G1 的放宽带 */ acceptLo: 66, acceptHi: 74 },
  profitability: { center: 45, lo: 42, hi: 48, acceptLo: 42, acceptHi: 48 },
  profitAmongCompleted: { lo: 60, hi: 70 },
} as const;

/**
 * OutcomeScore（0~100）。
 *
 * 分量：
 *   completionTarget   22  —— 区间目标（68~72 满分；66~74 半衰减）
 *   profitabilityTarget 22  —— 区间目标（42~48 满分）
 *   economyIndependence 10  —— 惩罚「成功≈赚钱」（§18）
 *   decisionQuality    18  —— 决策改变率 + 新机制动作差异
 *   strategyDiversity   8  —— 无支配采矿模板
 *   failureDiversity    8  —— 无单一失败原因统治（§26）
 *   economyHealth       6  —— EV 不塌（不低于基线 70%）
 *   dominancePenalty   -12 —— 村庄必停点 / 深层采矿必拿 / 单一模板 >90%
 *   complexityPenalty  -8  —— 超出 §42 预算
 *   routeRegression    -8  —— 返程路线多样性被压掉
 */
export function outcomeScore(i: OutcomeScoreInput): OutcomeScore {
  const notes: string[] = [];
  const parts: Record<string, number> = {};
  const penalties: Record<string, number> = {};

  /* 1. Completion Target（22） */
  const T = OUTCOME_TARGETS;
  const comp = i.completion;
  if (comp >= T.completion.lo && comp <= T.completion.hi) {
    parts.completionTarget = 22;
  } else if (comp >= T.completion.acceptLo && comp <= T.completion.acceptHi) {
    // 放宽带内线性给分（离健康带越远越低，但仍然是"接近"）
    const dist = comp < T.completion.lo ? T.completion.lo - comp : comp - T.completion.hi;
    parts.completionTarget = r2(22 - (dist / 4) * 10);
    notes.push(`Completion ${comp}% 落在放宽带（${T.completion.acceptLo}~${T.completion.acceptHi}%）而非健康带（${T.completion.lo}~${T.completion.hi}%）`);
  } else {
    parts.completionTarget = r2(clamp(ramp(comp, 40, T.completion.acceptLo, 0, 12), 0, 12));
    notes.push(`Completion ${comp}% 超出放宽带：${comp < 66 ? '过难' : '过易'}`);
  }

  /* 2. Profitability Target（22） */
  const prof = i.profitability;
  if (prof >= T.profitability.lo && prof <= T.profitability.hi) {
    parts.profitabilityTarget = 22;
  } else {
    const dist = prof < T.profitability.lo ? T.profitability.lo - prof : prof - T.profitability.hi;
    parts.profitabilityTarget = r2(clamp(22 - (dist / 8) * 22, 0, 22));
    notes.push(`Profitability ${prof}% 偏离健康带（${T.profitability.lo}~${T.profitability.hi}%）${dist.toFixed(1)}pp`);
  }

  /* 3. Economy Independence（10）：§18 禁止 Completion ≈ Profitability */
  const gap = i.completion - i.profitability;
  if (gap >= 20 && gap <= 30) {
    parts.economyIndependence = 10; // 健康：成功后的盈利率约 64~71%
  } else if (gap >= 12 && gap <= 38) {
    parts.economyIndependence = 6;
    notes.push(`Completion − Profitability = ${r2(gap)}pp，偏离理想 20~30pp 区间`);
  } else if (gap < 12) {
    parts.economyIndependence = 0;
    notes.push(`Completion ${comp}% ≈ Profitability ${prof}%（差 ${r2(gap)}pp）：活着回来几乎必赚钱，经济层没有独立出来（§18）`);
  } else {
    parts.economyIndependence = 2;
    notes.push(`Completion ${comp}% 与 Profitability ${prof}% 差距 ${r2(gap)}pp 过大（§19）：大多数成功远征经济上都失败`);
  }

  /* 4. Decision Quality（18） */
  const dc = i.decisionChange;
  const nm = i.newMechanismChange;
  const dcPart = dc <= 0 ? 0 : dc < 10 ? r2(ramp(dc, 0, 10, 0, 7)) : dc <= 45 ? r2(ramp(dc, 10, 45, 7, 12)) : r2(ramp(dc, 45, 80, 12, 7));
  const nmPart = nm <= 0 ? 0 : nm < 10 ? r2(ramp(nm, 0, 10, 0, 3)) : r2(ramp(nm, 10, 50, 3, 6));
  parts.decisionQuality = r2(dcPart + nmPart);
  if (dc <= 0) notes.push('整体决策改变率 0%：机制存在但所有 Bot 动作完全相同');
  if (nm <= 0) notes.push('新机制动作差异率 0%：没有任何一局真的用了新机制（Bot 缺陷或机制未被触发）');

  /* 5. Strategy Diversity（8） */
  const shareScore = i.topMiningDayShare > 90 ? 0 : r2(ramp(i.topMiningDayShare, 90, 65, 0, 4));
  const varietyScore = i.distinctMiningDays >= 5 ? 4 : r2(ramp(i.distinctMiningDays, 1, 5, 0, 4));
  parts.strategyDiversity = r2(shareScore + varietyScore);
  if (i.topMiningDayShare > 90) notes.push(`单一采矿天数模板占比 ${i.topMiningDayShare}% > 90%：DOMINANT_STRATEGY`);

  /* 6. Failure Diversity（8）：§26 硬约束 */
  const fs = i.topFailureShare;
  if (fs <= 45) parts.failureDiversity = 8;
  else if (fs <= 60) {
    parts.failureDiversity = r2(ramp(fs, 45, 60, 8, 0));
    notes.push(`单一失败原因（${i.topFailureReason}）占全部失败 ${fs}% > 45%：进入警戒区（§26）`);
  } else {
    parts.failureDiversity = 0;
    notes.push(`单一失败原因（${i.topFailureReason}）占 ${fs}% > 60%：按硬约束默认拒绝候选（§26）`);
  }

  /* 7. Economy Health（6） */
  const ratio = i.baseEv === 0 ? 1 : i.ev / i.baseEv;
  if (i.ev <= 0) {
    parts.economyHealth = 0;
    notes.push('EV ≤ 0：机制把经济打崩了');
  } else {
    parts.economyHealth = r2(ramp(ratio, 0.5, 0.8, 0, 6) - (ratio > 1.6 ? 3 : 0));
    if (ratio < 0.7) notes.push(`EV 掉到基线的 ${(ratio * 100).toFixed(0)}%`);
  }

  /* 惩罚项 */
  if (i.villageStopGivenVisit > 85) {
    penalties.villageDominance = 12;
    notes.push(`遇村必停 ${i.villageStopGivenVisit}% > 85%：DOMINANT_VILLAGE_ACTION（§13）`);
  }
  if (i.surgeUseRate > 90) {
    penalties.surgeDominance = 8;
    notes.push(`深层采矿使用率 ${i.surgeUseRate}% > 90%：几乎必拿，机会成本不足 → 近似支配策略`);
  }
  const cx = i.complexity;
  const cxOver = Math.max(0, cx.stateVars - 1) + Math.max(0, cx.formulas - 1) + Math.max(0, cx.buttons - 1);
  if (cxOver > 0) {
    penalties.complexity = r2(clamp(cxOver * 3, 0, 8));
    notes.push(`复杂度超出 §42 预算（状态变量 ${cx.stateVars} / 公式 ${cx.formulas} / 按钮 ${cx.buttons} → 超出 ${cxOver}）`);
  }
  if (i.baseRouteSwitchRate > 0 && i.routeSwitchRate < i.baseRouteSwitchRate * 0.5) {
    penalties.routeRegression = 8;
    notes.push(`返程路线切换率 ${i.routeSwitchRate}% 低于基线的 50%（${i.baseRouteSwitchRate}%）：破坏了既有返程空间`);
  }
  if (i.topMiningDayShare > 90) penalties.dominantStrategy = 6;

  const partsSum = Object.values(parts).reduce((a, b) => a + b, 0);
  const penSum = Object.values(penalties).reduce((a, b) => a + b, 0);
  return { total: r2(partsSum - penSum), parts, penalties, notes };
}

/**
 * §45：规则可解释性硬门槛。
 * 能不能用 1~3 句话讲清楚 —— 讲不清的机制一律拒绝，不因指标好看而放行。
 */
export interface ExplainabilityCheck {
  sentences: string[];
  pass: boolean;
  reason: string;
}

export function explainabilityCheck(variantLabel: string, sentences: string[]): ExplainabilityCheck {
  const joined = sentences.join(' ');
  const pass = sentences.length >= 1 && sentences.length <= 3 && joined.length <= 240;
  return {
    sentences,
    pass,
    reason: pass
      ? `✅ ${variantLabel} 可在 ${sentences.length} 句内解释`
      : `❌ ${variantLabel} 的解释需要 ${sentences.length} 句 / ${joined.length} 字，超出 1~3 句预算`,
  };
}
