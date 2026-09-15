/**
 * Autonomous Mechanism Evolution Lab —— 实验驱动器。
 *
 * 用法：
 *   npx tsx scripts/mechanism-lab/runLab.ts --tag phaseA --variants BASE,M01,... \
 *     --bots AdaptiveMinerBot,... --seeds 500 --workers 4
 *
 * 安全与可复现约束：
 *   - workers ≤ 4（8 路会挂）；每分片 120s 看门狗，超时 kill → 记日志 → **自动二分重试**；全局 10 分钟无进展看门狗；
 *   - 所有候选 / 所有 Bot 共用同一批 Seed（`mechlab:<i>`）→ 逐局配对比较成立；
 *   - 断点续跑：`raw/sweep-<tag>.jsonl` 每行一个 (variant,bot)，已完成的直接跳过；
 *     baseline 逐局投影单独缓存在 `raw/base-<tag>-<seeds>-<bot>.json`。
 *
 * 吞吐设计（重要）：每个分片进程内部跑**同一机制下的全部 Bot**（见 multiWorker.ts），
 * 避免 tsx 启动开销（2~4s）被几十局的小分片放大成主要成本。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { aggregateBot, type RunResult } from '../../src/simulation/metrics';
import { computeMetrics, indexBySeed, pairedDelta, type MechMetrics } from './analyze';
import { overrideFor, VARIANT_BY_ID } from './mechs';

export const LAB_DIR = 'reports/mechanism-autolab';
export const SEED_PREFIX = 'mechlab';

/**
 * 单个分片进程允许跑的最大局数。
 * 实测：机制 Bot 约 85 ms/局、基线 Bot 约 49 ms/局（本机 28 逻辑核）。
 * 800 局 ≈ 60~70s，配合 200s 看门狗可稳定通过（3000 局会稳定触发看门狗并引发级联二分）。
 */
const MAX_GAMES_PER_CHUNK = 800;

interface Args {
  tag: string;
  variants: string[];
  bots: string[];
  seeds: number;
  workers: number;
  timeout: number;
  globalTimeout: number;
  base: string;
  log: string;
  extra: string;
  dryRun: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = {
    tag: `run-${Date.now()}`,
    variants: ['BASE'],
    bots: ['ReasonablePlayerBot'],
    seeds: 500,
    workers: 4,
    timeout: 120,
    globalTimeout: 600,
    base: 'BASE',
    log: `${LAB_DIR}/experiment-log.md`,
    extra: '{}',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tag') a.tag = argv[++i];
    else if (k === '--variants') a.variants = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--bots') a.bots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--seeds') a.seeds = Number(argv[++i]);
    else if (k === '--workers') a.workers = Math.max(1, Math.min(4, Number(argv[++i])));
    else if (k === '--timeout') a.timeout = Math.max(30, Number(argv[++i]));
    else if (k === '--globalTimeout') a.globalTimeout = Math.max(60, Number(argv[++i]));
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--log') a.log = argv[++i];
    else if (k === '--extra') a.extra = argv[++i];
    else if (k === '--dryRun') a.dryRun = true;
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

export function appendLog(path: string, text: string): void {
  mkdirSync(resolve(LAB_DIR), { recursive: true });
  appendFileSync(resolve(path), text.endsWith('\n') ? text : text + '\n', 'utf-8');
}

/** 去掉大字段（aggregateBot / paired / metrics 都不需要），几十万局时这是内存能否扛住的关键 */
function slim(r: RunResult): RunResult {
  return { ...r, nodeVisits: {}, edgeUses: {}, events: [] };
}

interface SweepRow {
  tag: string;
  variant: string;
  bot: string;
  seeds: number;
  runs: number;
  errors: number;
  summary: ReturnType<typeof aggregateBot>;
  metrics: MechMetrics;
  paired: ReturnType<typeof pairedDelta>;
  override: string;
  ms: number;
}

interface ChunkOutcome {
  ok: boolean;
  timedOut: boolean;
  ms: number;
  error?: string;
  data: Record<string, RunResult[]>;
}

let lastProgressAt = Date.now();

function spawnChunk(
  override: string,
  bots: string[],
  start: number,
  end: number,
  outFile: string,
  timeoutMs: number,
): Promise<ChunkOutcome> {
  return new Promise((fulfil) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx', 'scripts/mechanism-lab/multiWorker.ts',
        '--bots', bots.join(','),
        '--prefix', SEED_PREFIX,
        '--start', String(start),
        '--end', String(end),
        '--out', outFile,
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OASIS_CONFIG_OVERRIDE: override } },
    );
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      fulfil({ ok: false, timedOut: true, ms: Date.now() - t0, error: `看门狗 ${timeoutMs}ms 超时，已 kill`, data: {} });
    }, timeoutMs);
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        fulfil({ ok: false, timedOut: false, ms: Date.now() - t0, error: `退出码 ${code}: ${stderr.slice(-240)}`, data: {} });
        return;
      }
      try {
        const raw = JSON.parse(readFileSync(outFile, 'utf-8')) as Record<string, RunResult[]>;
        const slimmed: Record<string, RunResult[]> = {};
        for (const [k, v] of Object.entries(raw)) slimmed[k] = v.map(slim);
        fulfil({ ok: true, timedOut: false, ms: Date.now() - t0, data: slimmed });
      } catch (e) {
        fulfil({ ok: false, timedOut: false, ms: Date.now() - t0, error: `读取分片失败: ${String(e)}`, data: {} });
      }
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fulfil({ ok: false, timedOut: false, ms: Date.now() - t0, error: String(e), data: {} });
    });
  });
}

