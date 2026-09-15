/**
 * Phase 2 —— 现有数值二次扫描（Secondary Numeric Scan）。
 *
 * 只扫「上一轮没有充分测试、且与天气预报候选环境共存」的少量参数，
 * 每组都是**单变量**对照；其它所有参数（含最终预报配置）作为控制变量。
 *
 *   npx tsx scripts/secondary-lab/scan.ts --group workpay --runs 600 --workers 4
 *
 * 输出：reports/forecast-autolab/secondary-<group>.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateBot, aggregateEvents, type BotSummary, type RunResult } from '../../src/simulation/metrics';
import { runSharded, tmpDirFor } from '../lib/shard';
import { gameConfig } from '../../src/game/config/gameConfig';

interface Args {
  group: string;
  runs: number;
  workers: number;
  out: string;
  timeout: number;
  base: string;
  forecastPrice: number;
  forecastCharges: number;
  /** 只跑指定 label（逗号分隔），便于把长扫描切成小批次 */
  only: string;
}

function parse(argv: string[]): Args {
  const a: Args = {
    group: 'workpay',
    runs: 600,
    workers: 4,
    out: 'reports/forecast-autolab',
    timeout: 150,
    base: '{}',
    forecastPrice: gameConfig.forecast.packPrice,
    forecastCharges: gameConfig.forecast.chargesPerPack,
    only: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--group') a.group = argv[++i];
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--workers') a.workers = Math.max(1, Number(argv[++i]));
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--timeout') a.timeout = Math.max(30, Number(argv[++i]));
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--forecastPrice') a.forecastPrice = Number(argv[++i]);
    else if (k === '--forecastCharges') a.forecastCharges = Number(argv[++i]);
    else if (k === '--only') a.only = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

/** 每组候选：label + 单变量覆盖 */
interface Candidate {
  label: string;
  patch: Record<string, unknown>;
  /** 该组的展示用参数说明 */
  desc: string;
}

/**
 * 二次数值扫描的关注 Bot：
 *  - ReasonablePlayerBot：真人代理基线（不打工）
 *  - VillageWorkerBot：同配置但会考虑「市集打工」——村庄打工专项的单变量对照
 *  - AdaptiveForecastBot / NoForecastBot：确保「在最新预报环境下」评估
 * 只留少量 Bot 是为了在单变量对照下把样本做厚，而不是铺开成 5 个 Bot 的浅样本。
 */
const BOTS = ['ReasonablePlayerBot', 'VillageWorkerBot', 'AdaptiveForecastBot', 'NoForecastBot'];

function groupCandidates(group: string): Candidate[] {
  switch (group) {
    case 'workpay':
      return [500, 600, 700, 800, 900, 1000].map((v) => ({
        label: `workPay-${v}`,
        patch: { workPay: v },
        desc: `workPay = ${v}`,
      }));
    case 'sandstorm':
      return [1, 2].map((v) => ({
        label: `sandstorm-${v}`,
        patch: { weather: { sandstorm: { staminaCost: v } } },
        desc: `weather.sandstorm.staminaCost = ${v}`,
      }));
    case 'drought':
      return [0.1, 0.15, 0.2, 0.25, 0.3, 0.35].map((v) => ({
        label: `drought-${v}`,
        patch: { oasisDroughtChance: v },
        desc: `oasisDroughtChance = ${v}`,
      }));
    case 'thief':
      return [0.3, 0.4, 0.5, 0.6, 0.7].map((v) => ({
        label: `thief-${v}`,
        patch: { encounter: { villageThiefRatio: v } },
        desc: `encounter.villageThiefRatio = ${v}`,
      }));
    case 'jitter':
      return [
        { label: 'jitter-095-105', patch: { mineValuation: { jitterMin: 0.95, jitterMax: 1.05 } }, desc: 'jitter 0.95~1.05' },
        { label: 'jitter-090-110', patch: { mineValuation: { jitterMin: 0.9, jitterMax: 1.1 } }, desc: 'jitter 0.90~1.10（当前）' },
        { label: 'jitter-085-115', patch: { mineValuation: { jitterMin: 0.85, jitterMax: 1.15 } }, desc: 'jitter 0.85~1.15' },
      ];
    case 'rowgap':
      return [2, 3, 4].map((v) => ({
        label: `rowgap-${v}`,
        patch: { map: { mineMinRowGap: v } },
        desc: `map.mineMinRowGap = ${v}`,
      }));
    case 'terrain':
      return [
        { label: 'terrain-base', patch: {}, desc: '当前 0.40/0.30/0.20/0.10' },
        { label: 'terrain-village25', patch: { terrainProbability: { GRASS: 0.4, DESERT: 0.3, VILLAGE: 0.2, OASIS: 0.1 } }, desc: '基准重复（自洽校验）' },
        { label: 'terrain-village+5', patch: { terrainProbability: { GRASS: 0.37, DESERT: 0.28, VILLAGE: 0.25, OASIS: 0.1 } }, desc: '村庄 +5pp，草地/沙漠各 -2pp/-3pp' },
        { label: 'terrain-oasis+5', patch: { terrainProbability: { GRASS: 0.37, DESERT: 0.28, VILLAGE: 0.2, OASIS: 0.15 } }, desc: '绿洲 +5pp，草地 -3pp / 沙漠 -2pp' },
        { label: 'terrain-desert-5', patch: { terrainProbability: { GRASS: 0.42, DESERT: 0.25, VILLAGE: 0.23, OASIS: 0.1 } }, desc: '沙漠 -5pp，草地 +2pp / 村庄 +3pp' },
      ];
    default:
      throw new Error(`未知 group: ${group}`);
  }
}

function deepMerge<T>(base: T, patch: unknown): T {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out as T;
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.round((xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) * 100) / 100;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(resolve(outDir, 'raw'), { recursive: true });
  const forecastBase = {
    forecast: {
      packPrice: args.forecastPrice,
      chargesPerPack: args.forecastCharges,
      autoUseOnPurchase: 1,
      maxDaysCost: 0,
    },
  };
  const extraBase = JSON.parse(args.base) as Record<string, unknown>;

  const allCandidates = groupCandidates(args.group);
  const onlySet = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null;
  const candidates = onlySet ? allCandidates.filter((c) => onlySet.has(c.label)) : allCandidates;
  const rows: Array<{ label: string; desc: string; override: string; results: Map<string, RunResult[]>; summaries: Record<string, BotSummary> }> = [];

  for (const c of candidates) {
    const overrideObj = deepMerge(deepMerge(forecastBase, c.patch), extraBase);
    const override = JSON.stringify(overrideObj);
    const tmp = tmpDirFor(outDir, `${args.group}-${c.label}`);
    let last = 0;
    const results = await runSharded({
      bots: BOTS,
      override,
      runs: args.runs,
      workers: args.workers,
      timeout: args.timeout,
      tmpDir: tmp,
      prefix: 'sec',
      onProgress: (d, t) => {
        if (d - last >= 8 || d === t) {
          last = d;
          process.stdout.write(`\r[${args.group}/${c.label}] ${d}/${t} 分片 `);
        }
      },
    });
    process.stdout.write('\n');
    const summaries: Record<string, BotSummary> = {};
    for (const b of BOTS) summaries[b] = aggregateBot(results.get(b) ?? []);
    rows.push({ label: c.label, desc: c.desc, override, results, summaries });
  }

  const L: string[] = [];
  L.push(`# Secondary Numeric Scan — ${args.group}\n`);
  L.push(`- 每候选 ${args.runs} 局 × ${BOTS.length} Bot = ${args.runs * BOTS.length} 局`);
  L.push(`- 控制变量：固定最终天气预报配置 packPrice=${args.forecastPrice} / chargesPerPack=${args.forecastCharges}，其余全部参数不变\n`);

  if (args.group === 'workpay') {
    L.push('| workPay | Bot | 打工局占比% | 平均打工天数 | 打工收入均值 | 平均采矿天数 | 胜率% | EV |');
    L.push('|---:|---|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const s = r.summaries[b];
        const workRate = Math.round(((r.results.get(b) ?? []).filter((x) => (x.villageWorkDays ?? 0) > 0).length / Math.max(1, s.runs)) * 10000) / 100;
        L.push(`| ${r.desc} | ${b} | ${workRate} | ${s.avgVillageWorkDays} | ${s.avgVillageWorkIncome} | ${s.avgMiningDays} | ${s.winRate} | ${s.evNetProfitAllRuns} |`);
      }
    }
  } else if (args.group === 'sandstorm') {
    L.push('| 参数 | Bot | 胜率% | EV | 耐力死亡占比% | 平均买帐篷 | 平均天气伤害次数 | 平均结束耐力 | CV 胜率% |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const s = r.summaries[b];
        L.push(`| ${r.desc} | ${b} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.failureRates.STAMINA_EXHAUSTED} | ${s.avgTentsBought} | ${s.avgWeatherHits} | ${s.avgEndStamina} | — |`);
      }
    }
  } else if (args.group === 'drought') {
    L.push('| 参数 | Bot | 平均绿洲经过 | 修整率% | 平均结束耐力 | 胜率% | EV |');
    L.push('|---|---|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const s = r.summaries[b];
        L.push(`| ${r.desc} | ${b} | ${s.avgOasisVisits} | ${s.restRate} | ${s.avgEndStamina} | ${s.winRate} | ${s.evNetProfitAllRuns} |`);
      }
    }
  } else if (args.group === 'thief') {
    L.push('| 参数 | Bot | 盗贼次数/千局 | 市集次数/千局 | 盗贼现金均值 | 平均村庄经过 | 胜率% | EV |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const rs = r.results.get(b) ?? [];
        const ev = aggregateEvents(rs);
        const thief = ev.find((e) => e.kind === 'THIEF');
        const market = ev.find((e) => e.kind === 'MARKET');
        const s = r.summaries[b];
        L.push(`| ${r.desc} | ${b} | ${thief?.per1000 ?? 0} | ${market?.per1000 ?? 0} | ${thief?.avgCashDelta ?? 0} | ${s.avgVillageVisits} | ${s.winRate} | ${s.evNetProfitAllRuns} |`);
      }
    }
  } else if (args.group === 'jitter') {
    L.push('| 参数 | Bot | 胜率% | EV | 利润方差 | p10 资产 | p90 资产 | 极端盈利率%(>=p95) | 极端亏损率%(<=-1000) |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const rs = r.results.get(b) ?? [];
        const s = r.summaries[b];
        const profits = rs.map((x) => x.netProfit).sort((a, c) => a - c);
        const p95 = profits.length ? profits[Math.min(profits.length - 1, Math.floor(profits.length * 0.95))] : 0;
        const extHigh = profits.length ? Math.round((profits.filter((p) => p >= p95).length / profits.length) * 10000) / 100 : 0;
        const extLoss = profits.length ? Math.round((profits.filter((p) => p <= -1000).length / profits.length) * 10000) / 100 : 0;
        L.push(`| ${r.desc} | ${b} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${variance(profits)} | ${s.finalAssetsWins.p10} | ${s.finalAssetsWins.p90} | ${extHigh} | ${extLoss} |`);
      }
    }
  } else if (args.group === 'rowgap') {
    L.push('| 参数 | Bot | 两矿选择 A/B % | 胜率% | EV | 平均采矿天数 | 平均路线分 |');
    L.push('|---|---|---|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const s = r.summaries[b];
        L.push(`| ${r.desc} | ${b} | ${JSON.stringify(s.mineSlotShare)} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.avgMiningDays} | ${s.avgRouteScore} |`);
      }
    }
  } else if (args.group === 'terrain') {
    L.push('| 参数 | Bot | 平均村庄经过 | 平均绿洲经过 | 平均天气伤害次数 | 平均遭遇次数 | 胜率% | EV |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
      for (const b of BOTS) {
        const s = r.summaries[b];
        L.push(`| ${r.desc} | ${b} | ${s.avgVillageVisits} | ${s.avgOasisVisits} | ${s.avgWeatherHits} | ${s.avgEncounters} | ${s.winRate} | ${s.evNetProfitAllRuns} |`);
      }
    }
  }

  const md = L.join('\n');
  const suffix = args.only ? `-${args.only.replace(/,/g, '_')}` : '';
  writeFileSync(resolve(outDir, `secondary-${args.group}${suffix}.md`), md + '\n');
  writeFileSync(
    resolve(outDir, 'raw', `secondary-${args.group}${suffix}.json`),
    JSON.stringify(
      rows.map((r) => ({ label: r.label, desc: r.desc, override: JSON.parse(r.override), summaries: r.summaries })),
      null,
      2,
    ),
  );
  console.log(md);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
