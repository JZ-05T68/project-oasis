/**
 * Balance 仿真 CLI（支持多进程并行）。
 *
 * 用法：
 *   npm run sim                                # 默认：全部 Bot × 1000 seeds，输出到 reports/sim/
 *   npm run sim -- --runs 10000                # 每个 Bot 10000 seeds
 *   npm run sim -- --bots RandomBot,ReasonablePlayerBot
 *   npm run sim -- --runs 10000 --workers 8 --seedPrefix bal --outputDir reports/baseline
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALL_BOTS, BOT_BY_NAME } from '../src/simulation/bots';
import {
  aggregateBot,
  aggregateEdgeHeat,
  aggregateEvents,
  aggregateNodeHeat,
  type BotSummary,
  type RunResult,
} from '../src/simulation/metrics';
import { gameConfig } from '../src/game/config/gameConfig';

interface CliArgs {
  runs: number;
  bots: string[] | null;
  seedPrefix: string;
  outputDir: string;
  workers: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    runs: 1000,
    bots: null,
    seedPrefix: 'sim',
    outputDir: 'reports/sim',
    workers: Math.max(1, Math.min(8, cpus().length - 2)),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--bots') args.bots = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--seedPrefix') args.seedPrefix = argv[++i];
    else if (a === '--outputDir') args.outputDir = argv[++i];
    else if (a === '--workers') args.workers = Math.max(1, Number(argv[++i]));
    else throw new Error(`未知参数: ${a}`);
  }
  if (!Number.isFinite(args.runs) || args.runs < 1) throw new Error('--runs 必须为正整数');
  return args;
}

interface ChunkTask {
  bot: string;
  start: number;
  end: number;
  outFile: string;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function botSummaryRows(summaries: BotSummary[]): Array<Record<string, unknown>> {
  return summaries.map((s) => ({
    bot: s.bot,
    runs: s.runs,
    errors: s.errors,
    wins: s.wins,
    winRatePct: s.winRate,
    evNetProfitAllRuns: s.evNetProfitAllRuns,
    avgNetProfitWins: s.avgNetProfitWins,
    medianFinalAssetsWins: s.finalAssetsWins.median,
    p10: s.finalAssetsWins.p10,
    p25: s.finalAssetsWins.p25,
    p75: s.finalAssetsWins.p75,
    p90: s.finalAssetsWins.p90,
    max: s.finalAssetsWins.max,
    min: s.finalAssetsWins.min,
    avgGemsKgWins: s.avgGemsKgWins,
    failTimeoutPct: s.failureRates.TIMEOUT,
    failStaminaPct: s.failureRates.STAMINA_EXHAUSTED,
    failSeveredPct: s.failureRates.RETURN_ROUTE_SEVERED,
    failTrappedPct: s.failureRates.TRAPPED,
    avgOutboundDays: s.avgOutboundDays,
    avgMiningDays: s.avgMiningDays,
    avgReturnDays: s.avgReturnDays,
    avgForecastPacks: s.avgForecastPacks,
    avgTentsBought: s.avgTentsBought,
    avgCompassesBought: s.avgCompassesBought,
    avgTentUses: s.avgTentUses,
    avgCompassUses: s.avgCompassUses,
    avgEquipmentSpent: s.avgEquipmentSpent,
    equipmentWasteRatePct: s.equipmentWasteRate,
    avgRouteScore: s.avgRouteScore,
    mineAVisits: Object.values(s.mineVisits).reduce((a, b) => a + b, 0) ? (s.mineVisits[Object.keys(s.mineVisits)[0]] ?? 0) : 0,
    mineDistinct: Object.keys(s.mineVisits).length,
  }));
}

function runChunk(task: ChunkTask): Promise<void> {
  return new Promise((fulfil, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx',
        'scripts/sim-worker.ts',
        '--bot', task.bot,
        '--prefix', task.bot,
        '--start', String(task.start),
        '--end', String(task.end),
        '--out', task.outFile,
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => {
      if (code === 0) fulfil();
      else reject(new Error(`worker ${task.bot}[${task.start},${task.end}) 退出码 ${code}: ${stderr.slice(-500)}`));
    });
    child.on('error', reject);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bots = args.bots
    ? args.bots.map((n) => {
        const b = BOT_BY_NAME[n];
        if (!b) throw new Error(`未知 Bot: ${n}（可用: ${ALL_BOTS.map((x) => x.name).join(', ')}）`);
        return b;
      })
    : ALL_BOTS;

  const t0 = Date.now();
  const tmpDir = resolve(args.outputDir, '.tmp');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // 展平任务队列：每个 bot 的 seed 区间切成 workers 份
  const tasks: ChunkTask[] = [];
  for (const bot of bots) {
    const per = Math.ceil(args.runs / args.workers);
    for (let start = 0; start < args.runs; start += per) {
      const end = Math.min(args.runs, start + per);
      tasks.push({
        bot: bot.name,
        start,
        end,
        outFile: join(tmpDir, `${bot.name}-${start}-${end}.json`),
      });
    }
  }

  // 受限并发执行
  const workers = Math.min(args.workers, tasks.length);
  let done = 0;
  let index = 0;
  const errors: string[] = [];
  async function runner() {
    while (index < tasks.length) {
      const task = tasks[index++];
      try {
        await runChunk(task);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      done++;
      process.stdout.write(`\r进度 ${done}/${tasks.length} 个分片`);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => runner()));
  process.stdout.write('\n');
  if (errors.length > 0) {
    throw new Error(`有 ${errors.length} 个分片失败：\n${errors.join('\n')}`);
  }

  // 汇总
  const byBot = new Map<string, RunResult[]>();
  for (const bot of bots) byBot.set(bot.name, []);
  for (const task of tasks) {
    const chunk: RunResult[] = JSON.parse(readFileSync(task.outFile, 'utf-8'));
    byBot.get(task.bot)!.push(...chunk);
  }
  rmSync(tmpDir, { recursive: true, force: true });

  const summaries = bots.map((b) => aggregateBot(byBot.get(b.name)!));
  const allResults: RunResult[] = [];
  for (const b of bots) allResults.push(...byBot.get(b.name)!);

  const outDir = resolve(args.outputDir);
  mkdirSync(outDir, { recursive: true });
  writeReports(outDir, summaries, allResults, {
    runs: args.runs,
    seedPrefix: args.seedPrefix,
    bots: bots.map((b) => b.name),
  });
  console.log(`\n报告已写入 ${outDir}（总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}

function writeReports(
  outDir: string,
  summaries: BotSummary[],
  results: RunResult[],
  meta: { runs: number; seedPrefix: string; bots: string[] },
): void {
  const nodeHeat = aggregateNodeHeat(results);
  const edgeHeat = aggregateEdgeHeat(results);
  const events = aggregateEvents(results);

  writeFileSync(join(outDir, 'bots.csv'), toCsv(botSummaryRows(summaries)));
  writeFileSync(join(outDir, 'failures.csv'), toCsv(failureRows(summaries)));
  writeFileSync(join(outDir, 'mines.csv'), toCsv(mineRows(summaries)));
  writeFileSync(join(outDir, 'events.csv'), toCsv(eventRows(events)));
  writeFileSync(join(outDir, 'nodes.csv'), toCsv(nodeRows(nodeHeat)));
  writeFileSync(join(outDir, 'edges.csv'), toCsv(edgeRows(edgeHeat)));

  const sorted = [...summaries].sort((a, b) => b.evNetProfitAllRuns - a.evNetProfitAllRuns);
  const lines: string[] = [];
  lines.push('# 仿真汇总（自动生成）');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 规模：${meta.bots.length} 个 Bot × ${meta.runs} seeds（seed 形如 ${meta.seedPrefix}:<Bot>:<i>）`);
  lines.push(`- 版本：v0.1.2b 地图 ${gameConfig.map.rows}×${gameConfig.map.cols} / 宝石单价 = 客观往返难度映射（base=${gameConfig.mineValuation.base}, scale=${gameConfig.mineValuation.scale}, clamp=${gameConfig.mineValuation.clampMin}~${gameConfig.mineValuation.clampMax}）`);
  lines.push('');
  lines.push('| Bot | 胜率% | EV(全部局净收益) | 胜局均收益 | 胜局中位资产 | 超时% | 耐力% | 断路% | 困死% | 平均挖矿天 | 平均预报次 | 帐篷/指南针购买 | 装备浪费% |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of sorted) {
    lines.push(
      `| ${s.bot} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.avgNetProfitWins} | ${s.finalAssetsWins.median} | ${s.failureRates.TIMEOUT} | ${s.failureRates.STAMINA_EXHAUSTED} | ${s.failureRates.RETURN_ROUTE_SEVERED} | ${s.failureRates.TRAPPED} | ${s.avgMiningDays} | ${s.avgForecastPacks} | ${s.avgTentsBought}/${s.avgCompassesBought} | ${s.equipmentWasteRate} |`,
    );
  }
  lines.push('');
  lines.push('## 节点热度 Top15');
  lines.push('');
  lines.push('| 节点 | 去程 | 返程 | 合计 | 局覆盖率% |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const n of nodeHeat.slice(0, 15)) {
    lines.push(`| ${n.nodeId} | ${n.outVisits} | ${n.retVisits} | ${n.totalVisits} | ${n.runFraction} |`);
  }
  lines.push('');
  lines.push('## 节点热度 Bottom10');
  lines.push('');
  lines.push('| 节点 | 去程 | 返程 | 合计 | 局覆盖率% |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const n of nodeHeat.slice(-10)) {
    lines.push(`| ${n.nodeId} | ${n.outVisits} | ${n.retVisits} | ${n.totalVisits} | ${n.runFraction} |`);
  }
  writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n');
}

function failureRows(summaries: BotSummary[]): Array<Record<string, unknown>> {
  return summaries.flatMap((s) => [
    { bot: s.bot, reason: 'TIMEOUT', pct: s.failureRates.TIMEOUT },
    { bot: s.bot, reason: 'STAMINA_EXHAUSTED', pct: s.failureRates.STAMINA_EXHAUSTED },
    { bot: s.bot, reason: 'RETURN_ROUTE_SEVERED', pct: s.failureRates.RETURN_ROUTE_SEVERED },
    { bot: s.bot, reason: 'TRAPPED', pct: s.failureRates.TRAPPED },
  ]);
}

function mineRows(summaries: BotSummary[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const s of summaries) {
    for (const [mineId, n] of Object.entries(s.mineVisits)) {
      rows.push({ bot: s.bot, mineId, visits: n, sharePct: Math.round((n / s.runs) * 10000) / 100 });
    }
  }
  return rows;
}

function eventRows(events: ReturnType<typeof aggregateEvents>): Array<Record<string, unknown>> {
  return events.map((e) => ({
    kind: e.kind,
    count: e.count,
    per1000: e.per1000,
    choices: Object.entries(e.choiceRates).map(([c, p]) => `${c}:${p}%`).join(' '),
    avgDayDelta: e.avgDayDelta,
    avgCashDelta: e.avgCashDelta,
  }));
}

function nodeRows(nodes: ReturnType<typeof aggregateNodeHeat>): Array<Record<string, unknown>> {
  return nodes.map((n) => ({
    nodeId: n.nodeId,
    outVisits: n.outVisits,
    retVisits: n.retVisits,
    totalVisits: n.totalVisits,
    runFractionPct: n.runFraction,
  }));
}

function edgeRows(edges: ReturnType<typeof aggregateEdgeHeat>): Array<Record<string, unknown>> {
  return edges.map((e) => ({ edge: e.edge, uses: e.uses }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
