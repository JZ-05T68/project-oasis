/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 实验驱动器。
 *
 * 与 mechanism-lab/runLab.ts 同构（沿用其已验证的分片/自愈/断点续跑设计），
 * 差异：
 *   - 候选注册表来自 outcomeMechs.ts；
 *   - 指标来自 outcomeAnalyze.ts（Completion / Profitability 双目标 + 新机制痕迹）；
 *   - 输出到 reports/outcome-mechanism-lab/raw/sweep-<tag>.jsonl。
 *
 * 用法：
 *   npx tsx scripts/mechanism-lab/runOutcomeLab.ts --tag phaseA \
 *     --variants BASE,E1,G1,H1 --bots OutcomeMasterBot,OutcomeBlindBot --seeds 500 --workers 4
 *
 * 安全约束（沿用 v0.1.4 实测结论）：
 *   - workers ≤ 4；分片看门狗 120s；超时自动二分重试；全局 10min 无进展看门狗；
 *   - 全部候选 / 全部 Bot 共用同一批 Seed（outcome:<i>）→ 逐局配对成立；
 *   - 断点续跑：raw/sweep-<tag>.jsonl 每行一个 (variant,bot)，已完成跳过。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { aggregateBot, type RunResult } from '../../src/simulation/metrics';
import {
  computeOutcomeMetrics,
  indexBySeed,
  outcomePairedDelta,
  type OutcomeMetrics,
  type OutcomePairedDelta,
} from './outcomeAnalyze';
import {
  OUTCOME_VARIANT_BY_ID,
  registerParamPoints,
  rescueGrid,
  rescueWideGrid,
  surgeGrid,
  villageGrid,
  intelGrid,
  comboGrid,
  ehCombo,
} from './outcomeMechs';

export const LAB_DIR = 'reports/outcome-mechanism-lab';
export const SEED_PREFIX = 'outcome';

/**
 * 每分片最大局数。
 * v0.1.4 实测：机制 Bot 约 85 ms/局、基线约 49 ms/局。
 * v0.2.0 的 Bot 多了一层机制分支，实测约 95 ms/局（见 harness 报告），
 * 因此 800 局 ≈ 76s，配合 200s 看门狗可稳定通过。
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
  extra: string;
  dryRun: boolean;
  grid: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = {
    tag: `run-${Date.now()}`,
    variants: ['BASE'],
    bots: ['OutcomeMasterBot'],
    seeds: 500,
    workers: 4,
    timeout: 120,
    globalTimeout: 600,
    base: 'BASE',
    extra: '{}',
    dryRun: false,
    grid: false,
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
    else if (k === '--extra') a.extra = argv[++i];
    else if (k === '--dryRun') a.dryRun = true;
    else if (k === '--grid') a.grid = true;
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

function slim(r: RunResult): RunResult {
  return { ...r, nodeVisits: {}, edgeUses: {}, events: [] };
}

export interface OutcomeSweepRow {
  tag: string;
  variant: string;
  bot: string;
  seeds: number;
  runs: number;
  errors: number;
  summary: ReturnType<typeof aggregateBot>;
  metrics: OutcomeMetrics;
  paired: OutcomePairedDelta;
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
        '--import', 'tsx', 'scripts/mechanism-lab/outcomeWorker.ts',
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
          if (doneChunks % 2 === 0) process.stdout.write(`\r    · 分片 ${doneChunks}/${plan.length} 完成  `);
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
      const o = JSON.parse(line) as OutcomeSweepRow;
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

export function readRows(file: string): OutcomeSweepRow[] {
  if (!existsSync(file)) return [];
  const out: OutcomeSweepRow[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as OutcomeSweepRow); } catch { /* skip */ }
  }
  return out;
}

