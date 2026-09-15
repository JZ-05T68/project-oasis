/**
 * Shadow-Lab 编排器（Phase 3：机制影子实验）。
 *
 *   npx tsx scripts/shadow-lab/runShadow.ts --exp mineinfo --seeds 1200 --workers 4
 *   npx tsx scripts/shadow-lab/runShadow.ts --exp returnload --seeds 1200 --workers 4
 *
 * 输出：reports/forecast-autolab/shadow-<exp>.md + raw/shadow-<exp>.json
 * 严格只做模拟研究，不写任何正式机制。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aggregateBot, type RunResult } from '../../src/simulation/metrics';
import { trueMinePrices } from './shadowRunner';

interface Args {
  exp: 'mineinfo' | 'returnload';
  seeds: number;
  workers: number;
  out: string;
  timeout: number;
}

function parse(argv: string[]): Args {
  const a: Args = { exp: 'mineinfo', seeds: 1200, workers: 4, out: 'reports/forecast-autolab', timeout: 180 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--exp') a.exp = argv[++i] as Args['exp'];
    else if (k === '--seeds') a.seeds = Number(argv[++i]);
    else if (k === '--workers') a.workers = Math.max(1, Number(argv[++i]));
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--timeout') a.timeout = Math.max(30, Number(argv[++i]));
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

function runChunk(
  exp: string,
  variant: string,
  bot: string,
  start: number,
  end: number,
  outFile: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((ok) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/shadow-lab/shadowWorker.ts',
        '--exp',
        exp,
        '--variant',
        variant,
        '--bot',
        bot,
        '--prefix',
        'shadowlab',
        '--start',
        String(start),
        '--end',
        String(end),
        '--out',
        outFile,
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      ok(false);
    }, timeoutMs);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ok(code === 0);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ok(false);
    });
  });
}

async function runVariantRes(
  args: Args,
  variant: string,
  bot: string,
  tmpDir: string,
): Promise<RunResult[]> {
  const chunks = args.workers * 2;
  const per = Math.ceil(args.seeds / chunks);
  const tasks: Array<{ s: number; e: number; f: string }> = [];
  for (let s = 0; s < args.seeds; s += per) {
    const e = Math.min(args.seeds, s + per);
    tasks.push({ s, e, f: join(tmpDir, `${bot}-${variant}-${s}-${e}.json`) });
  }
  let i = 0;
  const all: RunResult[] = [];
  const worker = async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      const okChunk = await runChunk(args.exp, variant, bot, t.s, t.e, t.f, args.timeout * 1000);
      if (!okChunk) {
        console.error(`  ! 分片失败 ${bot}/${variant} [${t.s},${t.e})`);
        continue;
      }
      try {
        all.push(...(JSON.parse(readFileSync(t.f, 'utf-8')) as RunResult[]));
      } catch (e) {
        console.error(`  ! 读取失败 ${t.f}: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.workers, tasks.length) }, () => worker()));
  return all;
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.round(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length * 100) / 100;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

function minePriceOf(seed: string, slot: 'A' | 'B' | null): number | null {
  if (!slot) return null;
  const m = trueMinePrices(seed).find((x) => x.slot === slot);
  return m ? m.price : null;
}

async function mineInfo(args: Args): Promise<void> {
  const variants = ['none', 'tier', 'range30', 'range20', 'range10'] as const;
  const tmpDir = resolve(args.out, 'raw', `.tmp-shadow-mi-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const perVariant = new Map<string, RunResult[]>();
  for (const v of variants) {
    console.log(`[mineinfo] variant=${v} ...`);
    perVariant.set(v, await runVariantRes(args, v, 'AdaptiveMinerBot', tmpDir));
  }
  // 控制组：不关心矿价信息的既有 Bot，用于确认实验环境没变
  console.log('[mineinfo] control=NoForecastBot ...');
  const control = await runVariantRes(args, 'none', 'NoForecastBot', tmpDir);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const base = new Map<string, RunResult>();
  for (const r of perVariant.get('none') ?? []) base.set(r.seed, r);

  const L: string[] = [];
  L.push('# Shadow Mechanism Experiment A — 矿井估值信息粒度\n');
  L.push(`- 样本：每变体 ${args.seeds} 局（AdaptiveMinerBot，同一批 seed）`);
  L.push(`- 控制组：NoForecastBot（${control.length} 局），不读取任何价格信息\n`);
  L.push('| 变体 | 胜率% | EV | 平均采矿天数 | 采矿天数方差 | 高价值矿多挖天数 | 低价值矿早退率% | 利润方差 | 决策改变率% |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');

  for (const v of variants) {
    const rs = perVariant.get(v) ?? [];
    const sum = aggregateBot(rs);
    const days = rs.map((r) => r.miningDays);
    const profits = rs.map((r) => r.netProfit);
    const high = rs.filter((r) => (minePriceOf(r.seed, r.mineSlot) ?? 0) >= 250);
    const low = rs.filter((r) => (minePriceOf(r.seed, r.mineSlot) ?? 999) < 190);
    const highDays = mean(high.map((r) => r.miningDays));
    const lowDays = mean(low.map((r) => r.miningDays));
    const earlyReturn = low.length === 0 ? 0 : Math.round((low.filter((r) => r.miningDays <= 1).length / low.length) * 10000) / 100;
    let changed = 0;
    let cmp = 0;
    for (const r of rs) {
      const b = base.get(r.seed);
      if (!b) continue;
      cmp += 1;
      if (b.miningDays !== r.miningDays) changed += 1;
    }
    L.push(
      `| ${v} | ${sum.winRate} | ${sum.evNetProfitAllRuns} | ${sum.avgMiningDays} | ${variance(days)} | ${(highDays - lowDays).toFixed(2)} | ${earlyReturn} | ${variance(profits)} | ${cmp === 0 ? '—（基线）' : ((changed / cmp) * 100).toFixed(1)} |`,
    );
  }
  const ctl = aggregateBot(control);
  L.push(`\n- 控制组 NoForecastBot：胜率 ${ctl.winRate}%、EV ${ctl.evNetProfitAllRuns}、平均采矿天数 ${ctl.avgMiningDays}`);
  const baseline = aggregateBot(perVariant.get('none') ?? []);
  L.push(`- 基线（none）AdaptiveMinerBot：胜率 ${baseline.winRate}%、EV ${baseline.evNetProfitAllRuns}、平均采矿天数 ${baseline.avgMiningDays}\n`);

  const md = L.join('\n');
  writeFileSync(resolve(args.out, 'shadow-mineinfo.md'), md + '\n');
  writeFileSync(
    resolve(args.out, 'raw', 'shadow-mineinfo.json'),
    JSON.stringify(
      Object.fromEntries(variants.map((v) => [v, aggregateBot(perVariant.get(v) ?? [])])),
      null,
      2,
    ),
  );
  console.log('\n' + md);
}

async function returnLoad(args: Args): Promise<void> {
  const models = ['model0', 'modelA', 'modelB', 'modelC'] as const;
  const tmpDir = resolve(args.out, 'raw', `.tmp-shadow-rl-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const perModel = new Map<string, RunResult[]>();
  for (const m of models) {
    console.log(`[returnload] model=${m} ...`);
    perModel.set(m, await runVariantRes(args, m, 'AdaptiveForecastBot', tmpDir));
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const base = new Map<string, RunResult>();
  for (const r of perModel.get('model0') ?? []) base.set(r.seed, r);

  const L: string[] = [];
  L.push('# Shadow Mechanism Experiment B — 返程负重\n');
  L.push('模型定义：携带 ≥ 阈值 kg 时，每 5 次返程移动额外 −1 耐力（model0 = 当前机制）。');
  L.push(`样本：每模型 ${args.seeds} 局（AdaptiveForecastBot，同一批 seed）\n`);
  L.push('| 模型 | 阈值kg | 胜率% | EV | 平均采矿天数 | 采矿天数方差 | 早退率% | 返程额外耐力损失 | 平均返程天数 | 耐力死亡占比% | 决策改变率% |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');

  const THRESH: Record<string, string> = { model0: '无', modelA: '10', modelB: '15', modelC: '20' };
  for (const m of models) {
    const rs = perModel.get(m) ?? [];
    const sum = aggregateBot(rs);
    const loadLoss = mean(rs.map((r) => r.returnLoadStaminaLoss ?? 0));
    let changed = 0;
    let cmp = 0;
    for (const r of rs) {
      const b = base.get(r.seed);
      if (!b) continue;
      cmp += 1;
      if (b.miningDays !== r.miningDays) changed += 1;
    }
    const earlyReturn = ((rs.filter((r) => r.miningDays <= 1).length / Math.max(1, rs.length)) * 100).toFixed(1);
    L.push(
      `| ${m} | ${THRESH[m]} | ${sum.winRate} | ${sum.evNetProfitAllRuns} | ${sum.avgMiningDays} | ${variance(rs.map((r) => r.miningDays))} | ${earlyReturn} | ${loadLoss} | ${sum.avgReturnDays} | ${sum.failureRates.STAMINA_EXHAUSTED} | ${cmp === 0 ? '—（基线）' : ((changed / cmp) * 100).toFixed(1)} |`,
    );
  }

  const md = L.join('\n');
  writeFileSync(resolve(args.out, 'shadow-returnload.md'), md + '\n');
  writeFileSync(
    resolve(args.out, 'raw', 'shadow-returnload.json'),
    JSON.stringify(
      Object.fromEntries(models.map((m) => [m, aggregateBot(perModel.get(m) ?? [])])),
      null,
      2,
    ),
  );
  console.log('\n' + md);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  mkdirSync(resolve(args.out, 'raw'), { recursive: true });
  if (args.exp === 'mineinfo') await mineInfo(args);
  else await returnLoad(args);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
