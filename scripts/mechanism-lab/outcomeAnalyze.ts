import type { BotSummary, RunResult } from '../../src/simulation/metrics';
import { aggregateBot, aggregateOutcome } from '../../src/simulation/metrics';

/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 分析核心。
 *
 * 与 analyze.ts 的区别：
 *   - 一级指标从 `winRate` 换成 **Completion / Profitability 双目标**（§1/§2）；
 *   - 新增「成功但亏损」这一档的独立追踪（§5/§17）；
 *   - 新增 v0.2.0 四个机制族的行为痕迹（村庄/卖货/深层采矿/求援/情报格数）；
 *   - Decision Change 覆盖新机制的动作（不再只看采矿天数与返程第一步）。
 */

export interface OutcomeMetrics {
  variant: string;
  bot: string;
  runs: number;
  errors: number;
  summary: BotSummary;
  outcome: ReturnType<typeof aggregateOutcome>;

  /** 采矿决策 */
  avgMiningDays: number;
  miningDaysEntropy: number;
  topMiningDayShare: number;
  distinctMiningDays: number;

  /** 返程决策 */
  routeSwitchRate: number;
  returnRouteDiversity: number;
  dropRate: number;
  avgLoadPenaltyDays: number;

  /** 失败结构（§25/§26） */
  staminaDeathRate: number;
  timeoutRate: number;
  trappedRate: number;
  severedRate: number;
  /** 最大单一失败原因占全部失败的比例 %（§26 硬约束：>45 警戒、>60 拒绝） */
  topFailureShare: number;
  topFailureReason: string;

  /** v0.2.0 机制行为痕迹 */
  villageVisitRate: number;
  villageServiceRate: number;
  /** 在「遇到过村庄」的局里，用了服务的比例 %（§13 检验必停点） */
  villageStopGivenVisit: number;
  villageSellRate: number;
  villageIntelRate: number;
  surgeUseRate: number;
  rescueUseRate: number;
  avgIntelTiles: number;
  avgVillageSpent: number;

  /** 决策改变率（相对基线，同 Bot 同 Seed） */
  dc: OutcomeDecisionChange;

  /** 支配策略：单一采矿模板 > 90% */
  dominant: boolean;
  /** 村庄必停点：遇村必停 > 85%（§13） */
  dominantVillageAction: boolean;
}

export interface OutcomeDecisionChange {
  n: number;
  overall: number;
  mining: number;
  returnRoute: number;
  dropCargo: number;
  /** v0.2.0：新机制动作出现差异的局占比 */
  newMechanism: number;
  /** 完成/未完成发生翻转的局占比（outcome-level 决策改变） */
  outcomeFlip: number;
  equipment: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
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
  return round2(h / Math.log(counts.length));
}

