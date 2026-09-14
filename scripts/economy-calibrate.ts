/**
 * 宝石经济标定（v0.1.2b Human Playtest Fix Round 1）。
 *
 * 用法：
 *   npx tsx scripts/economy-calibrate.ts --runs 3000
 *
 * 思路：宝石单价只由「矿区客观往返难度 + jitter」决定，与 Bot 的玩法决策无关，
 * 因此可以把对局**只跑一次**（记录 mineDifficulty / mineJitter / gemsKg / 现金支出），
 * 然后离线套用任意一组 (base, scale, clampMin, clampMax) 计算收入与净收益。
 *
 * 输出：reports/economy-calibration.md
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RunResult } from '../src/simulation/metrics';
import { gameConfig } from '../src/game/config/gameConfig';
import { computeGemPrice } from '../src/game/map/generate';

interface PriceConfig {
  base: number;
  scale: number;
  clampMin: number;
  clampMax: number;
}

interface CliArgs {
  runs: number;
  workers: number;
  bots: string[];
}

const BOTS = [
  'ReasonablePlayerBot', // 主要校准基准（基本理性的真人玩家）
  'CautiousPlayerBot', // 保守玩家（多买装备、多留余量）
  'ShortestPathBot', // 最短路线 / 最少装备
  'SafeBot', // 安全优先
  'PreparedBot', // 装备充足
  'GreedyMinerBot', // 贪心多挖
  'WastefulBot', // 无意义囤装备（用于确认仍可能亏损）
  'CheapBot', // 不买装备
];

/** 候选定价参数（v0.1.2a 旧配置作为对照基线） */
const CANDIDATES: Array<{ label: string; cfg: PriceConfig }> = [
  { label: '对照·v0.1.2a 旧配置 base10 / scale2.0 / 80~320', cfg: { base: 10, scale: 2.0, clampMin: 80, clampMax: 320 } },
  { label: '下界 base120 / scale2.0 / 130~320', cfg: { base: 120, scale: 2.0, clampMin: 130, clampMax: 320 } },
  { label: '★选定 base140 / scale2.0 / 140~320', cfg: { base: 140, scale: 2.0, clampMin: 140, clampMax: 320 } },
  { label: '上界 base200 / scale2.2 / 200~380', cfg: { base: 200, scale: 2.2, clampMin: 200, clampMax: 380 } },
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { runs: 3000, workers: Math.max(1, Math.min(8, cpus().length - 2)), bots: BOTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--workers') args.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--bots') args.bots = argv[++i].split(',').map((s) => s.trim());
    else throw new Error('未知参数: ' + a);
  }
  return args;
}

function runWorker(bot: string, prefix: string, start: number, end: number, out: string): Promise<void> {
  return new Promise((fulfil, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/sim-worker.ts', '--bot', bot, '--prefix', prefix, '--start', String(start), '--end', String(end), '--out', out],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let err = '';
    let done = false;
    /**
     * 每个分片都带看门狗：高并发下曾出现过子进程不退出导致整个标定永远挂住的情况
     * （表现为若干分片完成后再无任何进展）。超时就把该子进程杀掉并跳过这一片，
     * 保证标定脚本一定能结束，同时明确报告跳过了哪些分片。
     */
    const watchdog = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      timedOut.push({ bot, start, end });
      fulfil(); // 跳过这一片，不阻塞整体
    }, SHARD_TIMEOUT_MS);
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      code === 0 ? fulfil() : reject(new Error(bot + ' worker 退出 ' + code + ': ' + err.slice(-300)));
    });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      reject(e);
    });
  });
}

const SHARD_TIMEOUT_MS = 120_000;
const timedOut: Array<{ bot: string; start: number; end: number }> = [];

