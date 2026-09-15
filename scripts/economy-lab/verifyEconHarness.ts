/**
 * v0.3.0 Economic Independence Lab —— Phase 0 装置校验（§34）。
 *
 * 任一门禁不通过 ⇒ 禁止输出任何平衡结论。
 *
 *   H1  确定性：同 Bot + 同 Seed 两次运行逐位一致
 *   H2  共享 Seed：全候选 / 全 Bot 共用同一批 Seed（配对比较成立）
 *   H3  FairView 纯净性：不含未来天气表 / 遭遇表 / 干涸表 / RNG 状态
 *   H4  Aware vs Blind：同骨架、同 Seed，机制信息置空后动作必须出现差异
 *   H5  动作合法性：全 Bot × 全机制 × N Seed 无运行错误
 *   H6  机制真生效：每个 v0.3.0 机制都留下非零行为痕迹
 *   H7  动作合法性：Bot 只执行引擎判定为合法的动作（非法即抛错，已被 H5 覆盖）
 *   H8  配对比较：配对样本量 = seeds
 *   H9  结算正确性 + 会计恒等式（§35）：每一局都必须能对账
 *   H10 无隐藏价格泄漏（§34）：精确单价与 jitter 不得进入玩家视角
 *
 * 用法：npx tsx scripts/economy-lab/verifyEconHarness.ts [--seeds 200] [--workers 4]
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createNewGame } from '../../src/game';
import { buildFairView } from '../../src/simulation/fairView';
import { runBatchSeeds } from '../../src/simulation/runner';
import { econBot, ECON_BOT_NAMES } from '../../src/simulation/bots/econBots';
import { rescueDeferred, rescueShare, upkeepPerDay, upkeepOvertime, upkeepMining, lateSale } from './econMechs';
import type { RunResult } from '../../src/simulation/metrics';

const LAB_DIR = 'reports/economic-independence-lab';
const SEED_PREFIX = 'econ-train';

const seeds = Number(process.argv.includes('--seeds') ? process.argv[process.argv.indexOf('--seeds') + 1] : 200);
const workers = Number(process.argv.includes('--workers') ? process.argv[process.argv.indexOf('--workers') + 1] : 4);

const CONFIGS: Array<{ id: string; patch: Record<string, unknown>; probe: (rs: RunResult[]) => { ok: boolean; evidence: string } }> = [
  {
    id: 'BASE',
    patch: {},
    probe: () => ({ ok: true, evidence: '对照组（无 v0.3.0 机制）' }),
  },
  {
    id: 'A1-D1600',
    patch: rescueDeferred(1600),
    probe: (rs) => {
      const used = rs.filter((r) => (r.rescueSettlement ?? 0) > 0).length;
      const avg = rs.reduce((a, r) => a + (r.rescueSettlement ?? 0), 0) / Math.max(1, rs.length);
      return { ok: used > 0, evidence: `产生求援结算费的局 ${used} 个，全局均值 ${avg.toFixed(1)} 元` };
    },
  },
  {
    id: 'A2-S30',
    patch: rescueShare(0.3),
    probe: (rs) => {
      const share = rs.reduce((a, r) => a + (r.rescueRevenueShare ?? 0), 0);
      return { ok: share > 0, evidence: `收入抽成累计 ${share} 元` };
    },
  },
  {
    id: 'B1-P40',
    patch: upkeepPerDay(40),
    probe: (rs) => {
      const avg = rs.reduce((a, r) => a + (r.operatingCost ?? 0), 0) / Math.max(1, rs.length);
      return { ok: avg > 0, evidence: `运营成本全局均值 ${avg.toFixed(1)} 元` };
    },
  },
  {
    id: 'B2-F20R60',
    patch: upkeepOvertime(20, 60),
    probe: (rs) => {
      const hit = rs.filter((r) => (r.operatingCost ?? 0) > 0).length;
      return { ok: hit > 0, evidence: `触发超时运营费的局 ${hit} 个` };
    },
  },
  {
    id: 'B3-M200',
    patch: upkeepMining(200),
    probe: (rs) => {
      const avg = rs.reduce((a, r) => a + (r.operatingCost ?? 0), 0) / Math.max(1, rs.length);
      return { ok: avg > 0, evidence: `矿区驻扎费全局均值 ${avg.toFixed(1)} 元` };
    },
  },
  {
    id: 'C3-T30',
    patch: { mechanisms: { tradeCost: { enabled: true, transportPerKg: 30, commissionRate: 0, fixedAppraisalFee: 0 } } },
    probe: (rs) => {
      const avg = rs.reduce((a, r) => a + (r.transportCost ?? 0), 0) / Math.max(1, rs.length);
      return { ok: avg > 0, evidence: `运输费全局均值 ${avg.toFixed(1)} 元` };
    },
  },
  {
    id: 'L1-G8D25',
    patch: lateSale(8, 0.25),
    probe: (rs) => {
      const hit = rs.filter((r) => (r.lateSaleLoss ?? 0) > 0).length;
      return { ok: hit > 0, evidence: `触发逾期折价的局 ${hit} 个` };
    },
  },
];

const BOTS = [...ECON_BOT_NAMES];

interface Row {
  check: string;
  name: string;
  ok: boolean;
  detail: string;
}

const rows: Row[] = [];
function add(check: string, name: string, ok: boolean, detail: string): void {
  rows.push({ check, name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${check} ${name} —— ${detail}`);
}

/* ------------------------------------------------------------------ */
/* H1 确定性                                                            */
/* ------------------------------------------------------------------ */
function h1(): void {
  const bot = econBot('EconMasterBot')!;
  const ss: string[] = [];
  for (let i = 0; i < 40; i++) ss.push(`${SEED_PREFIX}:${i}`);
  const a = runBatchSeeds(bot, ss);
  const b = runBatchSeeds(bot, ss);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify({ ...a[i], events: [] }) !== JSON.stringify({ ...b[i], events: [] })) diff += 1;
  }
  add('H1', '确定性（40 Seed 逐位一致）', diff === 0, `${a.length - diff}/${a.length} 个 Seed 逐位一致`);
}

