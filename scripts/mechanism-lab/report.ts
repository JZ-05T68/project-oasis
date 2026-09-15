/**
 * 报告生成器：把 sweep-*.jsonl 汇总成 MECHANISM_5H_AUTOLAB_REPORT.md 的全部数据表。
 *
 * 用法：
 *   npx tsx scripts/mechanism-lab/report.ts --tags phaseA,phaseB,phaseC \
 *     --finalists M11,M09 --gate M11 --status MECHANISM_EVOLUTION_READY_FOR_HUMAN_UI_TEST \
 *     --head-before <sha> --head-after <sha> --elapsed "5h02m" --games 123456
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VARIANTS, VARIANT_BY_ID } from './mechs';
import { miningScore, returnScore } from './score';
import { readRows, type SweepRow } from './runLab';

const OUT = 'reports/mechanism-autolab';

interface Args {
  tags: string[];
  finalists: string[];
  gate: string;
  status: string;
  headBefore: string;
  headAfter: string;
  elapsed: string;
  games: string;
  promoted: string;
  rejected: string;
  numerics: string;
}

function parse(argv: string[]): Args {
  const a: Args = {
    tags: ['phaseA'],
    finalists: [],
    gate: '—',
    status: '—',
    headBefore: '—',
    headAfter: '—',
    elapsed: '—',
    games: '—',
    promoted: '—',
    rejected: '—',
    numerics: '—',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tags') a.tags = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--finalists') a.finalists = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--gate') a.gate = argv[++i];
    else if (k === '--status') a.status = argv[++i];
    else if (k === '--head-before') a.headBefore = argv[++i];
    else if (k === '--head-after') a.headAfter = argv[++i];
    else if (k === '--elapsed') a.elapsed = argv[++i];
    else if (k === '--games') a.games = argv[++i];
    else if (k === '--promoted') a.promoted = argv[++i];
    else if (k === '--rejected') a.rejected = argv[++i];
    else if (k === '--numerics') a.numerics = argv[++i];
  }
  return a;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 某候选在某 Bot 上的行 */
function row(map: Map<string, SweepRow>, variant: string, bot: string): SweepRow | undefined {
  return map.get(`${variant}|${bot}`);
}

const PRIMARY_BOT = 'ReasonableMechBot';
const MINING_BOT = 'AdaptiveMinerBot';
const RETURN_BOT = 'ReturnPlannerBot';