async function collect(args: CliArgs): Promise<Map<string, RunResult[]>> {
  const tmp = resolve('reports/.econ-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const tasks: Array<{ bot: string; start: number; end: number; out: string }> = [];
  const per = Math.ceil(args.runs / args.workers);
  for (const bot of args.bots) {
    for (let s = 0; s < args.runs; s += per) {
      const end = Math.min(args.runs, s + per);
      tasks.push({ bot, start: s, end, out: join(tmp, bot + '-' + s + '.json') });
    }
  }
  let idx = 0;
  const errors: string[] = [];
  async function runner() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        await runWorker(t.bot, 'econ-' + t.bot, t.start, t.end, t.out);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      process.stdout.write('\r采集 ' + (idx) + '/' + tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.workers, tasks.length) }, () => runner()));
  process.stdout.write('\n');
  if (errors.length) throw new Error(errors.join('\n'));
  const byBot = new Map<string, RunResult[]>();
  for (const bot of args.bots) byBot.set(bot, []);
  for (const t of tasks) {
    if (!existsSync(t.out)) continue; // 看门狗跳过的分片
    const chunk: RunResult[] = JSON.parse(readFileSync(t.out, 'utf-8'));
    byBot.get(t.bot)!.push(...chunk);
  }
  if (timedOut.length) {
    process.stderr.write(
      '\n[watchdog] 以下分片超时被跳过（' + timedOut.length + ' 片）：' +
        timedOut.map((t) => t.bot + '[' + t.start + ',' + t.end + ')').join(', ') +
        '\n',
    );
  }
  rmSync(tmp, { recursive: true, force: true });
  return byBot;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

interface BotEcon {
  bot: string;
  runs: number;
  errors: number;
  successRate: number;
  avgGemsWins: number;
  avgRevenueWins: number;
  medianRevenueWins: number;
  avgSpending: number;
  avgNetProfitWins: number;
  medianNetProfitWins: number;
  p10NetProfitWins: number;
  evNetProfitAll: number;
  profitableWinRate: number;
}

