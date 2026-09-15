import type { BotSummary, RunResult } from '../../src/simulation/metrics';
import { aggregateBot } from '../../src/simulation/metrics';

/**
 * Autonomous Mechanism Evolution Lab —— 机制分析核心。
 *
 * 一级指标（用户明确要求）：Decision Change Rate。
 * 定义：**与当前正式基线（同 Bot、同 Seed）相比，机制是否真实改变了玩家动作**。
 * 覆盖用户列出的全部形态：
 *   采矿天数改变 / 提前返程 / 延迟返程 / 返程路线不同 / 主动丢货 / 改变装备使用
 */

export interface DecisionChangeBreakdown {
  n: number;
  /** 任一动作发生变化的局占比 % */
  overall: number;
  /** 采矿天数变化（含提前/延迟返程）% */
  mining: number;
  /** 仅提前返程 % / 仅延迟返程 % */
  earlier: number;
  later: number;
  /** 返程第一步路线不同 % */
  returnRoute: number;
  /** 主动丢货 % */
  dropCargo: number;
  /** 装备购买数量变化 % */
  equipment: number;
}

export interface MechMetrics {
  variant: string;
  bot: string;
  runs: number;
  errors: number;
  summary: BotSummary;
  /* --- 采矿决策 --- */
  avgMiningDays: number;
  miningDaysVar: number;
  /** 采矿天数取值的香农熵（归一化 0~1）：越高 = 策略越多样 */
  miningDaysEntropy: number;
  /** 单一采矿天数取值的最大占比 %：>90 = DOMINANT_STRATEGY 嫌疑 */
  topMiningDayShare: number;
  /** 唯一采矿天数取值个数 */
  distinctMiningDays: number;
  /** 采矿 ≤1 天的局占比 %（早退率） */
  earlyReturnRate: number;
  /** 采矿 ≥ 10 天的局占比 %（多挖率） */
  heavyMiningRate: number;
  avgMiningDaysBySlot: Record<string, number>;
  /* --- 返程决策 --- */
  returnRouteDiversity: number;
  returnPathDiversity: number;
  returnDays: number;
  returnStaminaProxy: number;
  routeSwitchRate: number;
  avgLoadPenaltyDays: number;
  /* --- 失败结构 --- */
  staminaDeathRate: number;
  timeoutRate: number;
  trappedRate: number;
  severedRate: number;
  /* --- 机制行为 --- */
  dropRate: number;
  avgDroppedKg: number;
  accidentRate: number;
  avgAccidentLostKg: number;
  avgEndStamina: number;
  avgDaysUsed: number;
  /* --- 决策改变率 --- */
  dc: DecisionChangeBreakdown;
  /* --- 支配策略 --- */
  dominant: boolean;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return round2(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** 归一化香农熵：0 = 全部同一取值，1 = 取值完全均匀 */
function normalizeEntropy(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0 || counts.length <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / n;
    h -= p * Math.log(p);
  }
  return round2(h / Math.log(counts.length));
}

/** 一个 Bot 在某个候选下的完整机制指标 */
export function computeMetrics(
  variant: string,
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): MechMetrics {
  const summary = aggregateBot(results);
  const miningDays = results.map((r) => r.miningDays);
  const dayCounts = new Map<number, number>();
  for (const d of miningDays) dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  const counts = [...dayCounts.values()];
  const topShare = round2((Math.max(0, ...counts) / Math.max(1, results.length)) * 100);

  // 返程路线多样性：按「返程第一步」与「完整返程路径」两个粒度
  const firstSteps = new Map<string, number>();
  const paths = new Map<string, number>();
  for (const r of results) {
    const f = r.returnFirstStep ?? '—';
    firstSteps.set(f, (firstSteps.get(f) ?? 0) + 1);
    const p = (r.returnPath ?? []).join('>') || '—';
    paths.set(p, (paths.get(p) ?? 0) + 1);
  }
  const routeEntropy = normalizeEntropy([...firstSteps.values()]);
  const pathEntropy = normalizeEntropy([...paths.values()]);

  // 返程天数（仅成功局，避免失败局截断污染）
  const wins = results.filter((r) => r.status === 'VICTORY' && !r.error);
  const returnDays = round2(mean(wins.map((r) => r.returnDays)));
  const returnStamina = round2(mean(wins.map((r) => r.endStamina ?? 0)));

  // 路线切换率：真的进入过返程、且返程第一步 ≠ 纯最短跳数第一步 的局占比
  const returned = results.filter((r) => (r.returnPath?.length ?? 0) > 1 && r.returnBfsFirstStep);
  let switched = 0;
  for (const r of returned) {
    if (r.returnFirstStep !== r.returnBfsFirstStep) switched += 1;
  }

  const bySlot: Record<string, number[]> = {};
  for (const r of results) {
    const slot = r.mineSlot ?? '?';
    (bySlot[slot] ??= []).push(r.miningDays);
  }

  const dc = computeDecisionChange(results, baseBySeed);

  const failure = summary.failureRates;
  const metrics: MechMetrics = {
    variant,
    bot: summary.bot,
    runs: results.length,
    errors: summary.errors,
    summary,
    avgMiningDays: summary.avgMiningDays,
    miningDaysVar: variance(miningDays),
    miningDaysEntropy: normalizeEntropy(counts),
    topMiningDayShare: topShare,
    distinctMiningDays: dayCounts.size,
    earlyReturnRate: round2((results.filter((r) => r.miningDays <= 1).length / Math.max(1, results.length)) * 100),
    heavyMiningRate: round2((results.filter((r) => r.miningDays >= 10).length / Math.max(1, results.length)) * 100),
    avgMiningDaysBySlot: Object.fromEntries(Object.entries(bySlot).map(([k, v]) => [k, round2(mean(v))])),
    returnRouteDiversity: routeEntropy,
    returnPathDiversity: pathEntropy,
    returnDays,
    returnStaminaProxy: returnStamina,
    routeSwitchRate: round2((switched / Math.max(1, returned.length)) * 100),
    avgLoadPenaltyDays: round2(mean(results.map((r) => r.loadPenaltyDays ?? 0))),
    staminaDeathRate: failure.STAMINA_EXHAUSTED,
    timeoutRate: failure.TIMEOUT,
    trappedRate: failure.TRAPPED,
    severedRate: failure.RETURN_ROUTE_SEVERED,
    dropRate: round2((results.filter((r) => (r.droppedKg ?? 0) > 0).length / Math.max(1, results.length)) * 100),
    avgDroppedKg: round2(mean(results.map((r) => r.droppedKg ?? 0))),
    accidentRate: round2((results.filter((r) => (r.miningAccidents ?? 0) > 0).length / Math.max(1, results.length)) * 100),
    avgAccidentLostKg: round2(mean(results.map((r) => r.miningAccidentLostKg ?? 0))),
    avgEndStamina: summary.avgEndStamina,
    avgDaysUsed: summary.avgDaysUsed,
    dc,
    // §21：单一动作模板占比 > 90% 视为支配策略
    dominant: topShare > 90,
  };
  return metrics;
}

/** 逐局配对：与基线同 Bot 同 Seed 对比，统计动作是否被机制改变 */
export function computeDecisionChange(
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): DecisionChangeBreakdown {
  const out: DecisionChangeBreakdown = {
    n: 0,
    overall: 0,
    mining: 0,
    earlier: 0,
    later: 0,
    returnRoute: 0,
    dropCargo: 0,
    equipment: 0,
  };
  if (!baseBySeed) return out;
  let overall = 0;
  let mining = 0;
  let earlier = 0;
  let later = 0;
  let ret = 0;
  let drop = 0;
  let equip = 0;
  for (const r of results) {
    const b = baseBySeed.get(r.seed);
    if (!b) continue;
    out.n += 1;
    const dMining = r.miningDays !== b.miningDays;
    const dRoute = (r.returnFirstStep ?? null) !== (b.returnFirstStep ?? null);
    const dDrop = (r.droppedKg ?? 0) > 0;
    const dEquip = r.tentsBought !== b.tentsBought || r.compassesBought !== b.compassesBought;
    if (dMining) {
      mining += 1;
      if (r.miningDays < b.miningDays) earlier += 1;
      else later += 1;
    }
    if (dRoute) ret += 1;
    if (dDrop) drop += 1;
    if (dEquip) equip += 1;
    if (dMining || dRoute || dDrop || dEquip) overall += 1;
  }
  const n = Math.max(1, out.n);
  out.overall = round2((overall / n) * 100);
  out.mining = round2((mining / n) * 100);
  out.earlier = round2((earlier / n) * 100);
  out.later = round2((later / n) * 100);
  out.returnRoute = round2((ret / n) * 100);
  out.dropCargo = round2((drop / n) * 100);
  out.equipment = round2((equip / n) * 100);
  return out;
}

/** 把 RunResult 数组按 seed 建索引 */
export function indexBySeed(results: RunResult[]): Map<string, RunResult> {
  const m = new Map<string, RunResult>();
  for (const r of results) m.set(r.seed, r);
  return m;
}

/** 逐局配对差值（净收益 / 胜负）——用于 §29 的 paired Δwin / ΔEV */
export function pairedDelta(results: RunResult[], base: Map<string, RunResult>) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let n = 0;
  let winUp = 0;
  let winDown = 0;
  let sum = 0;
  for (const r of results) {
    const b = base.get(r.seed);
    if (!b) continue;
    n += 1;
    const d = r.netProfit - b.netProfit;
    sum += d;
    if (d > 0) wins += 1;
    else if (d < 0) losses += 1;
    else ties += 1;
    const rw = r.status === 'VICTORY' && !r.error;
    const bw = b.status === 'VICTORY' && !b.error;
    if (rw && !bw) winUp += 1;
    if (!rw && bw) winDown += 1;
  }
  return {
    n,
    wins,
    losses,
    ties,
    avgDelta: round2(n === 0 ? 0 : sum / n),
    winUp,
    winDown,
    pWin: round2(n === 0 ? 0 : (wins / n) * 100),
  };
}

export type { RunResult, BotSummary };
