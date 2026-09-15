import type { DefeatReason, TileId } from '../game/types';

/** 单局仿真结果（由 runner 从引擎终态提取） */
export interface RunResult {
  seed: string;
  bot: string;
  status: 'VICTORY' | 'DEFEAT';
  defeatReason: DefeatReason | null;
  /** 运行期错误（应当为 0；出现即框架 Bug） */
  error: string | null;

  mineId: TileId | null;
  /** 选择的矿区槽位（A / B），用于统计两矿选择率 */
  mineSlot?: 'A' | 'B' | null;
  /** 结束时的剩余耐力（失败局为 0 或当时值） */
  endStamina?: number;
  /** 结束时的剩余天数 */
  endDaysRemaining?: number;
  /** 全程经过绿洲格次数（去程+返程） */
  oasisVisits?: number;
  /** 全程经过村庄格次数（去程+返程） */
  villageVisits?: number;
  /** 天气造成的耐力损失次数（高温/沙尘暴/暴雨硬扛） */
  weatherDamageHits?: number;
  /** 天气造成的耐力损失总量 */
  weatherDamageTotal?: number;
  /** 触发的遭遇次数（商队/盗贼/市集/牧民） */
  encounterCount?: number;
  /** 绿洲修整次数 */
  restCount?: number;
  /** 原地等待次数 */
  waitCount?: number;
  /**
   * 该矿区「最短合法往返方案」的客观危险程度与品质 jitter（v0.1.2b）。
   * 价格完全由这两项决定，与玩家行为无关；记录下来后可以在不重跑对局的前提下
   * 离线扫描不同的 (base, scale, clamp) 定价参数。
   */
  mineDifficulty: number | null;
  mineJitter: number | null;
  routeScore: number | null;
  daysUsed: number;
  outboundDays: number | null;
  miningDays: number;
  returnDays: number;
  forecastPacks: number;
  /* ---- 天气预报专项遥测（v0.1.3 现金计价） ---- */
  /** 花在天气预报包上的现金 */
  forecastMoneySpent?: number;
  /** 累计发放的预报次数 = packs × chargesPerPack */
  forecastChargesGranted?: number;
  /** 累计消耗的预报次数（含购买后自动使用） */
  forecastChargesUsed?: number;
  /** 结束时仍未使用的预报次数 */
  forecastChargesUnused?: number;
  /** 出现过「有效预报窗口」的回合数 */
  forecastWindowTurns?: number;
  /** 有效预报窗口内确实做了移动决策的次数（Decision 分母） */
  forecastDecisionOpportunities?: number;
  /** 有效预报（Decision-Useful：真的改了行动）次数 */
  forecastDecisionUseful?: number;
  /** 仅供参考（Informational Only：看了但没改计划）次数 */
  forecastInformationalOnly?: number;
  /** 预报窗口内出现的「明天恶劣」可走邻格总数 */
  forecastSevereOptionsSeen?: number;
  /** 明知恶劣仍进入的次数 */
  forecastSevereEntered?: number;
  /** 存在恶劣选项但最终选了安全格的回合数 */
  forecastSevereAvoided?: number;
  staminaLossAvoidedEstimate?: number;
  daysLostAvoidedEstimate?: number;
  tentDurabilitySavedEstimate?: number;
  tentsDestroyedAvoidedEstimate?: number;
  compassUsesAvoidedEstimate?: number;
  /** 村庄打工（市集 WORK）天数与收益 */
  villageWorkDays?: number;
  villageWorkIncome?: number;
  /** 【Shadow-Lab 专用】返程负重模型造成的额外耐力损失（正式游戏恒为 undefined） */
  returnLoadStaminaLoss?: number;
  /* ---- Autonomous Mechanism Evolution Lab 遥测 ---- */
  /** 主动丢弃的宝石总量（kg；机制关闭时恒为 0） */
  droppedKg?: number;
  /** 采矿事故次数（机制关闭时恒为 0） */
  miningAccidents?: number;
  /** 采矿事故损失掉的宝石（kg） */
  miningAccidentLostKg?: number;
  /** 返程负重惩罚额外消耗的天数 */
  loadPenaltyDays?: number;
  /** 返程逐格轨迹（含起点矿区，按顺序），用于返程路线多样性统计 */
  returnPath?: TileId[];
  /** 返程第一个分歧点的选择（用于 routeSwitchRate / returnRouteDiversity） */
  returnFirstStep?: TileId | null;
  /**
   * 「纯最短跳数路线」在返程起点的第一步。
   * routeSwitchRate = 实际第一步 ≠ 纯最短路第一步 的局占比，
   * 用来区分「路线多样性只是不同地图造成的」与「规划真的选了非最短路」。
   * 注意：返程起点的禁行集合完全由「去程足迹」决定，而它保存在终态里，
   * 因此可以在不重放对局的前提下精确重建。
   */
  returnBfsFirstStep?: TileId | null;
  gemsKg: number;
  gemPrice: number | null;
  gemRevenue: number;
  equipmentSpent: number;
  cashRemaining: number;
  finalAssets: number;
  netProfit: number;

