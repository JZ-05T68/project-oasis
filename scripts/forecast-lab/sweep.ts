/**
 * Forecast Economy Autonomous Lab —— 批量扫描器（Phase B / C）。
 *
 * 逐组运行 packPrice × chargesPerPack，结果逐行追加到
 *   reports/forecast-autolab/raw/sweep-<tag>.jsonl
 * 支持断点续跑：已存在的 (price, charges, auto) 组合会跳过。
 *
 * 用法：
 *   npx tsx scripts/forecast-lab/sweep.ts --tag b1 --runs 400 --workers 4 \
 *     --prices 50,100,150,200,250,300,350,400,500 --charges 2,3,4,5,6,8
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runForecastExperiment, type ForecastLabResult } from './lab';

interface Args {
  tag: string;
  runs: number;
  workers: number;
  prices: number[];
  charges: number[];
  auto: number;
  out: string;
  timeout: number;
  extra: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    tag: 'b1',
    runs: 400,
    workers: 4,
    prices: [50, 100, 150, 200, 250, 300, 350, 400, 500],
    charges: [2, 3, 4, 5, 6, 8],
    auto: 1,
    out: 'reports/forecast-autolab/raw',
    timeout: 120,
    extra: '{}',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tag') a.tag = argv[++i];
    else if (k === '--runs') a.runs = Number(argv[++i]);
    else if (k === '--workers') a.workers = Math.max(1, Number(argv[++i]));
    else if (k === '--prices') a.prices = argv[++i].split(',').map(Number);
    else if (k === '--charges') a.charges = argv[++i].split(',').map(Number);
    else if (k === '--auto') a.auto = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--timeout') a.timeout = Math.max(10, Number(argv[++i]));
    else if (k === '--extra') a.extra = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

function keyOf(r: { price: number; charges: number; auto: number }): string {
  return `${r.price}/${r.charges}/${r.auto}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const jsonl = resolve(outDir, `sweep-${args.tag}.jsonl`);

  const done = new Map<string, ForecastLabResult>();
  if (existsSync(jsonl)) {
    for (const line of readFileSync(jsonl, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as ForecastLabResult;
        const k = keyOf({
          price: r.params.packPrice,
          charges: r.params.chargesPerPack,
          auto: r.params.autoUseOnPurchase,
        });
        done.set(k, r);
      } catch {
        /* 忽略半行 */
      }
    }
    console.log(`[sweep-${args.tag}] 已存在 ${done.size} 组结果，将跳过`);
  }

  const combos: Array<{ price: number; charges: number }> = [];
  for (const p of args.prices) for (const c of args.charges) combos.push({ price: p, charges: c });

  let n = 0;
  for (const combo of combos) {
    n += 1;
    const k = keyOf({ ...combo, auto: args.auto });
    if (done.has(k)) {
      console.log(`[${n}/${combos.length}] 跳过 ${k}`);
      continue;
    }
    console.log(`\n=== [${n}/${combos.length}] price=${combo.price} charges=${combo.charges} ===`);
    const res = await runForecastExperiment({
      label: `${args.tag}-p${combo.price}-c${combo.charges}`,
      price: combo.price,
      charges: combo.charges,
      auto: args.auto,
      runs: args.runs,
      workers: args.workers,
      timeout: args.timeout,
      globalTimeout: 600,
      bots: [
        'NoForecastBot',
        'LightForecastBot',
        'AdaptiveForecastBot',
        'HeavyForecastBot',
        'ForecastAbuserBot',
      ],
      out: args.out,
      uiConsistency: 1,
      extra: args.extra,
    });
    appendFileSync(jsonl, JSON.stringify(res) + '\n');
    done.set(k, res);
  }

  // 汇总热力表
  const all = [...done.values()].sort(
    (x, y) => y.score.total - x.score.total,
  );
  const head =
    '| price | charges | Score | NoFc WR | NoFc EV | Adaptive WR | Adaptive EV | 购买率% | 包数 | 使用率% | 有效预报% | Heavy EV | Abuser EV |';
  const sep = '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rows = all.map((r) => {
    const m: Record<string, (typeof r.summaries)[number]> = Object.fromEntries(
      r.summaries.map((s) => [s.bot, s]),
    );
    const none = m['NoForecastBot'];
    const ada = m['AdaptiveForecastBot'];
    return `| ${r.params.packPrice} | ${r.params.chargesPerPack} | **${r.score.total}** | ${none.winRate} | ${none.evNetProfitAllRuns} | ${ada.winRate} | ${ada.evNetProfitAllRuns} | ${ada.forecast.purchaseRate} | ${ada.forecast.avgPacks} | ${ada.forecast.packUsageRate} | ${ada.forecast.decisionUtilityRate} | ${m['HeavyForecastBot'].evNetProfitAllRuns} | ${m['ForecastAbuserBot'].evNetProfitAllRuns} |`;
  });
  const md = [head, sep, ...rows].join('\n');
  writeFileSync(resolve(outDir, `heatmap-${args.tag}.md`), md + '\n');
  console.log('\n' + md);
  console.log(`\n[sweep-${args.tag}] 共 ${all.length} 组，热力表写入 ${resolve(outDir, `heatmap-${args.tag}.md`)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
