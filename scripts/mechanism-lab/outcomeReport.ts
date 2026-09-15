/**
 * v0.2.0 Outcome Lab —— 汇总与评分。
 *
 * 读 raw/sweep-<tag>.jsonl，对每个 (variant, bot) 计算 OutcomeScore，
 * 并按「合理玩家代理」（OutcomeMasterBot）汇总排名。
 *
 * 用法：npx tsx scripts/mechanism-lab/outcomeReport.ts --tag phaseA
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRows, LAB_DIR, type OutcomeSweepRow } from './runOutcomeLab';
import { outcomeScore, OUTCOME_TARGETS, explainabilityCheck, type OutcomeScore } from './outcomeScore';
import { OUTCOME_VARIANT_BY_ID } from './outcomeMechs';

interface Args { tag: string; primary: string; json: boolean }
function parse(argv: string[]): Args {
  const a: Args = { tag: 'phaseA', primary: 'OutcomeMasterBot', json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tag') a.tag = argv[++i];
    else if (k === '--primary') a.primary = argv[++i];
    else if (k === '--json') a.json = true;
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

const args = parse(process.argv.slice(2));
const rows = readRows(resolve(LAB_DIR, 'raw', `sweep-${args.tag}.jsonl`));
if (rows.length === 0) {
  console.error(`没有找到 ${args.tag} 的结果`);
  process.exit(1);
}

/** 取某个 (variant, bot) 的最新一行 */
function pick(variant: string, bot: string): OutcomeSweepRow | undefined {
  return rows.filter((r) => r.variant === variant && r.bot === bot).pop();
}
/** 某个 variant 任意 Bot 的最新行（用于取 seeds 数） */
function anyOf(variant: string): OutcomeSweepRow | undefined {
  return rows.filter((r) => r.variant === variant).pop();
}

const variants = [...new Set(rows.map((r) => r.variant))];
const baseRow = pick('BASE', args.primary) ?? anyOf('BASE');
const baseEv = baseRow?.summary.evNetProfitAllRuns ?? 0;
const baseRoute = baseRow?.metrics.routeSwitchRate ?? 0;

interface Scored {
  variant: string;
  label: string;
  bot: string;
  score: OutcomeScore;
  row: OutcomeSweepRow;
}

const scored: Scored[] = [];
for (const v of variants) {
  const row = pick(v, args.primary);
  if (!row) continue;
  const m = row.metrics;
  const o = m.outcome;
  const complexity = OUTCOME_VARIANT_BY_ID[v]?.complexity ?? { stateVars: 0, formulas: 0, buttons: 0 };
  const score = outcomeScore({
    completion: o.completionRate,
    profitability: o.profitableRate,
    profitAmongCompleted: o.profitAmongCompleted,
    decisionChange: m.dc.overall,
    newMechanismChange: m.dc.newMechanism,
    topMiningDayShare: m.topMiningDayShare,
    distinctMiningDays: m.distinctMiningDays,
    topFailureShare: m.topFailureShare,
    topFailureReason: m.topFailureReason,
    staminaDeathRate: m.staminaDeathRate,
    timeoutRate: m.timeoutRate,
    ev: row.summary.evNetProfitAllRuns,
    baseEv,
    villageStopGivenVisit: m.villageStopGivenVisit,
    surgeUseRate: m.surgeUseRate,
    rescueUseRate: m.rescueUseRate,
    complexity,
    routeSwitchRate: m.routeSwitchRate,
    baseRouteSwitchRate: baseRoute,
    forecastPurchaseRate: row.summary.forecast.purchaseRate,
  });
  scored.push({ variant: v, label: OUTCOME_VARIANT_BY_ID[v]?.label ?? v, bot: args.primary, score, row });
}

scored.sort((a, b) => b.score.total - a.score.total);