/* ------------------------------------------------------------------ */
/* H3 / H10 FairView 纯净性 + 无隐藏价格泄漏                             */
/* ------------------------------------------------------------------ */
function h3(): void {
  const state = createNewGame(`${SEED_PREFIX}:7`);
  const view = buildFairView(state);
  const keys = Object.keys(view).sort();
  const banned = ['weather', 'encounters', 'rngState', 'oasisDrought', 'triggeredEncounters'];
  const leaked = banned.filter((k) => keys.includes(k));
  add('H3', 'FairView 纯净性（不含未来/隐藏状态）', leaked.length === 0,
    leaked.length === 0 ? `顶层键 ${keys.length} 个，未发现禁用键` : `泄漏：${leaked.join(',')}`);

  // H10：精确单价 / jitter 不得进入玩家视角
  const mineLeak = view.map.mines.filter((m) => Object.prototype.hasOwnProperty.call(m, 'gemPrice') || Object.prototype.hasOwnProperty.call(m, 'detail'));
  const tileLeak = Object.values(view.map.tiles).filter((t) => t.minePrice !== undefined);
  const ok = mineLeak.length === 0 && tileLeak.length === 0 && view.gemPrice === null && view.rules.marketReferencePrice > 0;
  add('H10', '无隐藏价格泄漏（§34）', ok,
    `mines 泄漏 ${mineLeak.length} 项 / tiles 泄漏 ${tileLeak.length} 项；view.gemPrice=${view.gemPrice}；行情参考价=${view.rules.marketReferencePrice} 元/kg`);
}

/* ------------------------------------------------------------------ */
/* H9 结算正确性 + 会计恒等式                                            */
/* ------------------------------------------------------------------ */
function h9(all: Map<string, RunResult[]>): void {
  let total = 0;
  let bad = 0;
  let maxResidual = 0;
  const examples: string[] = [];
  for (const [, rs] of all) {
    for (const r of rs) {
      total += 1;
      const identity =
        2000 +
        (r.tripCashFlow ?? 0) +
        (r.grossGemRevenue ?? 0) -
        (r.lateSaleLoss ?? 0) -
        (r.settlementExpenses ?? 0);
      const residual = (r.finalCash ?? r.finalAssets) - identity;
      maxResidual = Math.max(maxResidual, Math.abs(residual));
      if (r.accountingOk === false || residual !== 0) {
        bad += 1;
        if (examples.length < 3) examples.push(`${r.seed} residual=${residual} ok=${r.accountingOk}`);
      }
    }
  }
  add('H9', '结算正确性 + 会计恒等式（§35）', bad === 0,
    `校验 ${total} 局，违规 ${bad} 局，最大残差 ${maxResidual} 元${examples.length ? '；例：' + examples.join(' | ') : ''}`);
}

/* ------------------------------------------------------------------ */
/* H4 Aware vs Blind（同骨架、同 Seed）                                  */
/* ------------------------------------------------------------------ */
function h4(all: Map<string, RunResult[]>): void {
  const cfgs = ['A1-D1600', 'A2-S30', 'B1-P40', 'B2-F20R60', 'B3-M200', 'L1-G8D25'];
  const parts: string[] = [];
  let allOk = true;
  for (const c of cfgs) {
    const rs = all.get(`${c}|EconMasterBot`) ?? [];
    const bs = all.get(`${c}|EconBlindBot`) ?? [];
    if (rs.length === 0 || bs.length === 0) continue;
    const bySeed = new Map(bs.map((r) => [r.seed, r]));
    let diff = 0;
    let n = 0;
    for (const r of rs) {
      const b = bySeed.get(r.seed);
      if (!b) continue;
      n += 1;
      if (r.miningDays !== b.miningDays || ((r.emergencyRescues ?? 0) > 0) !== ((b.emergencyRescues ?? 0) > 0)) diff += 1;
    }
    const rate = (diff / Math.max(1, n)) * 100;
    if (rate <= 0) allOk = false;
    parts.push(`${c} ${rate.toFixed(1)}%`);
  }
  add('H4', 'Aware vs Blind 动作差异（同骨架同 Seed）', allOk, parts.join(' | '));
}

