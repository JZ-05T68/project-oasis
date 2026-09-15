/**
 * v0.3.0 Economic Independence Lab —— 实验驱动器。
 *
 * 沿用 mechanism-lab/runOutcomeLab.ts 已验证的分片/自愈/断点续跑设计：
 *   - workers ≤ 4（§56）；分片看门狗 120s；超时自动二分重试；全局 10min 无进展看门狗；
 *   - 全部候选 / 全部 Bot 共用同一批 Seed → 逐局配对成立（§31/§35）；
 *   - 断点续跑：raw/sweep-<tag>.jsonl 每行一个 (variant,bot)，已完成跳过（§57）；
 *   - append-only 原始结果，中断后从 checkpoint 继续。
 *
 * Seed 空间分三段（§38/§39）：
 *   econ-train      —— 参数搜索用
 *   econ-validation —— 参数确认用
 *   econ-holdout    —— 最终报告用，**在 Phase D 之前任何搜索脚本禁止读取**
 *
 * 用法：
 *   npx tsx scripts/economy-lab/runEconLab.ts --tag phaseA \
 *     --variants BASE,A1-D1600,B2-F20R60 --bots EconMasterBot --seeds 800 --workers 4
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { aggregateBot, type RunResult } from '../../src/simulation/metrics';
import { computeEconMetrics, indexBySeed, type EconMetrics } from './econAnalyze';
import { econScore } from './econScore';
import {
  ECON_VARIANT_BY_ID,
  registerPoints,
  combo,
  debtGrid,
  shareGrid,
  hybridGrid,
  perDayGrid,
  overtimeGrid,
  miningDayGrid,
  tradeGrid,
  lateSaleGrid,
  comboGrid,
  tentGrid,
  tentComboGrid,
  rescueDeferred,
  rescueShare,
  upkeepOvertime,
  upkeepMining,
  upkeepPerDay,
  lateSale,
  merge,
  type ParamPoint,
} from './econMechs';

export const LAB_DIR = 'reports/economic-independence-lab';
export const SEED_PREFIX = 'econ-train';

/** 每分片最大局数：Bot 实测 ~50~95 ms/局，800 局 × 4 workers 稳定不撞看门狗 */
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
  prefix: string;
  dryRun: boolean;
  grid: string;
}

function parse(argv: string[]): Args {
  const a: Args = {
    tag: `run-${Date.now()}`,
    variants: ['BASE'],
    bots: ['EconMasterBot'],
    seeds: 500,
    workers: 4,
    timeout: 150,
    globalTimeout: 900,
    base: 'BASE',
    prefix: SEED_PREFIX,
    dryRun: false,
    grid: '',
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
    else if (k === '--prefix') a.prefix = argv[++i];
    else if (k === '--dryRun') a.dryRun = true;
    else if (k === '--grid') a.grid = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

function slim(r: RunResult): RunResult {
  return { ...r, nodeVisits: {}, edgeUses: {}, events: [] };
}

export interface EconSweepRow {
  tag: string;
  prefix: string;
  variant: string;
  bot: string;
  seeds: number;
  runs: number;
  errors: number;
  summary: ReturnType<typeof aggregateBot>;
  metrics: EconMetrics;
  score: ReturnType<typeof econScore>;
  override: string;
  ms: number;
}

interface ChunkOutcome {
  ok: boolean;
  ms: number;
  error?: string;
  data: Record<string, RunResult[]>;
}

let lastProgressAt = Date.now();

function spawnChunk(
  override: string,
  bots: string[],
  prefix: string,
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
        '--prefix', prefix,
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
      fulfil({ ok: false, ms: Date.now() - t0, error: `看门狗 ${timeoutMs}ms 超时，已 kill`, data: {} });
    }, timeoutMs);
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        fulfil({ ok: false, ms: Date.now() - t0, error: `退出码 ${code}: ${stderr.slice(-240)}`, data: {} });
        return;
      }
      try {
        const raw = JSON.parse(readFileSync(outFile, 'utf-8')) as Record<string, RunResult[]>;
        const slimmed: Record<string, RunResult[]> = {};
        for (const [k, v] of Object.entries(raw)) slimmed[k] = v.map(slim);
        fulfil({ ok: true, ms: Date.now() - t0, data: slimmed });
      } catch (e) {
        fulfil({ ok: false, ms: Date.now() - t0, error: `读取分片失败: ${String(e)}`, data: {} });
      }
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fulfil({ ok: false, ms: Date.now() - t0, error: String(e), data: {} });
    });
  });
}

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
        const o = await spawnChunk(override, bots, args.prefix, s, e, f, args.timeout * 1000);
        if (o.ok) {
          for (const [b, rs] of Object.entries(o.data)) collected[b].push(...rs);
          lastProgressAt = Date.now();
          doneChunks += 1;
          if (doneChunks % 4 === 0) process.stdout.write(`\r    · 分片 ${doneChunks}/${plan.length} 完成  `);
        } else {
          failed.push([s, e]);
          degrade.push(`${new Date().toISOString()} [${s},${e}) 分片失败：${o.error}`);
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
      const o = JSON.parse(line) as EconSweepRow;
      done.add(`${o.variant}|${o.bot}|${o.runs}|${o.prefix}`);
    } catch { /* 跳过坏行 */ }
  }
  return done;
}

