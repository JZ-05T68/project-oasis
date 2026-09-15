/**
 * Forecast Economy Autonomous Lab —— 实验驱动器。
 *
 * 用法：
 *   npx tsx scripts/forecast-lab/lab.ts \
 *     --label fc-200x3 \
 *     --price 200 --charges 3 [--auto 1] \
 *     --runs 800 --workers 4 \
 *     --out reports/forecast-autolab/raw
 *
 * 只改 forecast.* 三个参数（通过 OASIS_CONFIG_OVERRIDE 注入，不改源码、不改其它机制）。
 * 安全约束沿用上一轮已验证的设置：
 *   - workers 默认 4（8 路会挂）；
 *   - 每分片 120s 看门狗，超时 kill 并记录；
 *   - 全局 10 分钟无进展看门狗。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOT_BY_NAME, FORECAST_BOTS } from '../../src/simulation/bots';
import { aggregateBot, type BotSummary, type RunResult } from '../../src/simulation/metrics';
import { mergeWithOverride } from '../../src/game/config/gameConfig';
import { forecastScore, type ScoreBreakdown } from './score';

interface Args {
  label: string;
  price: number;
  charges: number;
  auto: number;
  runs: number;
  workers: number;
  timeout: number;
  globalTimeout: number;
  bots: string[];
  out: string;
  uiConsistency: number;
  /** 附加覆盖（JSON 字符串），会与 forecast.* 深合并 */
  extra: string;
}

const BOT_NAMES = FORECAST_BOTS.map((b) => b.name);

/**
 * 所有 Bot 共用同一批 Seed（= 同一批地图/天气/遭遇世界），
 * 这样「买预报 vs 不买预报」是**配对比较**：差异只来自 Bot 决策，
 * 不来自世界运气。旧版本给每个 Bot 用不同 prefix，会把世界方差混进 EV 差里。
 */
const SEED_PREFIX = 'fclab';

function parseArgs(argv: string[]): Args {
  const args: Args = {
    label: `fc-${Date.now()}`,
    price: 200,
    charges: 3,
    auto: 1,
    runs: 800,
    workers: 4,
    timeout: 120,
    globalTimeout: 600,
    bots: BOT_NAMES,
    out: 'reports/forecast-autolab/raw',
    uiConsistency: 1,
    extra: '{}',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') args.label = argv[++i];
    else if (a === '--price') args.price = Number(argv[++i]);
    else if (a === '--charges') args.charges = Number(argv[++i]);
    else if (a === '--auto') args.auto = Number(argv[++i]);
    else if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--workers') args.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--timeout') args.timeout = Math.max(10, Number(argv[++i]));
    else if (a === '--globalTimeout') args.globalTimeout = Math.max(60, Number(argv[++i]));
    else if (a === '--bots') args.bots = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--uiConsistency') args.uiConsistency = Number(argv[++i]);
    else if (a === '--extra') args.extra = argv[++i];
    else throw new Error(`未知参数: ${a}`);
  }
  return args;
}

export function configFor(args: { price: number; charges: number; auto: number }, extra?: unknown): string {
  const base: Record<string, unknown> = {
    forecast: {
      packPrice: args.price,
      chargesPerPack: args.charges,
      autoUseOnPurchase: args.auto,
      maxDaysCost: 0,
    },
  };
  // 允许在预报标定之外再叠加其它只读参数（用于 Price × Charges 之外的对照实验）
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
      if (k === 'forecast' && v && typeof v === 'object') {
        base.forecast = { ...(base.forecast as object), ...(v as object) };
      } else {
        base[k] = v;
      }
    }
  }
  return JSON.stringify(base);
}

interface ChunkTask {
  bot: string;
  start: number;
  end: number;
  outFile: string;
}

interface ChunkOutcome {
  task: ChunkTask;
  ok: boolean;
  timedOut: boolean;
  ms: number;
  error?: string;
}

