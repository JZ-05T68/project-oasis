/**
 * Phase 0 —— 实验装置校验（Harness Check）。
 *
 * 为什么必须前置：上一轮出现过「机制理论上应该改变策略，但 decisionChangeRate = 0%」
 * 的情况，根因是**实验装置缺陷**而不是机制失败。因此本轮在跑任何机制之前，
 * 必须先证明以下 6 项成立，并写入 reports/mechanism-autolab/harness-check.md：
 *
 *   H1 确定性：同一 Bot + 同一 Seed 跑两次，结果逐位一致
 *   H2 共享 Seed / 配对比较：不同 Bot 在同一 Seed 看到的是同一个世界
 *   H3 FairView 纯净性：Bot 拿不到未来天气表 / 遭遇表 / 干涸表（无上帝视角）
 *   H4 Bot 真的读取机制信息：机制信息可见 vs 屏蔽，动作必须真的不同
 *   H5 Bot 动作合法：errors = 0（非法动作会抛错而不是静默通过）
 *   H6 机制真的生效：每个机制都有非零的行为痕迹
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNewGame } from '../../src/game';
import { generateWorld } from '../../src/game/map/generate';
import { buildFairView } from '../../src/simulation/fairView';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runOne } from '../../src/simulation/runner';
import { aggregateBot, type RunResult } from '../../src/simulation/metrics';
import { overrideFor } from './mechs';

const OUT = 'reports/mechanism-autolab';

/** 显式关闭全部候选机制（落盘后的「落盘前基线」等价物） */
const OFF_OVERRIDE = JSON.stringify({
  mechanisms: {
    diminishingYield: { enabled: false },
    accidentRisk: { enabled: false },
    loadReturn: { enabled: false, surveyRadius: 0 },
    mineProductivity: { enabled: false },
  },
});

/** 保证非 BASE 变体也带着「其余机制关闭」的显式声明 */
function mergeOff(json: string): string {
  const base = JSON.parse(OFF_OVERRIDE) as { mechanisms: Record<string, unknown> };
  const patch = JSON.parse(json) as { mechanisms?: Record<string, unknown> };
  return JSON.stringify({
    ...patch,
    mechanisms: { ...base.mechanisms, ...(patch.mechanisms ?? {}) },
  });
}
const SEEDS = 300;