/** 跑一个 (variant, bots[]) 的全部 Seed，返回 per-bot 结果；带自动二分恢复 */
async function runVariant(
  args: Args,
  override: string,
  bots: string[],
  tmpDir: string,
  degrade: string[],
): Promise<Record<string, RunResult[]>> {
  const perChunk = Math.max(1, Math.floor(MAX_GAMES_PER_CHUNK / Math.max(1, bots.length)));
  const collected: Record<string, RunResult[]> = {};
  for (const b of bots) collected[b] = [];
  let plan: Array<[number, number]> = [];
  for (let s = 0; s < args.seeds; s += perChunk) plan.push([s, Math.min(args.seeds, s + perChunk)]);

  let depth = 0;
  while (plan.length > 0 && depth <= 4) {
    const failed: Array<[number, number]> = [];
    let i = 0;
    let doneChunks = 0;
    const worker = async () => {
      while (i < plan.length) {
        const [s, e] = plan[i++];
        const f = join(tmpDir, `v-${s}-${e}-d${depth}.json`);
        const o = await spawnChunk(override, bots, s, e, f, args.timeout * 1000);
        if (o.ok) {
          for (const [b, rs] of Object.entries(o.data)) collected[b].push(...rs);
          lastProgressAt = Date.now();
          doneChunks += 1;
          if (doneChunks % 4 === 0) process.stdout.write(`\r    · 分片 ${doneChunks}/${plan.length} 完成  `);
        } else {
          failed.push([s, e]);
          degrade.push(
            `${new Date().toISOString()} [${s},${e}) 分片失败：${o.error}${o.timedOut ? '（看门狗：terminate → log → reduce batch → resume）' : ''}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(args.workers, plan.length) }, () => worker()));
    if (failed.length === 0) break;
    plan = [];
    for (const [s, e] of failed) {
      if (e - s <= 1) {
        degrade.push(`${new Date().toISOString()} [${s},${e}) 缩到单 Seed 仍失败，放弃该分片`);
        continue;
      }
      const mid = s + Math.floor((e - s) / 2);
      plan.push([s, mid], [mid, e]);
    }
    depth += 1;
  }
  process.stdout.write('\n');
  return collected;
}

function loadDone(file: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(file)) return done;
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as SweepRow;
      done.add(`${o.variant}|${o.bot}|${o.runs}`);
    } catch { /* 跳过坏行 */ }
  }
  return done;
}

function mergeOverride(a: string, extra: Record<string, unknown>): string {
  if (Object.keys(extra).length === 0) return a;
  const base = JSON.parse(a) as Record<string, unknown>;
  for (const [k, v] of Object.entries(extra)) {
    const prev = base[k];
    if (prev && typeof prev === 'object' && v && typeof v === 'object') base[k] = { ...(prev as object), ...(v as object) };
    else base[k] = v;
  }
  return JSON.stringify(base);
}

export function readRows(file: string): SweepRow[] {
  if (!existsSync(file)) return [];
  const out: SweepRow[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as SweepRow); } catch { /* skip */ }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const outDir = resolve(LAB_DIR, 'raw');
  mkdirSync(outDir, { recursive: true });
  const jsonl = join(outDir, `sweep-${args.tag}.jsonl`);
  const tmpDir = join(outDir, `.tmp-${args.tag}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  for (const b of args.bots) if (!BOT_BY_NAME[b]) throw new Error(`未知 Bot: ${b}`);
  for (const v of args.variants) if (!VARIANT_BY_ID[v]) throw new Error(`未知候选: ${v}`);

  const done = loadDone(jsonl);
  const totalGames = args.variants.length * args.bots.length * args.seeds;
  console.log(
    `[${args.tag}] ${args.variants.length} 候选 × ${args.bots.length} Bot × ${args.seeds} 局 = ${totalGames} 局`,
  );
  if (args.dryRun) return;

  let aborted = false;
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgressAt;
    if (idle > args.globalTimeout * 1000) {
      aborted = true;
      appendLog(args.log, `- ⚠️ ${new Date().toISOString()} 全局无进展看门狗触发（${Math.round(idle / 1000)}s），中止剩余任务`);
      clearInterval(watchdog);
    }
  }, 5000);

  const degrade: string[] = [];
  const extra = JSON.parse(args.extra) as Record<string, unknown>;
  const baseCache = new Map<string, Map<string, RunResult>>();

  /* ---------- baseline 逐局投影（配对比较的分母），可复用缓存 ---------- */
  const writeBaseRows = (bots: string[], results: Record<string, RunResult[]>, override: string) => {
    for (const bot of bots) {
      if (done.has(`${args.base}|${bot}|${args.seeds}`)) continue;
      const rs = results[bot] ?? [];
      const summary = aggregateBot(rs);
      const metrics = computeMetrics(args.base, rs, baseCache.get(bot)!);
      const row: SweepRow = {
        tag: args.tag, variant: args.base, bot, seeds: args.seeds, runs: rs.length,
        errors: summary.errors, summary, metrics, paired: pairedDelta(rs, baseCache.get(bot)!),
        override, ms: 0,
      };
      appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
      done.add(`${args.base}|${bot}|${args.seeds}`);
    }
  };

  const baseNeeded = args.bots.filter((b) => !existsSync(join(outDir, `base-${args.tag}-${args.seeds}-${b}.json`)));
  if (baseNeeded.length > 0) {
    console.log(`  · 跑 baseline（${baseNeeded.length} 个 Bot 无缓存）`);
    const t0 = Date.now();
    const res = await runVariant(args, mergeOverride(overrideFor(args.base), extra), baseNeeded, tmpDir, degrade);
    for (const bot of baseNeeded) {
      writeFileSync(join(outDir, `base-${args.tag}-${args.seeds}-${bot}.json`), JSON.stringify(res[bot] ?? []));
    }
    console.log(`  ✓ baseline 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  for (const bot of args.bots) {
    const f = join(outDir, `base-${args.tag}-${args.seeds}-${bot}.json`);
    if (!existsSync(f)) continue;
    const rs = (JSON.parse(readFileSync(f, 'utf-8')) as RunResult[]).map(slim);
    baseCache.set(bot, indexBySeed(rs));
  }
  writeBaseRows(args.bots, Object.fromEntries([...baseCache].map(([b, m]) => [b, [...m.values()]])), overrideFor(args.base));

  /* ---------- 逐候选 ---------- */
  for (const variant of args.variants) {
    if (aborted) break;
    const pendingBots = args.bots.filter((b) => !done.has(`${variant}|${b}|${args.seeds}`));
    if (pendingBots.length === 0) {
      console.log(`  · ${variant} 已完成，跳过`);
      continue;
    }
    const override = mergeOverride(overrideFor(variant), extra);
    const t0 = Date.now();
    console.log(`  → ${variant}（${pendingBots.length} Bot × ${args.seeds} 局）`);
    const res = await runVariant(args, override, pendingBots, tmpDir, degrade);
    for (const bot of pendingBots) {
      const rs = res[bot] ?? [];
      const base = baseCache.get(bot);
      const summary = aggregateBot(rs);
      const metrics = computeMetrics(variant, rs, base && base.size > 0 ? base : null);
      const row: SweepRow = {
        tag: args.tag, variant, bot, seeds: args.seeds, runs: rs.length,
        errors: summary.errors, summary, metrics,
        paired: base && base.size > 0 ? pairedDelta(rs, base) : { n: 0, wins: 0, losses: 0, ties: 0, avgDelta: 0, winUp: 0, winDown: 0, pWin: 0 },
        override, ms: Date.now() - t0,
      };
      appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
      console.log(
        `    ✓ ${bot} wr=${summary.winRate}% EV=${summary.evNetProfitAllRuns} mine=${metrics.avgMiningDays}d ` +
        `Δmine=${metrics.dc.mining}% Δroute=${metrics.dc.returnRoute}% drop=${metrics.dropRate}% stam=${metrics.staminaDeathRate}% to=${metrics.timeoutRate}%`,
      );
    }
    console.log(`  ✓ ${variant} 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  clearInterval(watchdog);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM */ }

  if (degrade.length > 0) {
    appendLog(args.log, `\n### 自愈事件（${args.tag}）\n` + degrade.map((e) => `- ${e}`).join('\n'));
  }
  console.log(`\n结果：${jsonl}`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/mechanism-lab/runLab.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  });
}