export function appendLog(path: string, text: string): void {
  mkdirSync(resolve(LAB_DIR), { recursive: true });
  appendFileSync(resolve(path), text.endsWith('\n') ? text : text + '\n', 'utf-8');
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));

  /* --grid：把 Phase B 参数网格注册成候选（与锦标赛共用同一套装置） */
  if (args.grid) {
    const all = [...surgeGrid(), ...rescueGrid(), ...rescueWideGrid(), ...villageGrid(), ...intelGrid(), ...comboGrid(), ehCombo()];
    registerParamPoints(all);
    if (args.variants.length === 1 && args.variants[0] === 'BASE') args.variants = all.map((p) => p.id);
    else args.variants = args.variants.filter((v) => v !== 'BASE').concat();
    console.log(`[--grid] 注册参数点 ${all.length} 个，本次跑 ${args.variants.length} 个`);
  }

  const outDir = resolve(LAB_DIR, 'raw');
  mkdirSync(outDir, { recursive: true });
  const jsonl = join(outDir, `sweep-${args.tag}.jsonl`);
  const tmpDir = join(outDir, `.tmp-${args.tag}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  for (const b of args.bots) if (!BOT_BY_NAME[b]) throw new Error(`未知 Bot: ${b}`);
  for (const v of args.variants) if (!OUTCOME_VARIANT_BY_ID[v]) throw new Error(`未知候选: ${v}`);

  const done = loadDone(jsonl);
  console.log(`[${args.tag}] ${args.variants.length} 候选 × ${args.bots.length} Bot × ${args.seeds} 局 = ${args.variants.length * args.bots.length * args.seeds} 局`);
  if (args.dryRun) return;

  let aborted = false;
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgressAt;
    if (idle > args.globalTimeout * 1000) {
      aborted = true;
      appendLog(`${LAB_DIR}/experiment-log.md`, `- ⚠️ ${new Date().toISOString()} 全局无进展看门狗触发（${Math.round(idle / 1000)}s）`);
      clearInterval(watchdog);
    }
  }, 5000);

  const degrade: string[] = [];
  const extra = JSON.parse(args.extra) as Record<string, unknown>;
  const baseCache = new Map<string, Map<string, RunResult>>();

  /* ---------- baseline 逐局投影 ---------- */
  const baseNeeded = args.bots.filter((b) => !existsSync(join(outDir, `base-${args.tag}-${args.seeds}-${b}.json`)));
  if (baseNeeded.length > 0) {
    console.log(`  · 跑 baseline（${baseNeeded.length} 个 Bot 无缓存）`);
    const t0 = Date.now();
    const res = await runVariant(args, mergeOverride(JSON.stringify(OUTCOME_VARIANT_BY_ID[args.base].patch), extra), baseNeeded, tmpDir, degrade);
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
  // 写 baseline 行
  for (const bot of args.bots) {
    if (done.has(`${args.base}|${bot}|${args.seeds}`)) continue;
    const cache = baseCache.get(bot);
    if (!cache) continue;
    const rs = [...cache.values()];
    const summary = aggregateBot(rs);
    const row: OutcomeSweepRow = {
      tag: args.tag, variant: args.base, bot, seeds: args.seeds, runs: rs.length,
      errors: summary.errors, summary, metrics: computeOutcomeMetrics(args.base, rs, cache),
      paired: outcomePairedDelta(rs, cache), override: JSON.stringify(OUTCOME_VARIANT_BY_ID[args.base].patch), ms: 0,
    };
    appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
    done.add(`${args.base}|${bot}|${args.seeds}`);
  }

  /* ---------- 逐候选 ---------- */
  for (const variant of args.variants) {
    if (aborted) break;
    const pendingBots = args.bots.filter((b) => !done.has(`${variant}|${b}|${args.seeds}`));
    if (pendingBots.length === 0) {
      console.log(`  · ${variant} 已完成，跳过`);
      continue;
    }
    const override = mergeOverride(JSON.stringify(OUTCOME_VARIANT_BY_ID[variant].patch), extra);
    const t0 = Date.now();
    console.log(`  → ${variant}（${pendingBots.length} Bot × ${args.seeds} 局）`);
    const res = await runVariant(args, override, pendingBots, tmpDir, degrade);
    for (const bot of pendingBots) {
      const rs = res[bot] ?? [];
      const base = baseCache.get(bot);
      const summary = aggregateBot(rs);
      const metrics = computeOutcomeMetrics(variant, rs, base && base.size > 0 ? base : null);
      const row: OutcomeSweepRow = {
        tag: args.tag, variant, bot, seeds: args.seeds, runs: rs.length,
        errors: summary.errors, summary, metrics,
        paired: base && base.size > 0 ? outcomePairedDelta(rs, base) : { n: 0, completionUp: 0, completionDown: 0, avgProfitDelta: 0, completionDelta: 0, profitableDelta: 0 },
        override, ms: Date.now() - t0,
      };
      appendFileSync(jsonl, JSON.stringify(row) + '\n', 'utf-8');
      const o = metrics.outcome;
      console.log(
        `    ✓ ${bot} comp=${o.completionRate}% prof=${o.profitableRate}% (amongComp=${o.profitAmongCompleted}%) ` +
        `EV=${summary.evNetProfitAllRuns} Δdec=${metrics.dc.overall}% Δmech=${metrics.dc.newMechanism}% ` +
        `stamina=${metrics.staminaDeathRate}% topFail=${metrics.topFailureReason}:${metrics.topFailureShare}%`,
      );
    }
    console.log(`  ✓ ${variant} 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  clearInterval(watchdog);
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EPERM */ }
  if (degrade.length > 0) {
    appendLog(`${LAB_DIR}/experiment-log.md`, `\n### 自愈事件（${args.tag}）\n` + degrade.map((e) => `- ${e}`).join('\n'));
  }
  console.log(`\n结果：${jsonl}`);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/mechanism-lab/runOutcomeLab.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  });
}