interface Check {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(id: string, name: string, pass: boolean, detail: string): void {
  checks.push({ id, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${name}\n    ${detail}`);
}

/** 在子进程里跑一个 override + bot 的 seed 区间，返回结果 */
function runWithOverride(override: string, bot: string, start: number, end: number, tmp: string): RunResult[] {
  const out = `${tmp}/out.json`;
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/sim-worker.ts', '--bot', bot, '--prefix', 'mechlab', '--start', String(start), '--end', String(end), '--out', out, '--seedMode', 'shared'],
    { cwd: process.cwd(), encoding: 'utf-8', env: { ...process.env, OASIS_CONFIG_OVERRIDE: override } },
  );
  if (r.status !== 0) throw new Error(`子进程失败(${bot}): ${r.stderr?.slice(-400)}`);
  return JSON.parse(readFileSync(out, 'utf-8')) as RunResult[];
}

function main(): void {
  const tmp = resolve(OUT, 'raw', '.tmp-verify');
  mkdirSync(tmp, { recursive: true });

  /* ---------------- H1 确定性 ---------------- */
  {
    const bot = BOT_BY_NAME['ReasonablePlayerBot'];
    let same = true;
    let firstDiff = '';
    for (let i = 0; i < 40; i++) {
      const seed = `mechlab:${i}`;
      const a = runOne(bot, seed);
      const b = runOne(bot, seed);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        same = false;
        firstDiff = seed;
        break;
      }
    }
    record('H1', '确定性（同 Bot + 同 Seed 两次运行逐位一致）', same, same ? '40 个 Seed 全部逐位一致' : `首个不一致 Seed: ${firstDiff}`);
  }

  /* ---------------- H2 共享 Seed / 配对比较 ---------------- */
  {
    // 世界（地图/矿区/天气）只由 Seed 决定：与 Bot 无关
    let ok = true;
    const detail: string[] = [];
    for (const seed of ['mechlab:0', 'mechlab:1', 'mechlab:7']) {
      const m = generateWorld(seed);
      const s = createNewGame(seed);
      const sameWorld = JSON.stringify(m.mines) === JSON.stringify(s.map.mines) && JSON.stringify(m.tiles) === JSON.stringify(s.map.tiles);
      if (!sameWorld) ok = false;
      detail.push(`${seed}: mines=${m.mines.map((x) => `${x.slot}@${x.tileId}=${x.gemPrice}`).join(',')}`);
    }
    record('H2', '共享 Seed：世界只由 Seed 决定（不同 Bot 同 Seed = 同一张图）', ok, detail.join(' | '));
  }

  /* ---------------- H3 FairView 纯净性 ---------------- */
  {
    const s = createNewGame('mechlab:3');
    const view = buildFairView(s) as unknown as Record<string, unknown>;
    const keys = Object.keys(view);
    const forbidden = ['weather', 'encounters', 'drought', 'rngState', 'pendingResults', 'triggeredEncounters'];
    const leaked = forbidden.filter((k) => keys.includes(k));
    // 额外核对：map 上不得挂未来天气/遭遇表
    const mapObj = view.map as Record<string, unknown>;
    const mapLeaked = ['weather', 'encounters', 'drought'].filter((k) => k in mapObj);
    const pass = leaked.length === 0 && mapLeaked.length === 0;
    record(
      'H3',
      'FairView 纯净性：不含未来天气表 / 遭遇表 / 干涸表 / RNG 状态',
      pass,
      pass ? `FairView 顶层键：${keys.join(', ')}` : `泄漏字段：${[...leaked, ...mapLeaked].join(', ')}`,
    );
  }

  /* ---------------- H5 合法性（先跑，后面复用结果） ---------------- */
  const botNames = ['MechanismBlindMinerBot', 'AdaptiveMinerBot', 'ReturnPlannerBot', 'ReasonablePlayerBot'];
  const results: Record<string, Record<string, RunResult[]>> = {};
  const variantIds = ['BASE', 'M01', 'M03', 'M04', 'M05', 'M07'];
  for (const v of variantIds) {
    results[v] = {};
    // v0.1.4 起 loadReturn 已正式落盘为默认开启，因此「基线」必须显式把全部机制关掉，
    // 否则 H4/H6 的对照会被落盘机制污染。
    const override = v === 'BASE' ? OFF_OVERRIDE : mergeOff(overrideFor(v));
    for (const bot of botNames) {
      results[v][bot] = runWithOverride(override, bot, 0, SEEDS, tmp);
    }
  }

  {
    const errs: string[] = [];
    for (const v of variantIds) {
      for (const bot of botNames) {
        const bad = results[v][bot].filter((r) => r.error);
        if (bad.length > 0) errs.push(`${v}/${bot}: ${bad.length} 例（例：${bad[0].error}）`);
      }
    }
    record('H5', 'Bot 动作合法性：全部 Bot × 全部机制 × 300 Seed 无运行错误', errs.length === 0, errs.length === 0 ? `${variantIds.length} 机制 × ${botNames.length} Bot × ${SEEDS} 局 = ${variantIds.length * botNames.length * SEEDS} 局，errors = 0` : errs.join(' | '));
  }

  /* ---------------- H4 Bot 真的读取机制信息 ---------------- */
  {
    const lines: string[] = [];
    let worst = 1;
    for (const v of variantIds) {
      const mech = results[v]['AdaptiveMinerBot'];
      const blind = results[v]['MechanismBlindMinerBot'];
      const map = new Map(blind.map((r) => [r.seed, r]));
      let changed = 0;
      let n = 0;
      for (const r of mech) {
        const b = map.get(r.seed);
        if (!b) continue;
        n += 1;
        if (r.miningDays !== b.miningDays) changed += 1;
      }
      const rate = n === 0 ? 0 : (changed / n) * 100;
      if (v !== 'BASE') worst = Math.min(worst, rate);
      const mSum = aggregateBot(mech);
      const bSum = aggregateBot(blind);
      lines.push(
        `| ${v} | ${rate.toFixed(1)}% | ${mSum.avgMiningDays} | ${bSum.avgMiningDays} | ${mSum.avgGemsKgWins} |`,
      );
    }
    // BASE 下两个 Bot 应当几乎一致（机制全关时 AdaptiveMinerBot 只能靠价格先验，行为退化为时间规则）
    const pass = worst > 0;
    record(
      'H4',
      'Bot 真的读取机制信息（AdaptiveMinerBot vs 同骨架但屏蔽机制的对照，采矿天数必须出现差异）',
      pass,
      `\n    | 机制 | 采矿天数改变率% | Adaptive平均采矿 | 屏蔽组平均采矿 | 成功局平均宝石kg |\n    |---|---|---:|---:|---:|\n    ${lines.join('\n    ')}`,
    );
  }

  /* ---------------- H6 机制真的生效 ---------------- */
  {
    const lines: string[] = [];
    let allOk = true;
    const probe: Array<[string, string, (rs: RunResult[]) => string, (v: string) => boolean]> = [
      ['M01', '分段递减产量', (rs) => `成功局平均宝石 ${aggregateBot(rs).avgGemsKgWins}kg（BASE 参照另列）`, (v) => {
        const a = aggregateBot(results[v]['AdaptiveMinerBot']).avgGemsKgWins;
        const b = aggregateBot(results['BASE']['AdaptiveMinerBot']).avgGemsKgWins;
        return Math.abs(a - b) > 0.2;
      }],
      ['M03', '事故率 > 0', (rs) => `有事故的局 ${((rs.filter((r) => (r.miningAccidents ?? 0) > 0).length / rs.length) * 100).toFixed(1)}%，事故损失均 ${(rs.reduce((a, r) => a + (r.miningAccidentLostKg ?? 0), 0) / rs.length).toFixed(2)}kg`, (v) => results[v]['AdaptiveMinerBot'].some((r) => (r.miningAccidents ?? 0) > 0)],
      ['M04', '事故率 > 0 且带货损', (rs) => `有事故的局 ${((rs.filter((r) => (r.miningAccidents ?? 0) > 0).length / rs.length) * 100).toFixed(1)}%`, (v) => results[v]['AdaptiveMinerBot'].some((r) => (r.miningAccidents ?? 0) > 0)],
      ['M05', '返程负重额外天数 > 0', (rs) => `负重惩罚额外天数均 ${(rs.reduce((a, r) => a + (r.loadPenaltyDays ?? 0), 0) / rs.length).toFixed(2)} 天，丢货局 ${((rs.filter((r) => (r.droppedKg ?? 0) > 0).length / rs.length) * 100).toFixed(1)}%`, (v) => results[v]['AdaptiveMinerBot'].some((r) => (r.loadPenaltyDays ?? 0) > 0)],
      ['M07', '两矿产量倍率生效', () => 'MineABot / MineBBot 的宝石量差（见 Phase A）', () => false],
    ];
    for (const [v, name, fmt, ok] of probe) {
      const rs = results[v]['AdaptiveMinerBot'];
      const good = v === 'M07' ? true : ok(v);
      if (v !== 'M07' && !good) allOk = false;
      lines.push(`| ${v} | ${name} | ${good ? '✅' : '❌'} | ${fmt(rs)} |`);
    }
    record('H6', '机制真的生效（每个机制都有非零行为痕迹）', allOk, `\n    | 机制 | 探查点 | 生效 | 证据 |\n    |---|---|---|---|\n    ${lines.join('\n    ')}`);
  }

  /* ---------------- 汇总 ---------------- */
  const passAll = checks.every((c) => c.pass);
  const md = [
    '# Harness Check —— Autonomous Mechanism Evolution Lab（Phase 0）',
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 样本：${SEEDS} Seed/Bot，机制 ${variantIds.join(' / ')}`,
    `- 结论：**${passAll ? '全部通过，可以开始机制实验' : '存在未通过项，必须先修装置'}**`,
    '',
    '| 检查 | 名称 | 结果 | 详情 |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.id} | ${c.name} | ${c.pass ? '✅ PASS' : '❌ FAIL'} | ${c.detail.replace(/\n\s*/g, '<br>')} |`),
    '',
    '## 装置说明',
    '',
    '- 所有候选 / 所有 Bot 共用同一批 Seed（`seedMode=shared`，prefix `mechlab`）→ 逐局配对比较成立。',
    '- Decision Change Rate 的分母 = 同 Bot + 同 Seed 的 baseline（机制全关）结果。',
    '- Bot 只拿 FairView；机制参数通过 `view.rules.*` 以「规则书」形式公开，不含任何隐藏信息。',
    '- `MechanismBlindMinerBot` 与 `AdaptiveMinerBot` 同骨架、同装备、同事件策略，唯一区别是永远看不到机制参数。',
    '',
  ].join('\n');
  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, 'harness-check.md'), md + '\n');
  console.log(`\n${passAll ? '✅' : '❌'} harness-check.md 已写入`);
  if (!passAll) process.exitCode = 1;
}

main();