export function computeOutcomeMetrics(
  variant: string,
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): OutcomeMetrics {
  const summary = aggregateBot(results);
  const outcome = aggregateOutcome(results);
  const n = Math.max(1, results.length);

  const dayCounts = new Map<number, number>();
  for (const r of results) dayCounts.set(r.miningDays, (dayCounts.get(r.miningDays) ?? 0) + 1);
  const counts = [...dayCounts.values()];
  const topShare = round2((Math.max(0, ...counts) / n) * 100);

  const firstSteps = new Map<string, number>();
  for (const r of results) {
    const f = r.returnFirstStep ?? '—';
    firstSteps.set(f, (firstSteps.get(f) ?? 0) + 1);
  }

  // 返程路线切换率
  const returned = results.filter((r) => (r.returnPath?.length ?? 0) > 1 && r.returnBfsFirstStep);
  let switched = 0;
  for (const r of returned) if (r.returnFirstStep !== r.returnBfsFirstStep) switched += 1;

  // 失败结构 + 最大单一原因占比
  const failed = results.filter((r) => r.status !== 'VICTORY' || r.error);
  const reasonCounts: Record<string, number> = {};
  for (const r of failed) {
    const k = r.defeatReason ?? 'UNKNOWN';
    reasonCounts[k] = (reasonCounts[k] ?? 0) + 1;
  }
  const reasonEntries = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const topReason = reasonEntries[0];
  const topFailureShare = failed.length === 0 ? 0 : round2(((topReason?.[1] ?? 0) / failed.length) * 100);

  // 村庄相关
  const visitedVillage = results.filter((r) => (r.villageVisits ?? 0) > 0);
  const usedVillage = results.filter((r) => (r.villageServicesUsed ?? 0) > 0);
  const visitedUsed = visitedVillage.filter((r) => (r.villageServicesUsed ?? 0) > 0);

  const dc = computeOutcomeDecisionChange(results, baseBySeed);

  return {
    variant,
    bot: summary.bot,
    runs: results.length,
    errors: summary.errors,
    summary,
    outcome,
    avgMiningDays: summary.avgMiningDays,
    miningDaysEntropy: normalizeEntropy(counts),
    topMiningDayShare: topShare,
    distinctMiningDays: dayCounts.size,
    routeSwitchRate: round2((switched / Math.max(1, returned.length)) * 100),
    returnRouteDiversity: normalizeEntropy([...firstSteps.values()]),
    dropRate: round2((results.filter((r) => (r.droppedKg ?? 0) > 0).length / n) * 100),
    avgLoadPenaltyDays: round2(mean(results.map((r) => r.loadPenaltyDays ?? 0))),
    staminaDeathRate: summary.failureRates.STAMINA_EXHAUSTED,
    timeoutRate: summary.failureRates.TIMEOUT,
    trappedRate: summary.failureRates.TRAPPED,
    severedRate: summary.failureRates.RETURN_ROUTE_SEVERED,
    topFailureShare,
    topFailureReason: topReason?.[0] ?? '—',
    villageVisitRate: round2((visitedVillage.length / n) * 100),
    villageServiceRate: round2((usedVillage.length / n) * 100),
    villageStopGivenVisit: visitedVillage.length === 0 ? 0 : round2((visitedUsed.length / visitedVillage.length) * 100),
    villageSellRate: round2((results.filter((r) => (r.villageServicesUsed ?? 0) > 0 && (r.gemsKg ?? 0) < 1).length / n) * 100),
    villageIntelRate: round2((results.filter((r) => (r.villageIntelBought ?? 0) > 0).length / n) * 100),
    surgeUseRate: round2((results.filter((r) => (r.surgeMiningUses ?? 0) > 0).length / n) * 100),
    rescueUseRate: round2((results.filter((r) => (r.emergencyRescues ?? 0) > 0).length / n) * 100),
    avgIntelTiles: round2(mean(results.map((r) => r.returnIntelTiles ?? 0))),
    avgVillageSpent: round2(mean(results.map((r) => r.villageServiceSpent ?? 0))),
    dc,
    dominant: topShare > 90,
    dominantVillageAction: visitedVillage.length > 0 && (visitedUsed.length / visitedVillage.length) * 100 > 85,
  };
}

/**
 * 逐局配对决策改变（相对基线）。
 *
 * `newMechanism`：v0.2.0 新机制动作（深层采矿 / 村庄服务 / 侦察 / 求援）是否出现差异。
 * `outcomeFlip`：完成/未完成状态是否与基线相反 —— 这是 outcome-level 的决策改变，
 *   比"采矿天数差 1 天"更接近玩家的真实体验（这次远征的命运被改变了）。
 */