export function readRows(file: string): EconSweepRow[] {
  if (!existsSync(file)) return [];
  const out: EconSweepRow[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as EconSweepRow); } catch { /* skip */ }
  }
  return out;
}

export function appendLog(text: string): void {
  mkdirSync(resolve(LAB_DIR), { recursive: true });
  appendFileSync(resolve(LAB_DIR, 'experiment-log.md'), text.endsWith('\n') ? text : text + '\n', 'utf-8');
}

function buildGrid(kind: string): ParamPoint[] {
  if (kind === 'all') {
    return [...debtGrid(), ...shareGrid(), ...hybridGrid(), ...perDayGrid(), ...overtimeGrid(), ...miningDayGrid(), ...tradeGrid(), ...lateSaleGrid(), ...comboGrid(), ...tentGrid(), ...tentComboGrid()];
  }
  if (kind === "combo") return comboGrid();
  if (kind === "tent") return [...tentGrid(), ...tentComboGrid()];
  switch (kind) {
    case 'debt': return debtGrid();
    case 'share': return shareGrid();
    case 'hybrid': return hybridGrid();
    case 'perDay': return perDayGrid();
    case 'overtime': return overtimeGrid();
    case 'miningDay': return miningDayGrid();
    case 'trade': return tradeGrid();
    case 'late': return lateSaleGrid();
    default: throw new Error(`未知网格: ${kind}`);
  }
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));

  if (args.grid) {
    const all = buildGrid(args.grid);
    registerPoints(all);
    if (args.variants.length === 1 && args.variants[0] === 'BASE') args.variants = all.map((p) => p.id);
    console.log(`[--grid ${args.grid}] 参数点 ${all.length} 个，本次跑 ${args.variants.length} 个`);
  }

  const outDir = resolve(LAB_DIR, 'raw');
  mkdirSync(outDir, { recursive: true });
  const jsonl = join(outDir, `sweep-${args.tag}.jsonl`);
  const tmpDir = join(outDir, `.tmp-${args.tag}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  for (const b of args.bots) if (!BOT_BY_NAME[b]) throw new Error(`未知 Bot: ${b}`);
  for (const v of args.variants) if (!ECON_VARIANT_BY_ID[v]) throw new Error(`未知候选: ${v}`);

  const done = loadDone(jsonl);
  console.log(
    `[${args.tag}] prefix=${args.prefix} ${args.variants.length} 候选 × ${args.bots.length} Bot × ${args.seeds} 局 = ` +
    `${args.variants.length * args.bots.length * args.seeds} 局`,
  );
  if (args.dryRun) return;

  let aborted = false;
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgressAt;
    if (idle > args.globalTimeout * 1000) {
      aborted = true;
      appendLog(`- ⚠️ ${new Date().toISOString()} 全局无进展看门狗触发（${Math.round(idle / 1000)}s），tag=${args.tag}`);
      clearInterval(watchdog);
    }
  }, 5000);

  const degrade: string[] = [];
  const baseCache = new Map<string, Map<string, RunResult>>();

  /* ---------- baseline ---------- */
  const keyBase = (bot: string) => join(outDir, `base-${args.tag}-${args.prefix}-${args.seeds}-${bot}.json`);
  const baseNeeded = args.bots.filter((b) => !existsSync(keyBase(b)));
  if (baseNeeded.length > 0) {
    console.log(`  · 跑 baseline（${baseNeeded.length} 个 Bot 无缓存）`);
    const t0 = Date.now();
    const res = await runVariant(args, JSON.stringify(ECON_VARIANT_BY_ID[args.base].patch), baseNeeded, tmpDir, degrade);
    for (const bot of baseNeeded) writeFileSync(keyBase(bot), JSON.stringify(res[bot] ?? []));
    console.log(`  ✓ baseline 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  for (const bot of args.bots) {
    const f = keyBase(bot);
    if (!existsSync(f)) continue;
    const rs = (JSON.parse(readFileSync(f, 'utf-8')) as RunResult[]).map(slim);
    baseCache.set(bot, indexBySeed(rs));
  }
  for (const bot of args.bots) {
    if (done.has(`${args.base}|${bot}|${args.seeds}|${args.prefix}`)) continue;
    const cache = baseCache.get(bot);
    if (!cache) continue;
    const rs = [...cache.values()];
    const metrics = computeEconMetrics(args.base, rs, cache);
    const row: EconSweepRow = {
      tag: args.tag, prefix: args.prefix, variant: args.base, bot, seeds: args.seeds, runs: rs.length,
      errors: aggregateBot(rs).errors, summary: aggregateBot(rs), metrics,
      score: econScore(metrics), override: '{}', ms: 0,
    };
    appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
    done.add(`${args.base}|${bot}|${args.seeds}|${args.prefix}`);
    printRow(row);
  }

  /* ---------- 逐候选 ---------- */
  for (const variant of args.variants) {
    if (aborted) break;
    const pendingBots = args.bots.filter((b) => !done.has(`${variant}|${b}|${args.seeds}|${args.prefix}`));
    if (pendingBots.length === 0) {
      console.log(`  · ${variant} 已完成，跳过`);
      continue;
    }
    const override = JSON.stringify(ECON_VARIANT_BY_ID[variant].patch);
    const t0 = Date.now();
    const res = await runVariant(args, override, pendingBots, tmpDir, degrade);
    for (const bot of pendingBots) {
      const rs = res[bot] ?? [];
      const base = baseCache.get(bot) ?? null;
      const metrics = computeEconMetrics(variant, rs, base && base.size > 0 ? base : null);
      const row: EconSweepRow = {
        tag: args.tag, prefix: args.prefix, variant, bot, seeds: args.seeds, runs: rs.length,
        errors: aggregateBot(rs).errors, summary: aggregateBot(rs), metrics,
        score: econScore(metrics), override, ms: Date.now() - t0,
      };
      appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
      printRow(row);
    }
    console.log(`  ✓ ${variant} 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  clearInterval(watchdog);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM */ }
  if (degrade.length > 0) {
    appendLog(`\n### 自愈事件（${args.tag}）\n` + degrade.map((e) => `- ${e}`).join('\n'));
  }
  console.log(`\n结果：${jsonl}`);
}

function printRow(row: EconSweepRow): void {
  const m = row.metrics;
  console.log(
    `    ${row.variant.padEnd(14)} ${row.bot.padEnd(20)} comp=${String(m.completionRate).padStart(5)}% ` +
    `prof=${String(m.profitableRate).padStart(5)}% pac=${String(m.profitAmongCompleted).padStart(5)}% ` +
    `loss=${String(m.overallCompletedLossShare).padStart(5)}% gap=${String(m.gapPP).padStart(5)} ` +
    `resc=${String(m.rescue.useRate).padStart(5)}% Δdec=${String(m.dc.overall).padStart(5)}% ` +
    `EV=${String(row.summary.evNetProfitAllRuns).padStart(5)} score=${row.score.score}${row.score.rejected ? ' ✗' : ''}`,
  );
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/economy-lab/runEconLab.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  });
}

export { rescueDeferred, rescueShare, upkeepOvertime, upkeepMining, upkeepPerDay, lateSale, merge, combo };
