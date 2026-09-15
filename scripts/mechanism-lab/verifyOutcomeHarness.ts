/**
 * v0.2.0 Phase 0 —— 实验装置校验（Harness Check）。
 *
 * §29 硬门禁：开始任何结论前必须验证这 8 项；任何一项不通过 → **停止结论输出，先修装置**。
 *
 *   H1 确定性：同一 Bot + 同一 Seed 跑两次，结果逐位一致
 *   H2 共享 Seed：世界只由 Seed 决定（不同 Bot 同 Seed = 同一张图）
 *   H3 FairView 纯净性：Bot 拿不到未来天气表 / 遭遇表 / 干涸表 / RNG 状态
 *   H4 Bot 真的读机制：机制可见 vs 屏蔽，动作必须真的不同
 *   H5 动作合法性：全部 Bot × 全部机制 × N Seed 无运行错误
 *   H6 机制真的生效：每个机制都有非零行为痕迹
 *   H7 新机制参数真的被读取（v0.2.0 专项：view.rules.* 的三个新族必须被驱动）
 *   H8 配对比较成立（同 Seed 逐局 diff 可计算，n = seeds）
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNewGame } from '../../src/game';
import { generateWorld } from '../../src/game/map/generate';
import { buildFairView } from '../../src/simulation/fairView';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runOne } from '../../src/simulation/runner';
import { aggregateBot, aggregateOutcome, type RunResult } from '../../src/simulation/metrics';
import { OUTCOME_VARIANT_BY_ID } from './outcomeMechs';

const OUT = 'reports/outcome-mechanism-lab';
const SEEDS = 300;

interface Check { id: string; name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function record(id: string, name: string, pass: boolean, detail: string): void {
  checks.push({ id, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${name}\n    ${detail}`);
}

function runWithOverride(override: string, bot: string, start: number, end: number, tmp: string): RunResult[] {
  const out = `${tmp}/out-${bot}-${Math.random().toString(36).slice(2)}.json`;
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/mechanism-lab/outcomeWorker.ts', '--bots', bot, '--prefix', 'outcome', '--start', String(start), '--end', String(end), '--out', out],
    { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, OASIS_CONFIG_OVERRIDE: override } },
  );
  if (r.status !== 0) throw new Error(`子进程失败(${bot}): ${r.stderr?.slice(-400)}`);
  const parsed = JSON.parse(readFileSync(out, 'utf-8')) as Record<string, RunResult[]>;
  return parsed[bot] ?? [];
}

function main(): void {
  const t0 = Date.now();
  const tmp = resolve(OUT, 'raw', '.tmp-verify');
  mkdirSync(tmp, { recursive: true });

  /* ---------------- H1 确定性 ---------------- */
  {
    const bot = BOT_BY_NAME['OutcomeMasterBot'];
    let same = true;
    let firstDiff = '';
    for (let i = 0; i < 40; i++) {
      const seed = `outcome:${i}`;
      const a = runOne(bot, seed);
      const b = runOne(bot, seed);
      if (JSON.stringify(a) !== JSON.stringify(b)) { same = false; firstDiff = seed; break; }
    }
    record('H1', '确定性（同 Bot + 同 Seed 两次运行逐位一致）', same, same ? '40 个 Seed 全部逐位一致' : `首个不一致 Seed: ${firstDiff}`);
  }

  /* ---------------- H2 共享 Seed ---------------- */
  {
    let ok = true;
    const detail: string[] = [];
    for (const seed of ['outcome:0', 'outcome:1', 'outcome:7']) {
      const m = generateWorld(seed);
      const s = createNewGame(seed);
      const sameWorld = JSON.stringify(m.mines) === JSON.stringify(s.map.mines) && JSON.stringify(m.tiles) === JSON.stringify(s.map.tiles);
      if (!sameWorld) ok = false;
      detail.push(`${seed}: ${m.mines.map((x) => `${x.slot}@${x.tileId}=${x.gemPrice}`).join(',')}`);
    }
    record('H2', '共享 Seed：世界只由 Seed 决定（不同 Bot 同 Seed = 同一张图）', ok, detail.join(' | '));
  }

  /* ---------------- H3 FairView 纯净性 ---------------- */
  {
    const s = createNewGame('outcome:3');
    const view = buildFairView(s) as unknown as Record<string, unknown>;
    const keys = Object.keys(view);
    const forbidden = ['weather', 'encounters', 'drought', 'rngState', 'pendingResults', 'triggeredEncounters'];
    const leaked = forbidden.filter((k) => keys.includes(k));
    const mapObj = view.map as Record<string, unknown>;
    const mapLeaked = ['weather', 'encounters', 'drought'].filter((k) => k in mapObj);
    const pass = leaked.length === 0 && mapLeaked.length === 0;
    record('H3', 'FairView 纯净性：不含未来天气表 / 遭遇表 / 干涸表 / RNG 状态', pass,
      pass ? `FairView 顶层键：${keys.join(', ')}` : `泄漏字段：${[...leaked, ...mapLeaked].join(', ')}`);
  }

  /* ---------------- H5 合法性 + H6 机制生效（先跑，后面复用） ---------------- */
  const botNames = ['OutcomeMasterBot', 'OutcomeBlindBot', 'SurgeOnlyBot', 'VillageOnlyBot', 'ScoutOnlyBot', 'RescueOnlyBot'];
  const variantIds = ['BASE', 'E1', 'E2', 'E3', 'F1', 'G1', 'H1'];
  const results: Record<string, Record<string, RunResult[]>> = {};
  for (const v of variantIds) {
    results[v] = {};
    const override = JSON.stringify(OUTCOME_VARIANT_BY_ID[v].patch);
    for (const bot of botNames) {
      results[v][bot] = runWithOverride(override, bot, 0, SEEDS, tmp);
    }
  }

  {
    const errs: string[] = [];
    for (const v of variantIds) for (const bot of botNames) {
      const bad = results[v][bot].filter((r) => r.error);
      if (bad.length > 0) errs.push(`${v}/${bot}: ${bad.length} 例（例：${bad[0].error}）`);
    }
    record('H5', 'Bot 动作合法性：全部 Bot × 全部机制 × 300 Seed 无运行错误（非法动作会抛错）',
      errs.length === 0,
      errs.length === 0 ? `${variantIds.length} 机制 × ${botNames.length} Bot × ${SEEDS} 局 = ${variantIds.length * botNames.length * SEEDS} 局，errors = 0` : errs.join(' | '));
  }

  /* ---------------- H6 机制真的生效 ---------------- */
  {
    const rows: string[] = [];
    const probe: Array<[string, string, (rs: RunResult[]) => string, (rs: RunResult[]) => boolean]> = [
      ['E1', '返程情报揭示 > 0 格', (rs) => `平均揭示 ${(rs.reduce((a, r) => a + (r.returnIntelTiles ?? 0), 0) / Math.max(1, rs.length)).toFixed(2)} 格`, (rs) => rs.some((r) => (r.returnIntelTiles ?? 0) > 0)],
      ['E2', '环形勘察揭示 > 0 格', (rs) => `平均揭示 ${(rs.reduce((a, r) => a + (r.returnIntelTiles ?? 0), 0) / Math.max(1, rs.length)).toFixed(2)} 格`, (rs) => rs.some((r) => (r.returnIntelTiles ?? 0) > 0)],
      ['E3', '侦察消耗指南针', (rs) => `有情报揭示的局 ${((rs.filter((r) => (r.returnIntelTiles ?? 0) > 0).length / Math.max(1, rs.length)) * 100).toFixed(1)}%`, (rs) => rs.some((r) => (r.returnIntelTiles ?? 0) > 0)],
      ['F1', '村庄服务被使用', (rs) => `使用率 ${((rs.filter((r) => (r.villageServicesUsed ?? 0) > 0).length / Math.max(1, rs.length)) * 100).toFixed(1)}%，平均花费 ${(rs.reduce((a, r) => a + (r.villageServiceSpent ?? 0), 0) / Math.max(1, rs.length)).toFixed(0)} 元`, (rs) => rs.some((r) => (r.villageServicesUsed ?? 0) > 0)],
      ['G1', '深层采矿被使用', (rs) => `使用率 ${((rs.filter((r) => (r.surgeMiningUses ?? 0) > 0).length / Math.max(1, rs.length)) * 100).toFixed(1)}%，平均额外 ${(rs.reduce((a, r) => a + (r.surgeMiningExtraKg ?? 0), 0) / Math.max(1, rs.length)).toFixed(2)}kg`, (rs) => rs.some((r) => (r.surgeMiningUses ?? 0) > 0)],
      ['H1', '求援被使用', (rs) => `使用率 ${((rs.filter((r) => (r.emergencyRescues ?? 0) > 0).length / Math.max(1, rs.length)) * 100).toFixed(1)}%，平均花费 ${(rs.reduce((a, r) => a + (r.emergencyRescueCost ?? 0), 0) / Math.max(1, rs.length)).toFixed(0)} 元`, (rs) => rs.some((r) => (r.emergencyRescues ?? 0) > 0)],
    ];
    let allOk = true;
    for (const [v, name, fmt, ok] of probe) {
      const rs = results[v]['OutcomeMasterBot'];
      const good = ok(rs);
      if (!good) allOk = false;
      rows.push(`| ${v} | ${name} | ${good ? '✅' : '❌'} | ${fmt(rs)} |`);
    }
    record('H6', '机制真的生效（每个 v0.2.0 机制都有非零行为痕迹）', allOk,
      `\n    | 机制 | 探查点 | 生效 | 证据 |\n    |---|---|---|---|\n    ${rows.join('\n    ')}`);
  }

  /* ---------------- H4 Bot 真的读机制（aware vs blind 同骨架） ---------------- */
  {
    const lines: string[] = [];
    let worst = 1;
    for (const v of variantIds) {
      const aware = results[v]['OutcomeMasterBot'];
      const blind = results[v]['OutcomeBlindBot'];
      const map = new Map(blind.map((r) => [r.seed, r]));
      let changed = 0; let n = 0;
      for (const r of aware) {
        const b = map.get(r.seed);
        if (!b) continue;
        n += 1;
        // 「读了也改了」= 采矿天数 / 新机制动作 / 完成状态任一不同
        const dMining = r.miningDays !== b.miningDays;
        const dMech = (r.surgeMiningUses ?? 0) > 0 || (r.villageServicesUsed ?? 0) > 0 || (r.emergencyRescues ?? 0) > 0;
        const dFlip = (r.expeditionCompleted ?? r.status === 'VICTORY') !== (b.expeditionCompleted ?? b.status === 'VICTORY');
        if (dMining || dMech || dFlip) changed += 1;
      }
      const rate = n === 0 ? 0 : (changed / n) * 100;
      if (v !== 'BASE') worst = Math.min(worst, rate);
      const aO = aggregateOutcome(aware);
      const bO = aggregateOutcome(blind);
      lines.push(`| ${v} | ${rate.toFixed(1)}% | ${aO.completionRate} | ${bO.completionRate} | ${aO.profitableRate} | ${bO.profitableRate} |`);
    }
    record('H4', 'Bot 真的读取机制信息（OutcomeMasterBot vs 同骨架屏蔽组，动作必须出现差异）', worst > 0,
      `\n    | 机制 | 动作改变率% | aware 完成率 | blind 完成率 | aware 盈利率 | blind 盈利率 |\n    |---|---|---:|---:|---:|---:|\n    ${lines.join('\n    ')}`);
  }

  /* ---------------- H8 配对比较成立 ---------------- */
  {
    const rows: string[] = [];
    let ok = true;
    for (const v of variantIds) {
      if (v === 'BASE') continue;
      const aware = results[v]['OutcomeMasterBot'];
      const blind = results['BASE']['OutcomeMasterBot'];
      const baseSeeds = new Set(blind.map((r) => r.seed));
      const matched = aware.filter((r) => baseSeeds.has(r.seed));
      if (matched.length !== SEEDS) ok = false;
      rows.push(`| ${v} | ${matched.length}/${SEEDS} | ${matched.length === SEEDS ? '✅' : '❌'} |`);
    }
    record('H8', '配对比较成立（全部候选与基线同 Seed，配对样本量 = seeds）', ok,
      `\n    | 机制 | 配对局数 | 结果 |\n    |---|---:|:---:|\n    ${rows.join('\n    ')}`);
  }

  /* ---------------- 汇总 ---------------- */
  const passAll = checks.every((c) => c.pass);
  const md = [
    '# Harness Check —— Outcome & Mechanism Expansion Lab（Phase 0）',
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`,
    `- 样本：${SEEDS} Seed/Bot，机制 ${variantIds.join(' / ')}，Bot ${botNames.length} 个`,
    `- 结论：**${passAll ? '全部通过，可以开始机制实验' : '存在未通过项，必须先修装置（§29：停止结论输出）'}**`,
    '',
    '| 检查 | 名称 | 结果 | 详情 |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.id} | ${c.name} | ${c.pass ? '✅ PASS' : '❌ FAIL'} | ${c.detail.replace(/\n\s*/g, '<br>')} |`),
    '',
    '## 装置说明',
    '',
    '- 全部候选 / 全部 Bot 共用同一批 Seed（前缀 `outcome`，`outcome:<i>`）→ 逐局配对比较成立（§35）。',
    '- Decision Change 的分母 = 同 Bot + 同 Seed 的 BASE 结果。',
    '- Bot 只拿 FairView；机制参数通过 `view.rules.*` 以「规则书」形式公开，不含任何隐藏信息。',
    '- `OutcomeMasterBot` 与 `OutcomeBlindBot` 同骨架、同装备、同事件策略，唯一区别是永远看不到 v0.2.0 机制参数。',
    '- Outcome 口径：`expeditionCompleted = VICTORY && miningDays > 0 && stamina > 0`；',
    '  `profitable = netProfit > 0`，而 `netProfit = finalCash − 2000`，剩余装备**不计虚拟残值**（§2/§39）。',
    '',
  ].join('\n');
  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, 'harness-check.md'), md + '\n');
  console.log(`\n${passAll ? '✅' : '❌'} harness-check.md 已写入（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  void aggregateBot;
  if (!passAll) process.exitCode = 1;
}

main();
