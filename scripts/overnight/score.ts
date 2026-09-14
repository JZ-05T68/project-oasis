/**
 * Balance Score —— 过夜自动平衡实验的多目标综合评分。
 *
 * 设计原则（写在报告里，禁止不透明的「AI 觉得更好」）：
 *  - 不最大化单一指标；
 *  - 由 6 个加权分量组成，每个分量 0~100；
 *  - 外加 3 条**减法式** exploit penalty（出现退化策略统治时直接扣分）。
 *
 * 参与评分的 Bot 是「设计意义上应当有存在价值」的 8 个：
 *  ReasonablePlayerBot / CautiousPlayerBot / ShortestPathBot / SafeBot /
 *  PreparedBot / GreedyMinerBot / WastefulBot / CheapBot
 */

import type { BotSummary } from '../../src/simulation/metrics';

export const FOCUS_BOTS = [
  'ReasonablePlayerBot',
  'CautiousPlayerBot',
  'ShortestPathBot',
  'SafeBot',
  'PreparedBot',
  'GreedyMinerBot',
  'WastefulBot',
  'CheapBot',
] as const;

/** 设计意图上「不应该成为经济最优」的 Bot */
export const DEGENERATE_BOTS = ['WastefulBot', 'CheapBot', 'RandomBot'];

export interface ScoreBreakdown {
  reasonableViability: number;
  strategyDiversity: number;
  economicHealth: number;
  resourceRelevance: number;
  failureDiversity: number;
  mineChoiceBalance: number;
  exploitPenalty: number;
  total: number;
  notes: string[];
}

const WEIGHTS = {
  reasonableViability: 30,
  strategyDiversity: 20,
  economicHealth: 15,
  resourceRelevance: 15,
  failureDiversity: 10,
  mineChoiceBalance: 10,
};

function clamp0_100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function byName(sums: BotSummary[], name: string): BotSummary | undefined {
  return sums.find((s) => s.bot === name);
}

/* ---------- 1. ReasonablePlayerBot 生存力 ---------- */
/**
 * 目标区间：胜率 70% ~ 90%。
 * 区间内 100 分；每偏离 1 个百分点扣 3 分（扣到 0 为止）。
 * 附加：成功局 p10 净收益必须 > 0，否则再扣 25 分（避免「胜率高但成功也亏」）。
 */
function reasonableViability(s: BotSummary | undefined, notes: string[], principal: number): number {
  if (!s) return 0;
  let score = 100;
  if (s.winRate < 70) score -= (70 - s.winRate) * 3;
  else if (s.winRate > 90) score -= (s.winRate - 90) * 3;
  if (s.finalAssetsWins.p10 <= principal) {
    score -= 25;
    notes.push(`ReasonableBot 成功局 p10 资产 ${s.finalAssetsWins.p10} ≤ 本金 ${principal}（成功也不赚钱）`);
  }
  notes.push(`ReasonableBot 胜率 ${s.winRate}% / EV ${s.evNetProfitAllRuns} / p10 ${s.finalAssetsWins.p10}`);
  return clamp0_100(score);
}

/* ---------- 2. 策略多样性 ---------- */
/**
 * 关注 6 个「合理策略」Bot（排除 Wasteful / Cheap）的 EV 分布：
 *  - 以其中最高 EV 为参照，统计有多少个 Bot 达到其 75% 以上（每个 +20 分，满分 100 需要 5 个）；
 *  - 再对这些 Bot 的胜率取极差：极差 < 5% 视为缺乏策略区分度，扣 20 分。
 */
function strategyDiversity(sums: BotSummary[], notes: string[]): number {
  const viable = FOCUS_BOTS.filter((b) => !DEGENERATE_BOTS.includes(b))
    .map((b) => byName(sums, b))
    .filter((s): s is BotSummary => !!s);
  if (viable.length === 0) return 0;
  const evs = viable.map((s) => s.evNetProfitAllRuns);
  const best = Math.max(...evs);
  const within = viable.filter((s) => s.evNetProfitAllRuns >= best * 0.75).length;
  let score = Math.min(100, within * 20);
  const wrs = viable.map((s) => s.winRate);
  const spread = Math.max(...wrs) - Math.min(...wrs);
  if (spread < 5) score -= 20;
  notes.push(`合理策略 EV 达到最优 75% 的有 ${within}/${viable.length} 个；胜率极差 ${spread.toFixed(1)}pp`);
  return clamp0_100(score);
}