function runChunk(task: ChunkTask, config: string, timeoutMs: number): Promise<ChunkOutcome> {
  return new Promise((fulfil) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/sim-worker.ts',
        '--bot',
        task.bot,
        '--prefix',
        SEED_PREFIX,
        '--start',
        String(task.start),
        '--end',
        String(task.end),
        '--out',
        task.outFile,
        '--seedMode',
        'shared',
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, OASIS_CONFIG_OVERRIDE: config },
      },
    );
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      fulfil({ task, ok: false, timedOut: true, ms: Date.now() - t0, error: `分片看门狗超时 ${timeoutMs}ms，已 kill` });
    }, timeoutMs);
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) fulfil({ task, ok: true, timedOut: false, ms: Date.now() - t0 });
      else fulfil({ task, ok: false, timedOut: false, ms: Date.now() - t0, error: `退出码 ${code}: ${stderr.slice(-300)}` });
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fulfil({ task, ok: false, timedOut: false, ms: Date.now() - t0, error: String(e) });
    });
  });
}

export interface ForecastLabResult {
  label: string;
  timestamp: string;
  params: { packPrice: number; chargesPerPack: number; autoUseOnPurchase: number };
  runs: number;
  workers: number;
  bots: string[];
  durationMs: number;
  games: number;
  timeouts: number;
  errors: string[];
  summaries: BotSummary[];
  /** 与 NoForecastBot 的逐局配对对比（同一 Seed 同一世界） */
  paired: Record<string, { wins: number; losses: number; ties: number; avgDelta: number; n: number }>;
  score: ScoreBreakdown;
  uiConsistency: number;
}