if (args.json) {
  process.stdout.write(JSON.stringify(scored.map((s) => ({
    variant: s.variant,
    total: s.score.total,
    parts: s.score.parts,
    penalties: s.score.penalties,
    completion: s.row.metrics.outcome.completionRate,
    profitability: s.row.metrics.outcome.profitableRate,
    amongCompleted: s.row.metrics.outcome.profitAmongCompleted,
    ev: s.row.summary.evNetProfitAllRuns,
    dc: s.row.metrics.dc.overall,
    notes: s.score.notes,
  })), null, 2));
} else {
  console.log(`\n## Outcome Score 排名（${args.tag}，主 Bot = ${args.primary}）\n`);
  console.log('| 排名 | 候选 | Score | Completion | Profitability | 成功后盈利 | EV | Δdecision | 主要说明 |');
  console.log('|---:|---|---:|---:|---:|---:|---:|---:|---|');
  scored.forEach((s, i) => {
    const o = s.row.metrics.outcome;
    const notes = s.score.notes.slice(0, 1).join('；') || '—';
    console.log(`| ${i + 1} | ${s.variant} | ${s.score.total} | ${o.completionRate}% | ${o.profitableRate}% | ${o.profitAmongCompleted}% | ${s.row.summary.evNetProfitAllRuns} | ${s.row.metrics.dc.overall}% | ${notes} |`);
  });
  console.log('\n### 分量明细\n');
  console.log('| 候选 | completion | profitability | econIndep | decision | diversity | failureDiv | econHealth | penalties |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of scored) {
    const p = s.score.parts;
    const pen = Object.entries(s.score.penalties).map(([k, v]) => `${k}:${v}`).join(',') || '—';
    console.log(`| ${s.variant} | ${p.completionTarget ?? 0} | ${p.profitabilityTarget ?? 0} | ${p.economyIndependence ?? 0} | ${p.decisionQuality ?? 0} | ${p.strategyDiversity ?? 0} | ${p.failureDiversity ?? 0} | ${p.economyHealth ?? 0} | ${pen} |`);
  }
  console.log(`\n目标区间：Completion ${OUTCOME_TARGETS.completion.lo}~${OUTCOME_TARGETS.completion.hi}%（放宽带 ${OUTCOME_TARGETS.completion.acceptLo}~${OUTCOME_TARGETS.completion.acceptHi}%）、Profitability ${OUTCOME_TARGETS.profitability.lo}~${OUTCOME_TARGETS.profitability.hi}%\n`);

  // 逐候选的判决
  console.log('### 判决\n');
  for (const s of scored) {
    const o = s.row.metrics.outcome;
    const inBandC = o.completionRate >= OUTCOME_TARGETS.completion.lo && o.completionRate <= OUTCOME_TARGETS.completion.hi;
    const inAcC = o.completionRate >= OUTCOME_TARGETS.completion.acceptLo && o.completionRate <= OUTCOME_TARGETS.completion.acceptHi;
    const inBandP = o.profitableRate >= OUTCOME_TARGETS.profitability.lo && o.profitableRate <= OUTCOME_TARGETS.profitability.hi;
    const flags = [
      inBandC ? 'COMPLETION_IN_BAND' : inAcC ? 'COMPLETION_NEAR_BAND' : 'COMPLETION_OUT',
      inBandP ? 'PROFIT_IN_BAND' : 'PROFIT_OUT',
      s.row.metrics.dc.newMechanism > 10 ? 'DECISION_OK' : 'DECISION_WEAK',
      s.row.metrics.topFailureShare <= 45 ? 'FAILURE_DIVERSIFIED' : 'FAILURE_CONCENTRATED',
      s.row.metrics.dominantVillageAction ? 'VILLAGE_DOMINANT' : '',
      o.profitAmongCompleted >= 98 ? 'ECONOMY_NOT_INDEPENDENT' : '',
    ].filter(Boolean);
    console.log(`- **${s.variant}** (${s.score.total}分): ${flags.join(' / ')}`);
    for (const n of s.score.notes) console.log(`    - ${n}`);
  }
}

void existsSync;
void explainabilityCheck;