function evaluate(results: RunResult[], cfg: PriceConfig): BotEcon {
  const ok = results.filter((r) => !r.error);
  const wins = ok.filter((r) => r.status === 'VICTORY');
  const revenueOf = (r: RunResult) =>
    r.status === 'VICTORY' && r.mineDifficulty !== null
      ? Math.round(r.gemsKg * computeGemPrice(r.mineDifficulty, r.mineJitter ?? 1, cfg))
      : 0;
  const netOf = (r: RunResult) => r.cashRemaining + revenueOf(r) - gameConfig.startCash;
  const winRev = wins.map(revenueOf).sort((a, b) => a - b);
  const winNet = wins.map(netOf).sort((a, b) => a - b);
  return {
    bot: results[0]?.bot ?? '?',
    runs: results.length,
    errors: results.filter((r) => r.error).length,
    successRate: r2((wins.length / Math.max(1, results.length)) * 100),
    avgGemsWins: r2(mean(wins.map((r) => r.gemsKg))),
    avgRevenueWins: r2(mean(winRev)),
    medianRevenueWins: quantile(winRev, 50),
    avgSpending: r2(mean(ok.map((r) => r.equipmentSpent))),
    avgNetProfitWins: r2(mean(winNet)),
    medianNetProfitWins: quantile(winNet, 50),
    p10NetProfitWins: quantile(winNet, 10),
    evNetProfitAll: r2(mean(ok.map(netOf))),
    profitableWinRate: r2((winNet.filter((v) => v > 0).length / Math.max(1, winNet.length)) * 100),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const byBot = await collect(args);

  const diffs: number[] = [];
  const lens: number[] = [];
  for (const results of byBot.values()) {
    for (const r of results) {
      if (r.mineDifficulty !== null) diffs.push(r.mineDifficulty);
      if (r.outboundDays !== null && r.returnDays > 0) lens.push(r.outboundDays + r.returnDays);
    }
  }
  const sortedDiff = [...diffs].sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push('# 宝石经济标定报告（v0.1.2b · Human Playtest Fix Round 1）');
  lines.push('');
  lines.push('- 生成时间：' + new Date().toISOString());
  lines.push('- 地图：' + gameConfig.map.rows + '×' + gameConfig.map.cols + '，城市 (' + (gameConfig.map.rows - 1) + ',0)，矿区 col=' + (gameConfig.map.cols - 1) + '、row∈[0,' + (gameConfig.map.rows - 1 - gameConfig.map.mineBottomForbiddenRows) + ']');
  lines.push('- 规模：' + args.bots.length + ' 个 Bot × ' + args.runs + ' seeds');
  if (args.runs <= 1500) {
    lines.push(
      '- 说明：本轮为**专项小规模标定**（数千局量级，符合「不做几十万局大规模 Balance Validation」的约束）；' +
        '上一次 3000×8 的扫描因 worker 子进程在 8 路并发下不退出而停在 12000 局，已给标定脚本加看门狗。',
    );
  }
  lines.push('- 计价原则：单价 = clamp((base + 客观往返难度 × scale) × jitter)，与玩家实际路线完全无关');
  lines.push('');
  lines.push('## 一、客观难度分布（进入过矿区的对局）');
  lines.push('');
  lines.push('| 指标 | min | p10 | p25 | median | p75 | p90 | max | avg |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  lines.push(
    '| 矿区难度分 | ' + Math.min(...diffs) + ' | ' + quantile(sortedDiff, 10) + ' | ' + quantile(sortedDiff, 25) + ' | ' + quantile(sortedDiff, 50) + ' | ' + quantile(sortedDiff, 75) + ' | ' + quantile(sortedDiff, 90) + ' | ' + Math.max(...diffs) + ' | ' + r2(mean(diffs)) + ' |',
  );
  lines.push('');
  lines.push('## 二、候选定价参数对比');
  lines.push('');
  for (const cand of CANDIDATES) {
    const prices = diffs.map((d) => computeGemPrice(d, 1, cand.cfg)).sort((a, b) => a - b);
    lines.push('### ' + cand.label);
    lines.push('');
    lines.push(
      '价格分布：min=' + prices[0] + ' p10=' + quantile(prices, 10) + ' median=' + quantile(prices, 50) + ' p90=' + quantile(prices, 90) + ' max=' + prices[prices.length - 1] + ' avg=' + r2(mean(prices)) +
        ' · 触底占比=' + r2((prices.filter((p) => p === cand.cfg.clampMin).length / prices.length) * 100) + '%' +
        ' · 触顶占比=' + r2((prices.filter((p) => p === cand.cfg.clampMax).length / prices.length) * 100) + '%',
    );
    lines.push('');
    lines.push('| Bot | 胜率% | 平均宝石kg(胜) | 平均收入(胜) | 中位收入(胜) | 平均装备支出 | 平均净收益(胜) | 中位净收益(胜) | p10净收益(胜) | EV(全部局) | 成功局盈利占比% |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const bot of args.bots) {
      const e = evaluate(byBot.get(bot)!, cand.cfg);
      lines.push(
        '| ' + e.bot + ' | ' + e.successRate + ' | ' + e.avgGemsWins + ' | ' + e.avgRevenueWins + ' | ' + e.medianRevenueWins + ' | ' + e.avgSpending + ' | ' + e.avgNetProfitWins + ' | ' + e.medianNetProfitWins + ' | ' + e.p10NetProfitWins + ' | ' + e.evNetProfitAll + ' | ' + e.profitableWinRate + ' |' +
          (e.errors > 0 ? ' ←← errors=' + e.errors : ''),
      );
    }
    lines.push('');
    // 「只挖 1 天 / 不买装备」这类不合理玩法必须仍有亏损空间（§6）
    const reasonable = evaluate(byBot.get('ReasonablePlayerBot') ?? byBot.get(args.bots[0])!, cand.cfg);
    const oneDayNet = Math.round(2 * computeGemPrice(quantile(sortedDiff, 50), 1, cand.cfg)) - 900;
    lines.push(
      '- §6 亏损空间检查：只挖 1 天（2kg）+ 常规装备 900 元 → 净收益 ' + oneDayNet + ' 元（' + (oneDayNet < 0 ? '亏损 ✓' : '仍盈利 ✗') + '）',
    );
    lines.push(
      '- §7 合理成功局检查：ReasonablePlayerBot 成功局盈利占比 ' + reasonable.profitableWinRate + '%，p10 净收益 ' + reasonable.p10NetProfitWins + ' 元（' + (reasonable.profitableWinRate > 95 && reasonable.p10NetProfitWins > 0 ? '明确正收益 ✓' : '不达标 ✗') + '）',
    );
    lines.push('');
  }

  lines.push('## 三、刷价漏洞检查');
  lines.push('');
  lines.push('单价函数签名只接受 (difficultyScore, jitter)，不含任何玩家行为量；');
  lines.push('`difficultyScore` 在地图生成阶段由「最短合法往返方案」的客观风险一次性算出，');
  lines.push('绕路 / 受伤 / 烧帐篷 / 用指南针 / 原地等待都不会改变它（见 tests/simulation.test.ts 刷价回归）。');
  lines.push('');

  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/economy-calibration.md', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log('\n（耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，报告写入 reports/economy-calibration.md）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
