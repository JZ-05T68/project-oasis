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
  routeScore: number | null;
  daysUsed: number;
  outboundDays: number | null;
  miningDays: number;
  returnDays: number;
  forecastPacks: number;
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

  avgGemsKgWins: number;
  /** 矿区选择分布 */
  mineVisits: Record<TileId, number>;
  /** 平均路线风险评分（有值的局） */
  avgRouteScore: number | null;
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
    avgGemsKgWins: round2(mean(wins.map((r) => r.gemsKg))),
    mineVisits,
    avgRouteScore: scores.length ? round2(mean(scores)) : null,
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