/* ---------- 3. 经济健康 ---------- */
/**
 * 以 ReasonableBot 为准：
 *  - 成功局中「净收益 > 0」的比例（用 p10 资产与中位数近似）；
 *  - 成功局中位资产 / 本金 = 收益倍率，倍率落在 [1.6, 3.2] 视为健康；
 *  - 失败局平均资产损失不应超过本金的 60%（避免失败即毁灭）。
 */
function economicHealth(sums: BotSummary[], notes: string[], principal: number): number {
  const r = byName(sums, 'ReasonablePlayerBot');
  if (!r) return 0;
  let score = 100;
  const ratio = r.finalAssetsWins.median / principal;
  if (ratio < 1.6) score -= (1.6 - ratio) * 120;
  else if (ratio > 3.2) score -= (ratio - 3.2) * 60;
  if (r.finalAssetsWins.p10 < principal * 1.05) score -= 20;
  // 「乱囤装备」仍应亏：WastefulBot EV 必须明显低于 ReasonableBot
  const w = byName(sums, 'WastefulBot');
  if (w && r && w.evNetProfitAllRuns > r.evNetProfitAllRuns * 0.95) {
    score -= 30;
    notes.push(`WastefulBot EV(${w.evNetProfitAllRuns}) 未明显低于 ReasonableBot(${r.evNetProfitAllRuns})`);
  }
  notes.push(`成功局中位资产/本金 = ${ratio.toFixed(2)}×`);
  return clamp0_100(score);
}

/* ---------- 4. 资源相关性 ---------- */
/**
 * 逐项检查机制使用率是否落在 [5%, 95%]：
 *  - 帐篷使用率（有帐篷且用过）
 *  - 指南针使用率
 *  - 天气预报购买率（ForecastBot）
 *  - 绿洲修整率（有 rest 策略的 Bot 平均）
 *  - 遭遇触发率
 * 每出现一项越界扣 20 分。
 */
function resourceRelevance(sums: BotSummary[], notes: string[]): number {
  let score = 100;
  const r = byName(sums, 'ReasonablePlayerBot');
  const f = byName(sums, 'ForecastBot');
  const check = (label: string, rate: number) => {
    if (rate < 5 || rate > 95) {
      score -= 20;
      notes.push(`${label} 使用率 ${rate.toFixed(1)}% 越界（<5% 或 >95%）`);
    }
  };
  if (r) {
    const tentUseRate = r.avgTentsBought > 0 ? (r.avgTentUses / (r.avgTentsBought * 3)) * 100 : 0;
    const compassUseRate = r.avgCompassesBought > 0 ? (r.avgCompassUses / r.avgCompassesBought) * 100 : 0;
    check('帐篷（ReasonableBot）', tentUseRate);
    check('指南针（ReasonableBot）', compassUseRate);
    check('绿洲修整（ReasonableBot）', r.restRate);
    check('遭遇触发（ReasonableBot）', r.encounterRate);
  }
  if (f) check('天气预报购买（ForecastBot）', f.avgForecastPacks > 0 ? 100 : 0);
  return clamp0_100(score);
}

/* ---------- 5. 失败原因多样性 ---------- */
/**
 * 汇总所有关注 Bot 的失败原因分布（按局数加权）。
 * 任一失败原因占比 > 70% → 扣分 (占比-70)*2；> 85% → 再扣 15。
 */
function failureDiversity(sums: BotSummary[], notes: string[]): number {
  const tot: Record<string, number> = { TIMEOUT: 0, STAMINA_EXHAUSTED: 0, RETURN_ROUTE_SEVERED: 0, TRAPPED: 0 };
  let n = 0;
  for (const s of sums) {
    if (!FOCUS_BOTS.includes(s.bot as (typeof FOCUS_BOTS)[number])) continue;
    const scale = s.runs;
    n += scale;
    for (const k of Object.keys(tot)) {
      tot[k] += ((s.failureRates as unknown as Record<string, number>)[k] ?? 0) * scale / 100;
    }
  }
  if (n === 0) return 0;
  let score = 100;
  for (const [k, v] of Object.entries(tot)) {
    const pct = (v / n) * 100;
    if (pct > 70) {
      score -= (pct - 70) * 2;
      notes.push(`失败原因 ${k} 占 ${pct.toFixed(1)}%（>70%）`);
    }
    if (pct > 85) score -= 15;
  }
  return clamp0_100(score);
}