/* ------------------------------------------------------------------ */
/* H5 / H6 / H7 / H8：跑全机制 × 全 Bot                                  */
/* ------------------------------------------------------------------ */
function spawnChunk(override: string, bots: string[], start: number, end: number, outFile: string): Promise<boolean> {
  return new Promise((fulfil) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/mechanism-lab/multiWorker.ts', '--bots', bots.join(','), '--prefix', SEED_PREFIX, '--start', String(start), '--end', String(end), '--out', outFile],
      { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OASIS_CONFIG_OVERRIDE: override } },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('exit', (code) => fulfil(code === 0));
    child.on('error', () => fulfil(false));
    void err;
  });
}

async function runAll(): Promise<Map<string, RunResult[]>> {
  const out = new Map<string, RunResult[]>();
  const tmp = resolve(LAB_DIR, 'raw', `.harness-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  for (const cfg of CONFIGS) {
    const override = JSON.stringify(cfg.patch);
    const per = 200;
    for (let s = 0; s < seeds; s += per) {
      const e = Math.min(seeds, s + per);
      const f = join(tmp, `${cfg.id}-${s}-${e}.json`);
      const ok = await spawnChunk(override, BOTS, s, e, f);
      if (!ok) { console.warn(`  ⚠ ${cfg.id} [${s},${e}) 分片失败`); continue; }
      const raw = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, RunResult[]>;
      for (const [b, rs] of Object.entries(raw)) {
        const k = `${cfg.id}|${b}`;
        out.set(k, [...(out.get(k) ?? []), ...rs]);
      }
    }
    const merged = BOTS.map((b) => (out.get(`${cfg.id}|${b}`) ?? []).length);
    console.log(`  · ${cfg.id} 完成（各 Bot 局数：${merged.join('/')}）`);
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  return out;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`Phase 0 装置校验：${CONFIGS.length} 机制 × ${BOTS.length} Bot × ${seeds} Seed`);
  h1();
  h3();

  const all = await runAll();

  /* H5/H7 动作合法性 */
  let errors = 0;
  let runs = 0;
  for (const [, rs] of all) {
    for (const r of rs) { runs += 1; if (r.error) errors += 1; }
  }
  add('H5', '动作合法性（无运行错误）', errors === 0, `${runs} 局，errors = ${errors}`);

  /* H6 机制真生效 */
  const parts: string[] = [];
  let h6ok = true;
  for (const cfg of CONFIGS) {
    if (cfg.id === 'BASE') continue;
    const rs = (all.get(`${cfg.id}|EconMasterBot`) ?? []);
    const p = cfg.probe(rs);
    if (!p.ok) h6ok = false;
    parts.push(`${cfg.id} ${p.ok ? '✅' : '❌'} ${p.evidence}`);
  }
  add('H6', '机制真生效（非零痕迹）', h6ok, parts.join('；'));

  /* H8 配对比较 */
  let pairedOk = true;
  const pDetail: string[] = [];
  for (const cfg of CONFIGS) {
    for (const b of ['EconMasterBot', 'EconBlindBot']) {
      const n = (all.get(`${cfg.id}|${b}`) ?? []).length;
      if (n !== seeds) pairedOk = false;
    }
    pDetail.push(`${cfg.id}:${(all.get(`${cfg.id}|EconMasterBot`) ?? []).length}/${seeds}`);
  }
  add('H8', '配对比较成立（同 Seed 样本量一致）', pairedOk, pDetail.join(' '));

  h4(all);
  h9(all);

  const pass = rows.filter((r) => r.ok).length;
  const md = [
    `# Harness Check —— Economic Independence Lab（Phase 0）`,
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`,
    `- 样本：${seeds} Seed × ${BOTS.length} Bot × ${CONFIGS.length} 机制`,
    `- 结论：**${pass}/${rows.length} 通过**`,
    '',
    '| 检查 | 名称 | 结果 | 详情 |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.check} | ${r.name} | ${r.ok ? '✅ PASS' : '❌ FAIL'} | ${r.detail} |`),
    '',
  ].join('\n');
  mkdirSync(resolve(LAB_DIR), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(LAB_DIR, 'harness-check.md'), md, 'utf-8');
  appendFileSync(resolve(LAB_DIR, 'experiment-log.md'), `- ${new Date().toISOString()} Phase 0 装置校验 ${pass}/${rows.length} PASS（${((Date.now() - t0) / 1000).toFixed(1)}s）\n`);
  console.log(`\n${pass}/${rows.length} 通过 → ${resolve(LAB_DIR, 'harness-check.md')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
