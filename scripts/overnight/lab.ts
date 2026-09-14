/**
 * 过夜自动平衡实验驱动器（无人值守安全版）。
 *
 * 用法：
 *   npx tsx scripts/overnight/lab.ts \
 *     --label exp-001 \
 *     --config '{"startCash":1800}' \
 *     --runs 1000 --workers 4 --timeout 120 \
 *     --out reports/overnight-balance/raw
 *
 * 安全约束（来自 2026-09-14 过夜实验规则）：
 *  - 默认 workers = 4（8 路曾出现子进程不退出）；
 *  - 每个分片 120s 看门狗，超时即 kill 并记录，不允许单个 worker 卡死整个任务；
 *  - 全局 10 分钟无进展看门狗：无任何分片完成/日志即视为异常并中止；
 *  - 参数只通过 OASIS_CONFIG_OVERRIDE 注入，不改源码、不改机制。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALL_BOTS, BOT_BY_NAME } from '../../src/simulation/bots';
import { aggregateBot, type BotSummary, type RunResult } from '../../src/simulation/metrics';
import { gameConfig, mergeWithOverride } from '../../src/game/config/gameConfig';
import { balanceScore, SCORE_WEIGHTS, type ScoreBreakdown } from './score';

interface Args {
  label: string;
  config: string;
  runs: number;
  workers: number;
  timeout: number;
  globalTimeout: number;
  bots: string[];
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    label: `exp-${Date.now()}`,
    config: '{}',
    runs: 1000,
    workers: 4,
    timeout: 120,
    globalTimeout: 600,
    bots: ALL_BOTS.map((b) => b.name),
    out: 'reports/overnight-balance/raw',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') args.label = argv[++i];
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--workers') args.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--timeout') args.timeout = Math.max(10, Number(argv[++i]));
    else if (a === '--globalTimeout') args.globalTimeout = Math.max(60, Number(argv[++i]));
    else if (a === '--bots') args.bots = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`未知参数: ${a}`);
  }
  return args;
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
        '--import', 'tsx',
        'scripts/sim-worker.ts',
        '--bot', task.bot,
        '--prefix', task.bot,
        '--start', String(task.start),
        '--end', String(task.end),
        '--out', task.outFile,
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

export interface LabResult {
  label: string;
  timestamp: string;
  configOverride: unknown;
  effectiveConfig: unknown;
  runs: number;
  workers: number;
  bots: string[];
  durationMs: number;
  games: number;
  timeouts: number;
  errors: string[];
  summaries: BotSummary[];
  score: ScoreBreakdown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bots = args.bots.map((n) => {
    const b = BOT_BY_NAME[n];
    if (!b) throw new Error(`未知 Bot: ${n}`);
    return b;
  });

  const t0 = Date.now();
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const tmpDir = join(outDir, `.tmp-${args.label}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // 分片：每 bot 切成 workers*2 份，单份更小 → 看门狗更容易切出进展
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

  // 全局无进展看门狗
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
      const o = await runChunk(task, args.config, args.timeout * 1000);
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
    /* Windows 上偶发 EPERM：分片已读入内存，清理失败不影响结果 */
  }

  const summaries = bots.map((b) => aggregateBot(byBot.get(b.name)!));
  const overrideObj = JSON.parse(args.config);
  const principal = (overrideObj as { startCash?: number }).startCash ?? gameConfig.startCash;
  const score = balanceScore(summaries, principal);
  const eff = mergeWithOverride(overrideObj);
  const games = summaries.reduce((a, s) => a + s.runs, 0);

  const result: LabResult = {
    label: args.label,
    timestamp: new Date().toISOString(),
    configOverride: overrideObj,
    effectiveConfig: {
      startCash: eff.startCash,
      maxDays: eff.maxDays,
      startStamina: eff.startStamina,
      maxStamina: eff.maxStamina,
      tentPrice: eff.tentPrice,
      tentDesertCharges: eff.tentDesertCharges,
      compassPrice: eff.compassPrice,
      grassRainStaminaLoss: eff.weather.grassRain.staminaLossWithoutTent,
      sandstormStaminaCost: eff.weather.sandstorm.staminaCost,
      heatStaminaCost: eff.weather.heat.staminaCost,
      encounterBaseProbability: eff.encounter.baseProbability,
      terrainProbability: eff.terrainProbability,
      oasisDroughtChance: eff.oasisDroughtChance,
      gemPerMiningDay: eff.gemPerMiningDay,
      mineValuation: eff.mineValuation,
      forecastChargesPerPack: eff.forecast.chargesPerPack,
      mineBottomForbiddenRows: eff.map.mineBottomForbiddenRows,
      mineMinRowGap: eff.map.mineMinRowGap,
    },
    runs: args.runs,
    workers: args.workers,
    bots: bots.map((b) => b.name),
    durationMs: Date.now() - t0,
    games,
    timeouts,
    errors,
    summaries,
    score,
  };
  writeFileSync(join(outDir, `${args.label}.json`), JSON.stringify(result, null, 2));

  console.log(
    `\n[${args.label}] 完成：${games} 局 / ${(result.durationMs / 1000).toFixed(1)}s / score=${score.total} / timeouts=${timeouts} / errors=${errors.length}`,
  );
  console.log(
    `  分量: viability=${score.reasonableViability} diversity=${score.strategyDiversity} econ=${score.economicHealth} resource=${score.resourceRelevance} failure=${score.failureDiversity} mine=${score.mineChoiceBalance} penalty=-${score.exploitPenalty}`,
  );
  for (const n of score.notes) console.log(`  · ${n}`);
  if (errors.length > 0) {
    console.log(`  ! 错误 ${errors.length} 条：`);
    for (const e of errors.slice(0, 10)) console.log(`    - ${e}`);
  }
  console.log(`  权重（用于报告公示）: ${JSON.stringify(SCORE_WEIGHTS)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