/* ---------- 6. 两矿选择平衡 ---------- */
/**
 * 统计以「最近矿区」为目标的 Bot（Reasonable / Shortest / Greedy / Cautious）的 A/B 选择占比。
 * 偏离 50/50 越多扣分：score = 100 - |shareA-50| * 2（95:5 → 10 分）。
 */
function mineChoiceBalance(sums: BotSummary[], notes: string[]): number {
  const watch = ['ReasonablePlayerBot', 'ShortestPathBot', 'GreedyMinerBot', 'CautiousPlayerBot'];
  let a = 0;
  let b = 0;
  for (const name of watch) {
    const s = byName(sums, name);
    if (!s) continue;
    a += s.mineSlotShare['A'] ?? 0;
    b += s.mineSlotShare['B'] ?? 0;
  }
  const total = a + b;
  if (total === 0) return 0;
  const shareA = (a / total) * 100;
  const score = clamp0_100(100 - Math.abs(shareA - 50) * 2);
  if (Math.abs(shareA - 50) > 20) notes.push(`两矿选择失衡 Mine A ${shareA.toFixed(1)}% vs Mine B ${(100 - shareA).toFixed(1)}%`);
  return score;
}

/* ---------- exploit penalty（减法） ---------- */
function exploitPenalty(sums: BotSummary[], notes: string[]): number {
  let pen = 0;
  const ranked = [...sums].sort((x, y) => y.evNetProfitAllRuns - x.evNetProfitAllRuns);
  const top = ranked[0];
  if (top && DEGENERATE_BOTS.includes(top.bot)) {
    pen += 20;
    notes.push(`退化策略 ${top.bot} 的 EV 排名第一（${top.evNetProfitAllRuns}）`);
  }
  for (const s of sums) {
    if (FOCUS_BOTS.includes(s.bot as (typeof FOCUS_BOTS)[number]) && s.winRate >= 99.5) {
      pen += 10;
      notes.push(`${s.bot} 胜率 ${s.winRate}%（接近必胜，缺乏风险）`);
    }
  }
  const cheap = byName(sums, 'CheapBot');
  const reasonable = byName(sums, 'ReasonablePlayerBot');
  if (cheap && reasonable && cheap.winRate > reasonable.winRate) {
    pen += 10;
    notes.push(`CheapBot 胜率(${cheap.winRate}%) 高于 ReasonableBot(${reasonable.winRate}%)，不买装备反而更安全`);
  }
  return pen;
}

export function balanceScore(
  sums: BotSummary[],
  principalIn?: number,
): ScoreBreakdown {
  const principal = typeof principalIn === 'number' ? principalIn : gameConfig.startCash;
  const notes: string[] = [];
  const parts = {
    reasonableViability: reasonableViability(byName(sums, 'ReasonablePlayerBot'), notes, principal),
    strategyDiversity: strategyDiversity(sums, notes),
    economicHealth: economicHealth(sums, notes, principal),
    resourceRelevance: resourceRelevance(sums, notes),
    failureDiversity: failureDiversity(sums, notes),
    mineChoiceBalance: mineChoiceBalance(sums, notes),
  };
  const weighted =
    parts.reasonableViability * WEIGHTS.reasonableViability +
    parts.strategyDiversity * WEIGHTS.strategyDiversity +
    parts.economicHealth * WEIGHTS.economicHealth +
    parts.resourceRelevance * WEIGHTS.resourceRelevance +
    parts.failureDiversity * WEIGHTS.failureDiversity +
    parts.mineChoiceBalance * WEIGHTS.mineChoiceBalance;
  const total = weighted / 100;
  const penalty = exploitPenalty(sums, notes);
  return { ...parts, exploitPenalty: penalty, total: Math.round((total - penalty) * 100) / 100, notes };
}

export const SCORE_WEIGHTS = WEIGHTS;
