import type { BotSummary } from '../../src/simulation/metrics';

/**
 * Autonomous Mechanism Evolution Lab —— 评价函数。
 *
 * 原则（沿用 sim-balance-lab）：
 *  - 目标**不是**最大化某个 Bot 的胜率或 EV，而是找出「创造了真实决策、
 *    同时没有把游戏压垮」的机制；
 *  - 绝对分值不重要，**能排序**才重要；
 *  - 每个分量都能在报告里逐项公示，并给出触发说明（notes）。
 */

export interface ScoreBreakdown {
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
/** 线性映射：x 在 [a,b] 之间映射到 [ra,rb]，区间外夹紧 */
function ramp(x: number, a: number, b: number, ra: number, rb: number): number {
  if (a === b) return ra;
  const t = clamp((x - a) / (b - a), 0, 1);
  return ra + t * (rb - ra);
}

export interface MiningScoreInput {
  /** 主要 Bot 的决策改变率（整体） */
  decisionChange: number;
  /** 采矿时长决策改变率 */
  miningDecisionChange: number;
  /** 单一采矿天数模板占比 % */
  topMiningDayShare: number;
  distinctMiningDays: number;
  /** 主要 Bot 胜率 */
  winRate: number;
  staminaDeathRate: number;
  timeoutRate: number;
  ev: number;
  baseEv: number;
  /** 相对基线的返程路线多样性变化比（1 = 不变） */
  returnDiversityRatio: number;
}

/**
 * MiningScore（0~100）—— Goal A 的机制健康度。
 * 分量权重见 SCORE_WEIGHTS_MINING，惩罚项用于压制"支配策略 / 破坏返程"。
 */
export function miningScore(i: MiningScoreInput): ScoreBreakdown {
  const notes: string[] = [];
  const parts: Record<string, number> = {};
  const penalties: Record<string, number> = {};

  /* 1. 采矿决策改变率（30）：0% 无效，15~40% 最佳，>55% 视为过度 */
  const dc = i.miningDecisionChange;
  let decisionChange: number;
  if (dc <= 0) {
    decisionChange = 0;
    notes.push('采矿决策改变率 0%：机制没有改变任何采矿动作（决策路径未读取机制信息，或机制不影响决策）');
  } else if (dc < 15) {
    decisionChange = ramp(dc, 0, 15, 0, 22);
    notes.push(`采矿决策改变率 ${dc}% < 15%：有可观察价值但偏弱`);
  } else if (dc <= 40) {
    decisionChange = ramp(dc, 15, 40, 22, 30);
  } else {
    decisionChange = ramp(dc, 40, 70, 30, 18);
    if (dc > 55) notes.push(`采矿决策改变率 ${dc}% 偏高：需要检查是否过度（玩家无法形成稳定策略）`);
  }
  parts.decisionChange = r2(decisionChange);

  /* 2. 无支配策略（15）：模板占比与取值个数双条件 */
  const shareScore = i.topMiningDayShare > 90 ? 0 : ramp(i.topMiningDayShare, 90, 65, 0, 10);
  const varietyScore = i.distinctMiningDays >= 5 ? 5 : ramp(i.distinctMiningDays, 1, 5, 0, 5);
  parts.noDominant = r2(shareScore + varietyScore);
  if (i.topMiningDayShare > 90) notes.push(`单一采矿天数模板占比 ${i.topMiningDayShare}% > 90%：DOMINANT_STRATEGY`);

  /* 3. 胜率健康区（20）：65~90% 满分 */
  const wr = i.winRate;
  let winRateHealth: number;
  if (wr < 65) {
    winRateHealth = ramp(wr, 30, 65, 0, 20);
    notes.push(`合理玩家胜率 ${wr}% < 65%：低于健康带下沿`);
  } else if (wr <= 90) {
    winRateHealth = 20;
  } else {
    winRateHealth = ramp(wr, 90, 100, 20, 10);
    notes.push(`合理玩家胜率 ${wr}% > 90%：过于容易，结构性压力消失`);
  }
  parts.winRateHealth = r2(winRateHealth);

  /* 4. 耐力死亡硬约束（15）：>40% 警戒，>50% 归零 */
  const sd = i.staminaDeathRate;
  if (sd <= 40) {
    parts.staminaGuard = 15;
  } else if (sd <= 50) {
    parts.staminaGuard = ramp(sd, 40, 50, 15, 0);
    notes.push(`STAMINA_EXHAUSTED ${sd}% 进入警戒区（>40%）`);
  } else {
    parts.staminaGuard = 0;
    notes.push(`STAMINA_EXHAUSTED ${sd}% > 50%：按硬约束默认拒绝，除非有极强理由`);
  }

  /* 5. 超时带（10）：0~20% 均接受（不要求强行制造 TIMEOUT） */
  const to = i.timeoutRate;
  if (to <= 20) {
    parts.timeoutBand = 10;
    if (to >= 5) notes.push(`TIMEOUT ${to}% 落入 5~20% 的可接受带：时间管理成为真实约束`);
  } else {
    parts.timeoutBand = ramp(to, 20, 40, 10, 0);
    notes.push(`TIMEOUT ${to}% > 20%：时间压力过大`);
  }

  /* 6. 收益结构（10）：EV 不能塌，也不能暴涨 */
  const ratio = i.baseEv === 0 ? 1 : i.ev / i.baseEv;
  if (i.ev <= 0) {
    parts.economyHealth = 0;
    notes.push('EV ≤ 0：机制把经济打崩了');
  } else {
    parts.economyHealth = r2(ramp(ratio, 0.7, 0.95, 0, 10) - (ratio > 1.3 ? 5 : 0));
  }

  /* 惩罚：支配策略 / 破坏返程玩法 */
  if (i.topMiningDayShare > 90) {
    penalties.dominantStrategy = 20;
    notes.push('惩罚 20：机制没有制造抉择，只是把玩家推向同一个模板');
  }
  if (i.returnDiversityRatio < 0.5) {
    penalties.returnRegression = 10;
    notes.push('惩罚 10：返程路线多样性被机制压掉一半以上（破坏了 Goal B 的既有空间）');
  }

  const total = r2(
    Object.values(parts).reduce((a, b) => a + b, 0) - Object.values(penalties).reduce((a, b) => a + b, 0),
  );
  return { total, parts, penalties, notes };
}

export interface ReturnScoreInput {
  returnDecisionChange: number;
  /**
   * 返程「真的选了非最短路」的局占比。
   *
   * 为什么不用「跨 Seed 的路线香农熵」计分：不同 Seed 本来就是不同地图，
   * 路线当然不同（实测基线熵 = 0.81，几乎满分），它衡量的是地图多样性而不是决策质量。
   * routeSwitchRate 是**逐局内**的指标：在同一张地图上，规划是否真的偏离了纯最短跳数，
   * 这才是「返程有没有策略选择」的证据。diversity 仍会照报，但不参与计分。
   */
  routeSwitchRate: number;
  /** 跨 Seed 路线香农熵（仅报告用） */
  routeDiversity: number;
  dropRate: number;
  winRate: number;
  staminaDeathRate: number;
  severedRate: number;
  /** 返程天数相对基线的比值（1 = 不变） */
  returnDaysRatio: number;
  ev: number;
  baseEv: number;
}

/** ReturnScore（0~100）—— Goal B 的机制健康度 */
export function returnScore(i: ReturnScoreInput): ScoreBreakdown {
  const notes: string[] = [];
  const parts: Record<string, number> = {};
  const penalties: Record<string, number> = {};

  /* 1. 返程决策改变率（25） */
  const dc = i.returnDecisionChange;
  if (dc <= 0) {
    parts.returnDecisionChange = 0;
    notes.push('returnDecisionChange ≈ 0%：机制没有创造任何返程决策');
  } else if (dc < 15) {
    parts.returnDecisionChange = r2(ramp(dc, 0, 15, 0, 17));
    notes.push(`returnDecisionChange ${dc}% < 15%：返程有变化但未形成稳定决策`);
  } else {
    parts.returnDecisionChange = r2(ramp(dc, 15, 45, 17, 25));
  }

  /* 2. 路线切换率（20）：真的偏离纯最短路的局占比，5~35% 为健康带 */
  const sw = i.routeSwitchRate;
  if (sw <= 0) {
    parts.routeSwitchRate = 0;
    notes.push(`routeSwitchRate ${sw}%：路线规划永远等于纯最短跳数，返程没有任何路线决策`);
  } else if (sw < 5) {
    parts.routeSwitchRate = r2(ramp(sw, 0, 5, 0, 12));
  } else if (sw <= 35) {
    parts.routeSwitchRate = r2(ramp(sw, 5, 35, 12, 20));
  } else {
    parts.routeSwitchRate = r2(ramp(sw, 35, 80, 20, 10));
    if (sw > 45) notes.push(`routeSwitchRate ${sw}% 偏高：路线偏离最短路成为常态，需要检查是否在无意义绕路`);
  }

  /* 3. 主动丢货决策（10）：5~60% 为健康带（既非从不发生，也非必做） */
  const dr = i.dropRate;
  if (dr <= 0) {
    parts.dropDecision = 0;
    notes.push('丢货从未发生：该按钮是死按钮（可能因为玩家永远不需要用它）');
  } else if (dr < 5) {
    parts.dropDecision = r2(ramp(dr, 0, 5, 0, 7));
  } else if (dr <= 60) {
    parts.dropDecision = 10;
  } else {
    parts.dropDecision = r2(ramp(dr, 60, 100, 10, 4));
    notes.push(`丢货率 ${dr}% > 60%：变成固定动作而非决策`);
  }

  /* 4. 胜率健康区（20） */
  const wr = i.winRate;
  parts.winRateHealth = wr < 65 ? r2(ramp(wr, 30, 65, 0, 20)) : wr <= 90 ? 20 : r2(ramp(wr, 90, 100, 20, 10));
  if (wr < 65) notes.push(`合理玩家胜率 ${wr}% < 65%：返程负担把游戏压得过头`);

  /* 5. 耐力硬约束（15） */
  parts.staminaGuard = i.staminaDeathRate <= 40 ? 15 : i.staminaDeathRate <= 50 ? r2(ramp(i.staminaDeathRate, 40, 50, 15, 0)) : 0;
  if (i.staminaDeathRate > 40) notes.push(`STAMINA_EXHAUSTED ${i.staminaDeathRate}% 进入警戒区`);

  /* 6. 返程代价膨胀（10）：天数涨幅 ≤1.3 倍满分 */
  parts.costHealth = r2(ramp(i.returnDaysRatio, 1, 1.3, 10, 6) - (i.returnDaysRatio > 1.6 ? 4 : 0));
  if (i.returnDaysRatio > 1.4) notes.push(`返程天数膨胀到基线的 ${i.returnDaysRatio.toFixed(2)} 倍`);

  if (i.severedRate > 5) {
    penalties.severed = 10;
    notes.push(`RETURN_ROUTE_SEVERED ${i.severedRate}% > 5%：返程负担把合法路线压死了`);
  }
  if (i.returnDaysRatio > 1.6) {
    penalties.bloat = 8;
    notes.push('惩罚 8：返程天数膨胀超过 1.6 倍，游戏被拖长');
  }
  const ratio = i.baseEv === 0 ? 1 : i.ev / i.baseEv;
  if (ratio < 0.6) {
    penalties.economy = 10;
    notes.push(`惩罚 10：EV 掉到基线的 ${(ratio * 100).toFixed(0)}%`);
  }

  const total = r2(
    Object.values(parts).reduce((a, b) => a + b, 0) - Object.values(penalties).reduce((a, b) => a + b, 0),
  );
  return { total, parts, penalties, notes };
}

/* ------------------------------------------------------------------ */
/* TentPriceScore（§23）                                                */
/* ------------------------------------------------------------------ */
export interface TentPriceScoreInput {
  /** 全部策略 Bot 的「购买帐篷数」分布（用于衡量 1/2/3 顶都有合理空间） */
  tentPurchaseDistribution: Record<string, number>;
  /** 各 Bot 摘要（按名字） */
  summaries: Record<string, BotSummary>;
}

/**
 * TentPriceScore = choiceDiversity + antiWasteful + survivalTradeoff + economyHealth
 * 刻意**不**最大化任一 Bot 的胜率。
 */
export function tentPriceScore(i: TentPriceScoreInput): ScoreBreakdown {
  const notes: string[] = [];
  const parts: Record<string, number> = {};
  const penalties: Record<string, number> = {};

  /* 1. choiceDiversity（30）：帐篷购买数的香农熵 × 30（上限） */
  const counts = Object.values(i.tentPurchaseDistribution);
  const n = counts.reduce((a, b) => a + b, 0);
  let entropy = 0;
  if (n > 0 && counts.length > 1) {
    for (const c of counts) {
      if (c <= 0) continue;
      const p = c / n;
      entropy -= p * Math.log(p);
    }
    entropy /= Math.log(counts.length);
  }
  parts.choiceDiversity = r2(entropy * 30);
  if (entropy < 0.4) notes.push(`帐篷购买分布过于集中（归一化熵 ${entropy.toFixed(2)}）：开局模板化`);

  /* 2. antiWasteful（30）：WastefulBot 必须被明确惩罚 */
  const wasteful = i.summaries['WastefulBot'];
  const reasonable = i.summaries['ReasonablePlayerBot'];
  const prepared = i.summaries['PreparedBot'];
  const cheap = i.summaries['CheapBot'];
  if (!wasteful || !reasonable) {
    parts.antiWasteful = 0;
    notes.push('缺少 WastefulBot / ReasonablePlayerBot 摘要，antiWasteful 记 0');
  } else {
    const evGap = reasonable.evNetProfitAllRuns - wasteful.evNetProfitAllRuns;
    const wrGap = reasonable.winRate - wasteful.winRate;
    let s = 0;
    if (evGap > 0) s += r2(ramp(evGap, 0, 400, 0, 18));
    else notes.push(`WastefulBot EV (${wasteful.evNetProfitAllRuns}) ≥ Reasonable (${reasonable.evNetProfitAllRuns})：乱囤装备没有代价`);
    if (wrGap > 0) s += r2(ramp(wrGap, 0, 8, 0, 12));
    else notes.push(`WastefulBot 胜率 ${wasteful.winRate}% ≥ Reasonable ${reasonable.winRate}%：过度囤积反而更稳`);
    if (wasteful.winRate > 95) {
      penalties.wastefulTooSafe = 10;
      notes.push('惩罚 10：WastefulBot 胜率 >95%，装备压力太小');
    }
    parts.antiWasteful = r2(s);
  }

  /* 3. survivalTradeoff（25）：重装换稳定，轻装换收益 —— 必须双向成立 */
  if (!prepared || !cheap || !reasonable) {
    parts.survivalTradeoff = 0;
  } else {
    let s = 0;
    if (prepared.winRate > cheap.winRate) s += r2(ramp(prepared.winRate - cheap.winRate, 0, 25, 0, 13));
    else notes.push('PreparedBot 胜率未高于 CheapBot：重装没有安全价值');
    if (cheap.evNetProfitAllRuns > prepared.evNetProfitAllRuns) s += r2(ramp(cheap.evNetProfitAllRuns - prepared.evNetProfitAllRuns, 0, 300, 0, 12));
    else notes.push('CheapBot EV 未高于 PreparedBot：轻装没有收益补偿');
    const spread = Math.max(reasonable.winRate, prepared.winRate) - Math.min(reasonable.winRate, prepared.winRate);
    if (spread > 25) {
      penalties.tradeoffTooSteep = 5;
      notes.push(`惩罚 5：装备档位间胜率差 ${r2(spread)}pp 过大`);
    }
    parts.survivalTradeoff = r2(s);
  }

  /* 4. economyHealth（15）：合理玩家有正 EV 且胜率落在健康带 */
  if (!reasonable) {
    parts.economyHealth = 0;
  } else {
    const evOk = reasonable.evNetProfitAllRuns > 0 ? 8 : 0;
    const wrOk = reasonable.winRate >= 65 && reasonable.winRate <= 90 ? 7 : r2(ramp(reasonable.winRate, 40, 65, 0, 7));
    parts.economyHealth = r2(evOk + wrOk);
    if (reasonable.evNetProfitAllRuns <= 0) notes.push('ReasonablePlayerBot EV ≤ 0：经济被打崩');
    if (reasonable.winRate > 90) notes.push(`ReasonablePlayerBot 胜率 ${reasonable.winRate}% > 90%：过于容易`);
  }

  const total = r2(
    Object.values(parts).reduce((a, b) => a + b, 0) - Object.values(penalties).reduce((a, b) => a + b, 0),
  );
  return { total, parts, penalties, notes };
}

export const SCORE_WEIGHTS_MINING = {
  decisionChange: 30,
  noDominant: 15,
  winRateHealth: 20,
  staminaGuard: 15,
  timeoutBand: 10,
  economyHealth: 10,
  dominantPenaltyMax: -20,
  returnRegressionPenaltyMax: -10,
} as const;

export const SCORE_WEIGHTS_RETURN = {
  returnDecisionChange: 25,
  routeDiversity: 20,
  dropDecision: 10,
  winRateHealth: 20,
  staminaGuard: 15,
  costHealth: 10,
  severedPenaltyMax: -10,
  bloatPenaltyMax: -8,
  economyPenaltyMax: -10,
} as const;

export const SCORE_WEIGHTS_TENT = {
  choiceDiversity: 30,
  antiWasteful: 30,
  survivalTradeoff: 25,
  economyHealth: 15,
} as const;