function main(): void {
  const args = parse(process.argv.slice(2));
  const rows: SweepRow[] = [];
  for (const t of args.tags) {
    const f = resolve(OUT, 'raw', `sweep-${t}.jsonl`);
    if (!existsSync(f)) {
      console.error(`! 缺少 ${f}`);
      continue;
    }
    rows.push(...readRows(f));
  }
  // 同名 (variant,bot) 保留 runs 最大的那次（Phase B/C 覆盖 Phase A）
  const best = new Map<string, SweepRow>();
  for (const r of rows) {
    const k = `${r.variant}|${r.bot}`;
    const prev = best.get(k);
    if (!prev || r.runs > prev.runs) best.set(k, r);
  }

  const variantIds = [...new Set(rows.map((r) => r.variant))];
  const base = new Map<string, SweepRow>();
  for (const [k, v] of best) if (v.variant === 'BASE') base.set(v.bot, v);

  const basePrimary = base.get(PRIMARY_BOT);
  const baseReturnDiv = base.get(RETURN_BOT)?.metrics.returnRouteDiversity ?? 0;
  const baseReturnDays = base.get(PRIMARY_BOT)?.metrics.returnDays ?? 1;
  const baseEv = basePrimary?.summary.evNetProfitAllRuns ?? 0;

  interface Line {
    id: string;
    label: string;
    family: string;
    runs: number;
    dcOverall: number;
    dcMining: number;
    dcReturn: number;
    dcDrop: number;
    winRate: number;
    ev: number;
    stamina: number;
    timeout: number;
    diversity: number;
    dropRate: number;
    routeDiv: number;
    mineScore: number;
    returnScore: number;
    dominant: boolean;
    note: string;
  }

  const lines: Line[] = [];
  for (const v of variantIds) {
    const p = best.get(`${v}|${PRIMARY_BOT}`) ?? best.get(`${v}|${MINING_BOT}`);
    const mine = best.get(`${v}|${MINING_BOT}`) ?? p;
    const ret = best.get(`${v}|${RETURN_BOT}`) ?? best.get(`${v}|${PRIMARY_BOT}`);
    if (!p) continue;
    const meta = VARIANT_BY_ID[v];
    const mining = miningScore({
      decisionChange: mine?.metrics.dc.overall ?? 0,
      miningDecisionChange: mine?.metrics.dc.mining ?? 0,
      topMiningDayShare: mine?.metrics.topMiningDayShare ?? 100,
      distinctMiningDays: mine?.metrics.distinctMiningDays ?? 1,
      winRate: p.summary.winRate,
      staminaDeathRate: p.summary.failureRates.STAMINA_EXHAUSTED,
      timeoutRate: p.summary.failureRates.TIMEOUT,
      ev: p.summary.evNetProfitAllRuns,
      baseEv,
      returnDiversityRatio: baseReturnDiv === 0 ? 1 : (ret?.metrics.returnRouteDiversity ?? 0) / baseReturnDiv,
    });
    const retS = returnScore({
      returnDecisionChange: ret?.metrics.dc.returnRoute ?? 0,
      routeSwitchRate: ret?.metrics.routeSwitchRate ?? 0,
      routeDiversity: ret?.metrics.returnRouteDiversity ?? 0,
      dropRate: ret?.metrics.dropRate ?? 0,
      winRate: p.summary.winRate,
      staminaDeathRate: p.summary.failureRates.STAMINA_EXHAUSTED,
      severedRate: p.summary.failureRates.RETURN_ROUTE_SEVERED,
      returnDaysRatio: baseReturnDays === 0 ? 1 : (p.metrics.returnDays ?? 0) / baseReturnDays,
      ev: p.summary.evNetProfitAllRuns,
      baseEv,
    });
    lines.push({
      id: v,
      label: meta?.label ?? v,
      family: meta?.family ?? '?',
      runs: p.summary.runs,
      dcOverall: mine?.metrics.dc.overall ?? 0,
      dcMining: mine?.metrics.dc.mining ?? 0,
      dcReturn: ret?.metrics.dc.returnRoute ?? 0,
      dcDrop: ret?.metrics.dc.dropCargo ?? 0,
      winRate: p.summary.winRate,
      ev: p.summary.evNetProfitAllRuns,
      stamina: p.summary.failureRates.STAMINA_EXHAUSTED,
      timeout: p.summary.failureRates.TIMEOUT,
      diversity: mine?.metrics.miningDaysEntropy ?? 0,
      dropRate: ret?.metrics.dropRate ?? 0,
      routeDiv: ret?.metrics.returnRouteDiversity ?? 0,
      mineScore: mining.total,
      returnScore: retS.total,
      dominant: (mine?.metrics.dominant ?? false) || (p.metrics.dominant ?? false),
      note: [...mining.notes, ...retS.notes].slice(0, 2).join('；') || '—',
    });
  }
  lines.sort((a, b) => b.mineScore + b.returnScore - (a.mineScore + a.returnScore));

  const L: string[] = [];
  L.push('# Project Oasis — Autonomous Mechanism Evolution Lab（5 小时自动实验）');
  L.push('');
  L.push('## 0. Executive Summary');
  L.push('');
  L.push('| 项目 | 值 |');
  L.push('|---|---|');
  L.push(`| 总运行时间 | ${args.elapsed} |`);
  L.push(`| 总模拟局数 | ${args.games} |`);
  L.push(`| 机制候选 | ${variantIds.filter((v) => v !== 'BASE').length} 个（另有参数候选见 §2） |`);
  L.push(`| 接受机制 | ${args.promoted} |`);
  L.push(`| 拒绝机制 | ${args.rejected} |`);
  L.push(`| 最终落盘机制 | ${args.gate} |`);
  L.push(`| 最终落盘数值 | ${args.numerics} |`);
  L.push(`| START_HEAD | \`${args.headBefore}\` |`);
  L.push(`| FINAL_HEAD | \`${args.headAfter}\` |`);
  L.push(`| STATUS | **${args.status}** |`);
  L.push('');

  L.push('## 1. 机制排行榜');
  L.push('');
  L.push('| Mechanism | 决策改变率(采矿) | 决策改变率(返程) | 胜率 | EV | 耐力死亡 | 策略多样性 | MiningScore | ReturnScore |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const l of lines) {
    L.push(
      `| ${l.id} ${l.label} | ${l.dcMining}% | ${l.dcReturn}% | ${l.winRate}% | ${l.ev} | ${l.stamina}% | ${l.diversity} | ${l.mineScore} | ${l.returnScore} |`,
    );
  }
  L.push('');

  L.push('## 2. 采矿决策分析（§50）');
  L.push('');
  L.push('| 机制 | 平均采矿天数 | 采矿天数方差 | 提前返程率% | 多挖率% | 采矿天数熵 | 最热模板占比% | 取值个数 | Mine A 均挖 | Mine B 均挖 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const v of variantIds) {
    const m = best.get(`${v}|${MINING_BOT}`)?.metrics;
    if (!m) continue;
    L.push(
      `| ${v} | ${m.avgMiningDays} | ${m.miningDaysVar} | ${m.earlyReturnRate} | ${m.heavyMiningRate} | ${m.miningDaysEntropy} | ${m.topMiningDayShare} | ${m.distinctMiningDays} | ${m.avgMiningDaysBySlot['A'] ?? '—'} | ${m.avgMiningDaysBySlot['B'] ?? '—'} |`,
    );
  }
  L.push('');

  L.push('## 3. 返程决策分析（§51)');
  L.push('');
  L.push('| 机制 | Bot | Δroute(vs基线)% | routeSwitchRate% | returnRouteDiversity | returnDays | 返程剩余耐力 | 负重额外天数 | 丢货率% | 平均丢货kg |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const v of variantIds) {
    for (const b of [RETURN_BOT, 'ReturnPlannerNoDropBot', 'ReasonableMechBot']) {
      const m = best.get(`${v}|${b}`)?.metrics;
      if (!m) continue;
      L.push(
        `| ${v} | ${b} | ${m.dc.returnRoute} | ${m.routeSwitchRate} | ${m.returnRouteDiversity} | ${m.returnDays} | ${m.returnStaminaProxy} | ${m.avgLoadPenaltyDays} | ${m.dropRate} | ${m.avgDroppedKg} |`,
      );
    }
  }
  L.push('');

  L.push('## 4. 完整失败原因分布（§54）');
  L.push('');
  L.push('| 机制 | Bot | 胜率% | STAMINA | TIMEOUT | TRAPPED | RETURN_ROUTE_SEVERED | 其它(错误) |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const v of variantIds) {
    for (const b of [PRIMARY_BOT, MINING_BOT, 'ReasonablePlayerBot']) {
      const s = best.get(`${v}|${b}`)?.summary;
      if (!s) continue;
      L.push(
        `| ${v} | ${b} | ${s.winRate} | ${s.failureRates.STAMINA_EXHAUSTED} | ${s.failureRates.TIMEOUT} | ${s.failureRates.TRAPPED} | ${s.failureRates.RETURN_ROUTE_SEVERED} | ${s.errors} |`,
      );
    }
  }
  L.push('');

  L.push('## 5. 策略多样性（§55）');
  L.push('');
  const allBots = [...new Set(rows.map((r) => r.bot))];
  L.push(`| Bot | ${variantIds.join(' 胜率/EV | ')} 胜率/EV |`);
  L.push(`|---|${variantIds.map(() => '---|').join('')}`);
  for (const b of allBots) {
    const cells = variantIds.map((v) => {
      const s = best.get(`${v}|${b}`)?.summary;
      return s ? `${s.winRate}/${s.evNetProfitAllRuns}` : '—';
    });
    L.push(`| ${b} | ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 6. 支配策略检测（§21）');
  L.push('');
  L.push('| 机制 | 采矿天数最热模板占比% | 是否 DOMINANT | 说明 |');
  L.push('|---|---:|:--:|---|');
  for (const l of lines) {
    L.push(`| ${l.id} | ${l.dominant ? '>90' : '≤90'} | ${l.dominant ? '⚠️ YES' : '✅ no'} | ${l.note} |`);
  }
  L.push('');

  L.push('## 7. 机制候选定义表（§45 机制版本记录）');
  L.push('');
  L.push('| ID | 名称 | 族 | 新增状态变量 | 新增公式 | 新增按钮 | 解决的问题 | 玩家新增决策 |');
  L.push('|---|---|---|---:|---:|---:|---|---|');
  for (const v of VARIANTS) {
    L.push(
      `| ${v.id} | ${v.label} | ${v.family} | ${v.complexity.stateVars} | ${v.complexity.formulas} | ${v.complexity.buttons} | ${v.problem} | ${v.newDecision} |`,
    );
  }
  L.push('');
  L.push('## 8. 假设 vs 实测（§45 每版必须写）');
  L.push('');
  L.push('| ID | 事前假设 | 实测结论 |');
  L.push('|---|---|---|');
  for (const v of VARIANTS) {
    const l = lines.find((x) => x.id === v.id);
    const verdict = l
      ? `采矿决策改变率 ${l.dcMining}%、返程 ${l.dcReturn}%、胜率 ${l.winRate}%、耐力死亡 ${l.stamina}% → MiningScore ${l.mineScore} / ReturnScore ${l.returnScore}`
      : '（未运行）';
    L.push(`| ${v.id} | ${v.hypothesis} | ${verdict} |`);
  }
  L.push('');

  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, '_generated-tables.md'), L.join('\n') + '\n');
  writeFileSync(resolve(OUT, 'raw', 'report-lines.json'), JSON.stringify(lines, null, 2));
  console.log(L.join('\n'));
  console.log(`\n→ ${OUT}/_generated-tables.md`);
}

void r2;
void row;
void readFileSync;
main();