export async function runForecastExperiment(args: Args): Promise<ForecastLabResult> {
  const bots = args.bots.map((n) => {
    const b = BOT_BY_NAME[n];
    if (!b) throw new Error(`未知 Bot: ${n}`);
    return b;
  });
  const config = configFor(args, JSON.parse(args.extra));

  const t0 = Date.now();
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const tmpDir = join(outDir, `.tmp-${args.label}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const chunksPerBot = Math.max(1, args.workers * 2);
  const tasks: ChunkTask[] = [];
  for (const bot of bots) {
    const per = Math.ceil(args.runs / chunksPerBot);
    for (let start = 0; start < args.runs; start += per) {
      const end = Math.min(args.runs, start + per);
      tasks.push({ bot: bot.name, start, end, outFile: join(tmpDir, `${bot.name}-${start}-${end}.json`) });
    }
  }

  let done = 0;
  let index = 0;
  let lastProgressAt = Date.now();
  const outcomes: ChunkOutcome[] = [];
  const errors: string[] = [];
  let globalAbort = false;

  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgressAt;
    if (idle > args.globalTimeout * 1000) {
      globalAbort = true;
      errors.push(`全局无进展看门狗触发：${Math.round(idle / 1000)}s 无分片完成，已标记中止`);
      clearInterval(watchdog);
    }
  }, 5000);

  async function runner(): Promise<void> {
    while (!globalAbort && index < tasks.length) {
      const task = tasks[index++];
      const o = await runChunk(task, config, args.timeout * 1000);
      outcomes.push(o);
      done++;
      lastProgressAt = Date.now();
      if (!o.ok) errors.push(`${task.bot}[${task.start},${task.end}): ${o.error}`);
      if (done % 10 === 0 || done === tasks.length) {
        process.stdout.write(`\r[${args.label}] ${done}/${tasks.length} 分片  `);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.workers, tasks.length) }, () => runner()));
  clearInterval(watchdog);
  process.stdout.write('\n');

  const timeouts = outcomes.filter((o) => o.timedOut).length;
  const okTasks = outcomes.filter((o) => o.ok);

  const byBot = new Map<string, RunResult[]>();
  for (const bot of bots) byBot.set(bot.name, []);
  for (const o of okTasks) {
    try {
      const chunk: RunResult[] = JSON.parse(readFileSync(o.task.outFile, 'utf-8'));
      byBot.get(o.task.bot)!.push(...chunk);
    } catch (e) {
      errors.push(`读取分片失败 ${o.task.outFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows 偶发 EPERM：分片已读入内存 */
  }

  const summaries = bots.map((b) => aggregateBot(byBot.get(b.name)!));

  // 配对对比：所有 Bot 跑的是同一批 Seed（同一张地图/同一套天气），
  // 因此逐局净收益差 = 纯 Bot 决策差，不含世界运气。
  const noneBySeed = new Map<string, number>();
  for (const r of byBot.get('NoForecastBot') ?? []) noneBySeed.set(r.seed, r.netProfit);
  const paired: ForecastLabResult['paired'] = {};
  for (const b of bots) {
    if (b.name === 'NoForecastBot') continue;
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let sum = 0;
    let n = 0;
    for (const r of byBot.get(b.name) ?? []) {
      const base = noneBySeed.get(r.seed);
      if (base === undefined) continue;
      n += 1;
      const d = r.netProfit - base;
      sum += d;
      if (d > 0) wins += 1;
      else if (d < 0) losses += 1;
      else ties += 1;
    }
    paired[b.name] = { wins, losses, ties, avgDelta: Math.round((n === 0 ? 0 : sum / n) * 100) / 100, n };
  }
  const summaryMap: Record<string, BotSummary> = Object.fromEntries(summaries.map((s) => [s.bot, s]));
  const score = forecastScore({
    runsPerBot: args.runs,
    summaries: summaryMap,
    uiConsistency: args.uiConsistency,
  });
  const games = summaries.reduce((a, s) => a + s.runs, 0);

  const result: ForecastLabResult = {
    label: args.label,
    timestamp: new Date().toISOString(),
    params: {
      packPrice: args.price,
      chargesPerPack: args.charges,
      autoUseOnPurchase: args.auto,
    },
    runs: args.runs,
    workers: args.workers,
    bots: bots.map((b) => b.name),
    durationMs: Date.now() - t0,
    games,
    timeouts,
    errors,
    summaries,
    paired,
    score,
    uiConsistency: args.uiConsistency,
  };
  writeFileSync(join(outDir, `${args.label}.json`), JSON.stringify(result, null, 2));

  const none = summaryMap['NoForecastBot'];
  const ada = summaryMap['AdaptiveForecastBot'];
  const abu = summaryMap['ForecastAbuserBot'];
  console.log(
    `[${args.label}] price=${args.price} charges=${args.charges} auto=${args.auto} | ${games} 局 / ${(result.durationMs / 1000).toFixed(1)}s`,
  );
  console.log(
    `  SCORE=${score.total} (noFc=${score.noForecastViability} div=${score.purchaseDiversity} evBal=${score.forecastEVBalance} decUtil=${score.decisionUtility} packUse=${score.packUsage} dmgEff=${score.damageEfficiency} abuse=-${score.abusePenalty} domOpen=-${score.dominantOpeningPenalty})`,
  );
  console.log(
    `  NoForecast   wr=${none.winRate}% EV=${none.evNetProfitAllRuns} endStam=${none.avgEndStamina}`,
  );
  console.log(
    `  Adaptive     wr=${ada.winRate}% EV=${ada.evNetProfitAllRuns} buy=${ada.forecast.purchaseRate}% packs=${ada.forecast.avgPacks} use=${ada.forecast.packUsageRate}% decUtil=${ada.forecast.decisionUtilityRate}%`,
  );
  console.log(
    `  Abuser       wr=${abu.winRate}% EV=${abu.evNetProfitAllRuns} buy=${abu.forecast.purchaseRate}% packs=${abu.forecast.avgPacks} spent=${abu.forecast.avgMoneySpent}`,
  );
  console.log(
    `  配对(vs NoForecast)：Light ${paired['LightForecastBot']?.wins}W/${paired['LightForecastBot']?.losses}L Δ${paired['LightForecastBot']?.avgDelta} | Adaptive ${paired['AdaptiveForecastBot']?.wins}W/${paired['AdaptiveForecastBot']?.losses}L Δ${paired['AdaptiveForecastBot']?.avgDelta} | Heavy ${paired['HeavyForecastBot']?.wins}W/${paired['HeavyForecastBot']?.losses}L Δ${paired['HeavyForecastBot']?.avgDelta} | Abuser ${paired['ForecastAbuserBot']?.wins}W/${paired['ForecastAbuserBot']?.losses}L Δ${paired['ForecastAbuserBot']?.avgDelta}`,
  );
  for (const n of score.notes) console.log(`  · ${n}`);
  if (errors.length > 0) {
    console.log(`  ! 错误 ${errors.length} 条：`);
    for (const e of errors.slice(0, 6)) console.log(`    - ${e}`);
  }

  void mergeWithOverride; // 保留给上层报告写"本次真正生效的配置"
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await runForecastExperiment(args);
}

// 仅在直接执行时跑 main（被 import 时不自动执行）
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/forecast-lab/lab.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