  tentsBought: number;
  compassesBought: number;
  tentUses: number;
  compassUses: number;
  /** 结束时剩余的帐篷总耐久与指南针数（衡量浪费） */
  tentsChargesLeft: number;
  compassesLeft: number;

  /** 事件记录：kind / 选项 / 时间与现金变化 */
  events: Array<{ kind: string; choice: string; dayDelta: number; cashDelta: number }>;

  nodeVisits: Record<TileId, { out: number; ret: number }>;
  edgeUses: Record<string, number>;
}

export function summarizeEventChoice(choice: unknown): string {
  const c = choice as Record<string, unknown>;
  if (!c || typeof c !== 'object') return String(choice);
  if (c.kind === 'SANDSTORM') return `tent:${c.useTent},compass:${c.useCompass}`;
  if (c.kind === 'RAINSTORM') return `tent:${c.useTent}`;
  if (c.kind === 'CARAVAN') return String(c.action);
  if (c.kind === 'THIEF') return String(c.action);
  if (c.kind === 'MARKET') return String(c.action);
  if (c.kind === 'FORECAST_OFFER') return c.accept ? 'accept' : 'decline';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* 聚合                                                                */
/* ------------------------------------------------------------------ */

export interface BotSummary {
  bot: string;
  runs: number;
  errors: number;
  wins: number;
  winRate: number;

  /** 失败原因分布（占全部局数比例） */
  failureRates: {
    TIMEOUT: number;
    STAMINA_EXHAUSTED: number;
    RETURN_ROUTE_SEVERED: number;
    TRAPPED: number;
  };

  /** 仅成功局的最终资产分布 */
  finalAssetsWins: { avg: number; median: number; p10: number; p25: number; p75: number; p90: number; max: number; min: number };
  /** 仅成功局平均净收益 */
  avgNetProfitWins: number;
  /** 全部局的长期期望（净收益均值，失败局计入其实际净收益） */
  evNetProfitAllRuns: number;

  avgDaysUsed: number;
  avgOutboundDays: number;
  avgMiningDays: number;
  avgReturnDays: number;
  avgForecastPacks: number;
  avgFinalDay: number;

  avgTentsBought: number;
  avgCompassesBought: number;
  avgTentUses: number;
  avgCompassUses: number;
  avgEquipmentSpent: number;
  /** 装备浪费率：(结束时剩余帐篷耐久+剩余指南针) / (购买的总耐久+总指南针) */
  equipmentWasteRate: number;

  /** 结束时平均剩余耐力（全部局） */
  avgEndStamina: number;
  /** 结束时平均剩余天数 */
  avgEndDaysRemaining: number;
  /** 平均经过绿洲格次数 */
  avgOasisVisits: number;
  /** 平均经过村庄格次数 */
  avgVillageVisits: number;
  /** 平均天气伤害次数 / 总伤害量 */
  avgWeatherHits: number;
  avgWeatherDamage: number;
  /** 平均遭遇触发次数 */
  avgEncounters: number;
  /** 平均绿洲修整次数 / 原地等待次数 */
  avgRestCount: number;
  avgWaitCount: number;
  /** 至少修整过一次的局占比 % */
  restRate: number;
  /** 至少触发过一次遭遇的局占比 % */
  encounterRate: number;
  /** 两矿槽位选择占比 % */
  mineSlotShare: Record<string, number>;
  avgGemsKgWins: number;
  /** 矿区选择分布 */
  mineVisits: Record<TileId, number>;
  /** 平均路线风险评分（有值的局） */
  avgRouteScore: number | null;
  /** 天气预报专项聚合（v0.1.3） */
  forecast: ForecastSummary;
  /** 村庄打工（市集 WORK） */
  avgVillageWorkDays: number;
  avgVillageWorkIncome: number;
}

export interface ForecastSummary {
  /** 至少买过 1 包的局占比 % */
  purchaseRate: number;
  avgPacks: number;
  avgMoneySpent: number;
  avgChargesGranted: number;
  avgChargesUsed: number;
  avgChargesUnused: number;
  /** 已购买次数里被真正用掉的比例 %（套餐使用率） */
  packUsageRate: number;
  /** 每 100 元预报支出带来的「估计伤害减少」点数 */
  damageReductionPer100: number;
  /** 有效预报次数 / 做过移动决策的次数 % */
  decisionUtilityRate: number;
  avgDecisionUseful: number;
  avgInformationalOnly: number;
  avgSevereOptionsSeen: number;
  avgSevereAvoided: number;
  avgSevereEntered: number;
  avgStaminaLossAvoidedEstimate: number;
  avgDaysLostAvoidedEstimate: number;
  avgTentDurabilitySavedEstimate: number;
  avgTentsDestroyedAvoidedEstimate: number;
  avgCompassUsesAvoidedEstimate: number;
  /** 至少用掉 1 次预报的局占比 % */
  useRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function aggregateBot(results: RunResult[]): BotSummary {
  const bot = results[0]?.bot ?? '?';
  const runs = results.length;
  const wins = results.filter((r) => r.status === 'VICTORY' && !r.error);
  const winAssets = wins.map((r) => r.finalAssets).sort((a, b) => a - b);
  const failureCounts = { TIMEOUT: 0, STAMINA_EXHAUSTED: 0, RETURN_ROUTE_SEVERED: 0, TRAPPED: 0 };
  for (const r of results) {
    if (r.defeatReason && r.defeatReason in failureCounts) {
      failureCounts[r.defeatReason as keyof typeof failureCounts] += 1;
    }
  }
  const mineVisits: Record<TileId, number> = {};
  for (const r of results) {
    if (r.mineId) mineVisits[r.mineId] = (mineVisits[r.mineId] ?? 0) + 1;
  }
  const slotCounts: Record<string, number> = {};
  for (const r of results) {
    if (r.mineSlot) slotCounts[r.mineSlot] = (slotCounts[r.mineSlot] ?? 0) + 1;
  }
  const restRuns = results.filter((r) => (r.restCount ?? 0) > 0).length;
  const encounterRuns = results.filter((r) => (r.encounterCount ?? 0) > 0).length;
  const purchasedCharges = results.reduce((s, r) => s + r.tentsBought * 3 + r.compassesBought, 0);
  const leftCharges = results.reduce((s, r) => s + r.tentsChargesLeft + r.compassesLeft, 0);
  const scores = results.map((r) => r.routeScore).filter((v): v is number => v !== null);

  return {
    bot,
    runs,
    errors: results.filter((r) => r.error).length,
    wins: wins.length,
    winRate: round2(runs === 0 ? 0 : (wins.length / runs) * 100),
    failureRates: {
      TIMEOUT: round2(runs === 0 ? 0 : (failureCounts.TIMEOUT / runs) * 100),
      STAMINA_EXHAUSTED: round2(runs === 0 ? 0 : (failureCounts.STAMINA_EXHAUSTED / runs) * 100),
      RETURN_ROUTE_SEVERED: round2(runs === 0 ? 0 : (failureCounts.RETURN_ROUTE_SEVERED / runs) * 100),
      TRAPPED: round2(runs === 0 ? 0 : (failureCounts.TRAPPED / runs) * 100),
    },
    finalAssetsWins: {
      avg: round2(mean(winAssets)),
      median: percentile(winAssets, 50),
      p10: percentile(winAssets, 10),
      p25: percentile(winAssets, 25),
      p75: percentile(winAssets, 75),
      p90: percentile(winAssets, 90),
      max: winAssets.length ? winAssets[winAssets.length - 1] : 0,
      min: winAssets.length ? winAssets[0] : 0,
    },
    avgNetProfitWins: round2(mean(wins.map((r) => r.netProfit))),
    evNetProfitAllRuns: round2(mean(results.map((r) => r.netProfit))),
    avgDaysUsed: round2(mean(results.map((r) => r.daysUsed))),
    avgOutboundDays: round2(mean(results.map((r) => r.outboundDays ?? r.daysUsed))),
    avgMiningDays: round2(mean(results.map((r) => r.miningDays))),
    avgReturnDays: round2(mean(results.map((r) => r.returnDays))),
    avgForecastPacks: round2(mean(results.map((r) => r.forecastPacks))),
    avgFinalDay: round2(mean(results.map((r) => r.daysUsed))),
    avgTentsBought: round2(mean(results.map((r) => r.tentsBought))),
    avgCompassesBought: round2(mean(results.map((r) => r.compassesBought))),
    avgTentUses: round2(mean(results.map((r) => r.tentUses))),
    avgCompassUses: round2(mean(results.map((r) => r.compassUses))),
    avgEquipmentSpent: round2(mean(results.map((r) => r.equipmentSpent))),
    equipmentWasteRate: round2(purchasedCharges === 0 ? 0 : (leftCharges / purchasedCharges) * 100),
    avgEndStamina: round2(mean(results.map((r) => r.endStamina ?? 0))),
    avgEndDaysRemaining: round2(mean(results.map((r) => r.endDaysRemaining ?? 0))),
    avgOasisVisits: round2(mean(results.map((r) => r.oasisVisits ?? 0))),
    avgVillageVisits: round2(mean(results.map((r) => r.villageVisits ?? 0))),
    avgWeatherHits: round2(mean(results.map((r) => r.weatherDamageHits ?? 0))),
    avgWeatherDamage: round2(mean(results.map((r) => r.weatherDamageTotal ?? 0))),
    avgEncounters: round2(mean(results.map((r) => r.encounterCount ?? 0))),
    avgRestCount: round2(mean(results.map((r) => r.restCount ?? 0))),
    avgWaitCount: round2(mean(results.map((r) => r.waitCount ?? 0))),
    restRate: round2(runs === 0 ? 0 : (restRuns / runs) * 100),
    encounterRate: round2(runs === 0 ? 0 : (encounterRuns / runs) * 100),
    mineSlotShare: Object.fromEntries(
      Object.entries(slotCounts).map(([k, v]) => [k, round2((v / runs) * 100)]),
    ),
    avgGemsKgWins: round2(mean(wins.map((r) => r.gemsKg))),
    mineVisits,
    avgRouteScore: scores.length ? round2(mean(scores)) : null,
    forecast: aggregateForecast(results),
    avgVillageWorkDays: round2(mean(results.map((r) => r.villageWorkDays ?? 0))),
    avgVillageWorkIncome: round2(mean(results.map((r) => r.villageWorkIncome ?? 0))),
  };
}

/** 天气预报专项聚合（v0.1.3 现金计价） */
export function aggregateForecast(results: RunResult[]): ForecastSummary {
  const runs = results.length || 1;
  const purchased = results.filter((r) => (r.forecastPacks ?? 0) > 0).length;
  const used = results.filter((r) => (r.forecastChargesUsed ?? 0) > 0).length;
  const granted = results.reduce((a, r) => a + (r.forecastChargesGranted ?? 0), 0);
  const usedCharges = results.reduce((a, r) => a + (r.forecastChargesUsed ?? 0), 0);
  const opportunities = results.reduce((a, r) => a + (r.forecastDecisionOpportunities ?? 0), 0);
  const useful = results.reduce((a, r) => a + (r.forecastDecisionUseful ?? 0), 0);
  const money = results.reduce((a, r) => a + (r.forecastMoneySpent ?? 0), 0);
  const stamina = results.reduce((a, r) => a + (r.staminaLossAvoidedEstimate ?? 0), 0);
  const days = results.reduce((a, r) => a + (r.daysLostAvoidedEstimate ?? 0), 0);
  const tents = results.reduce((a, r) => a + (r.tentsDestroyedAvoidedEstimate ?? 0), 0);
  const compass = results.reduce((a, r) => a + (r.compassUsesAvoidedEstimate ?? 0), 0);
  // 「伤害减少点数」= 耐力 + 天数 + 帐篷 + 指南针 的加权估计（统一到"资源点数"口径）
  const damagePoints = stamina + days + tents * 2 + compass;
  return {
    purchaseRate: round2((purchased / runs) * 100),
    avgPacks: round2(mean(results.map((r) => r.forecastPacks ?? 0))),
    avgMoneySpent: round2(mean(results.map((r) => r.forecastMoneySpent ?? 0))),
    avgChargesGranted: round2(mean(results.map((r) => r.forecastChargesGranted ?? 0))),
    avgChargesUsed: round2(mean(results.map((r) => r.forecastChargesUsed ?? 0))),
    avgChargesUnused: round2(mean(results.map((r) => r.forecastChargesUnused ?? 0))),
    packUsageRate: round2(granted === 0 ? 0 : (usedCharges / granted) * 100),
    damageReductionPer100: round2(money === 0 ? 0 : (damagePoints / money) * 100),
    decisionUtilityRate: round2(opportunities === 0 ? 0 : (useful / opportunities) * 100),
    avgDecisionUseful: round2(mean(results.map((r) => r.forecastDecisionUseful ?? 0))),
    avgInformationalOnly: round2(mean(results.map((r) => r.forecastInformationalOnly ?? 0))),
    avgSevereOptionsSeen: round2(mean(results.map((r) => r.forecastSevereOptionsSeen ?? 0))),
    avgSevereAvoided: round2(mean(results.map((r) => r.forecastSevereAvoided ?? 0))),
    avgSevereEntered: round2(mean(results.map((r) => r.forecastSevereEntered ?? 0))),
    avgStaminaLossAvoidedEstimate: round2(mean(results.map((r) => r.staminaLossAvoidedEstimate ?? 0))),
    avgDaysLostAvoidedEstimate: round2(mean(results.map((r) => r.daysLostAvoidedEstimate ?? 0))),
    avgTentDurabilitySavedEstimate: round2(mean(results.map((r) => r.tentDurabilitySavedEstimate ?? 0))),
    avgTentsDestroyedAvoidedEstimate: round2(mean(results.map((r) => r.tentsDestroyedAvoidedEstimate ?? 0))),
    avgCompassUsesAvoidedEstimate: round2(mean(results.map((r) => r.compassUsesAvoidedEstimate ?? 0))),
    useRate: round2((used / runs) * 100),
  };
}

/* ------------------------------------------------------------------ */
/* 节点/边/事件 聚合                                                     */
/* ------------------------------------------------------------------ */

export interface NodeHeat {
  nodeId: string;
  outVisits: number;
  retVisits: number;
  totalVisits: number;
  /** 使用过该节点的局数比例 */
  runFraction: number;
}

export function aggregateNodeHeat(results: RunResult[]): NodeHeat[] {
  const acc: Record<string, { out: number; ret: number; runs: number }> = {};
  for (const r of results) {
    const seen = new Set<string>();
    for (const [id, v] of Object.entries(r.nodeVisits)) {
      const a = (acc[id] ??= { out: 0, ret: 0, runs: 0 });
      a.out += v.out;
      a.ret += v.ret;
      seen.add(id);
    }
    for (const id of seen) acc[id].runs += 1;
  }
  return Object.entries(acc)
    .map(([nodeId, a]) => ({
      nodeId,
      outVisits: a.out,
      retVisits: a.ret,
      totalVisits: a.out + a.ret,
      runFraction: round2(results.length === 0 ? 0 : (a.runs / results.length) * 100),
    }))
    .sort((x, y) => y.totalVisits - x.totalVisits);
}

export interface EdgeHeat {
  edge: string;
  uses: number;
  runFraction: number;
}

export function aggregateEdgeHeat(results: RunResult[]): EdgeHeat[] {
  const acc: Record<string, number> = {};
  for (const r of results) {
    for (const [edge, uses] of Object.entries(r.edgeUses)) {
      acc[edge] = (acc[edge] ?? 0) + uses;
    }
  }
  return Object.entries(acc)
    .map(([edge, uses]) => ({ edge, uses, runFraction: 0 }))
    .sort((x, y) => y.uses - x.uses);
}

export interface EventStat {
  kind: string;
  count: number;
  /** 每千局触发次数 */
  per1000: number;
  choiceRates: Record<string, number>;
  avgDayDelta: number;
  avgCashDelta: number;
}

export function aggregateEvents(results: RunResult[]): EventStat[] {
  const acc: Record<string, { n: number; choices: Record<string, number>; days: number; cash: number }> = {};
  for (const r of results) {
    for (const ev of r.events) {
      const a = (acc[ev.kind] ??= { n: 0, choices: {}, days: 0, cash: 0 });
      a.n += 1;
      a.choices[ev.choice] = (a.choices[ev.choice] ?? 0) + 1;
      a.days += ev.dayDelta;
      a.cash += ev.cashDelta;
    }
  }
  return Object.entries(acc)
    .map(([kind, a]) => {
      const choiceRates: Record<string, number> = {};
      for (const [c, n] of Object.entries(a.choices)) {
        choiceRates[c] = round2((n / a.n) * 100);
      }
      return {
        kind,
        count: a.n,
        per1000: round2(results.length === 0 ? 0 : (a.n / results.length) * 1000),
        choiceRates,
        avgDayDelta: round2(a.n === 0 ? 0 : a.days / a.n),
        avgCashDelta: round2(a.n === 0 ? 0 : a.cash / a.n),
      };
    })
    .sort((x, y) => y.count - x.count);
}