export function computeOutcomeDecisionChange(
  results: RunResult[],
  baseBySeed: Map<string, RunResult> | null,
): OutcomeDecisionChange {
  const out: OutcomeDecisionChange = {
    n: 0, overall: 0, mining: 0, returnRoute: 0, dropCargo: 0, newMechanism: 0, outcomeFlip: 0, equipment: 0,
  };
  if (!baseBySeed) return out;
  let overall = 0, mining = 0, route = 0, drop = 0, mech = 0, flip = 0, equip = 0;
  for (const r of results) {
    const b = baseBySeed.get(r.seed);
    if (!b) continue;
    out.n += 1;
    const dMining = r.miningDays !== b.miningDays;
    const dRoute = (r.returnFirstStep ?? null) !== (b.returnFirstStep ?? null);
    const dDrop = (r.droppedKg ?? 0) > 0;
    const dEquip = r.tentsBought !== b.tentsBought || r.compassesBought !== b.compassesBought;
    const dMech =
      (r.surgeMiningUses ?? 0) > 0 ||
      (r.villageServicesUsed ?? 0) > 0 ||
      (r.emergencyRescues ?? 0) > 0 ||
      (r.returnIntelTiles ?? 0) > (b.returnIntelTiles ?? 0);
    const cA = r.expeditionCompleted ?? r.status === 'VICTORY';
    const cB = b.expeditionCompleted ?? b.status === 'VICTORY';
    const dFlip = cA !== cB;
    if (dMining) mining += 1;
    if (dRoute) route += 1;
    if (dDrop) drop += 1;
    if (dEquip) equip += 1;
    if (dMech) mech += 1;
    if (dFlip) flip += 1;
    if (dMining || dRoute || dDrop || dEquip || dMech) overall += 1;
  }
  const n = Math.max(1, out.n);
  out.overall = round2((overall / n) * 100);
  out.mining = round2((mining / n) * 100);
  out.returnRoute = round2((route / n) * 100);
  out.dropCargo = round2((drop / n) * 100);
  out.newMechanism = round2((mech / n) * 100);
  out.outcomeFlip = round2((flip / n) * 100);
  out.equipment = round2((equip / n) * 100);
  return out;
}

export function indexBySeed(results: RunResult[]): Map<string, RunResult> {
  const m = new Map<string, RunResult>();
  for (const r of results) m.set(r.seed, r);
  return m;
}

export interface OutcomePairedDelta {
  n: number;
  /** 完成数变化（+ = 该候选让更多局完成） */
  completionUp: number;
  completionDown: number;
  /** 净收益逐局差的均值 */
  avgProfitDelta: number;
  /** 完成率差（百分点） */
  completionDelta: number;
  /** 盈利率差（百分点） */
  profitableDelta: number;
}

/**
 * 逐局配对比较（§35）：完成状态翻转 + 净收益差。
 * 因为两侧用同一批 Seed，这里的 Δ 不含"世界运气"成分。
 */
export function outcomePairedDelta(
  results: RunResult[],
  base: Map<string, RunResult>,
): OutcomePairedDelta {
  let n = 0, up = 0, down = 0, sum = 0;
  let cUp = 0, cDown = 0;
  let bCompleted = 0, bProfitable = 0, rCompleted = 0, rProfitable = 0;
  for (const r of results) {
    const b = base.get(r.seed);
    if (!b) continue;
    n += 1;
    sum += r.netProfit - b.netProfit;
    const rc = r.expeditionCompleted ?? r.status === 'VICTORY';
    const bc = b.expeditionCompleted ?? b.status === 'VICTORY';
    if (rc) rCompleted += 1;
    if (bc) bCompleted += 1;
    if (r.netProfit > 0) rProfitable += 1;
    if (b.netProfit > 0) bProfitable += 1;
    if (rc && !bc) { up += 1; cUp += 1; }
    if (!rc && bc) { down += 1; cDown += 1; }
    void cUp; void cDown;
  }
  const denom = Math.max(1, n);
  return {
    n,
    completionUp: up,
    completionDown: down,
    avgProfitDelta: round2(sum / denom),
    completionDelta: round2(((rCompleted - bCompleted) / denom) * 100),
    profitableDelta: round2(((rProfitable - bProfitable) / denom) * 100),
  };
}

export type { RunResult, BotSummary };
