/**
 * 帐篷价格专项扫描（§22 / §23 / §52）。
 *
 * 硬约束（用户指定）：
 *   3 × tentPrice <= 2000   （3 顶买得起）
 *   4 × tentPrice >  2000   （4 顶开局买不起）
 * → 搜索区间 500 ~ 650（500 满足 3×500=1500≤2000 且 4×500=2000 不 >2000，故 500 是边界值，
 *   真正满足严格约束的下限是 501；500 作为"刚好卡线"的对照保留在表里）。
 *
 * 评分用 TentPriceScore（choiceDiversity + antiWasteful + survivalTradeoff + economyHealth），
 * **刻意不最大化任一 Bot 的胜率**。
 *
 * 用法：npx tsx scripts/mechanism-lab/tentScan.ts --seeds 1200 --workers 4
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tentPriceScore } from './score';
import { readRows, type SweepRow } from './runLab';

const OUT = 'reports/mechanism-autolab';

export const TENT_PRICES = [500, 525, 550, 575, 600, 625, 650, 700];

const TENT_BOTS = [
  'ReasonablePlayerBot',
  'ReasonableMechBot',
  'PreparedBot',
  'WastefulBot',
  'CheapBot',
  'CautiousPlayerBot',
  'SafeBot',
  'ShortestPathBot',
  'GreedyMinerBot',
  'AdaptiveForecastBot',
];

interface Args {
  seeds: number;
  workers: number;
  prices: number[];
  /** 附加机制覆盖（帐篷价格必须在**候选机制生效**的前提下标定，否则联动会被漏掉） */
  extra: Record<string, unknown>;
  skipRun: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = { seeds: 1200, workers: 4, prices: TENT_PRICES, extra: {}, skipRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--seeds') a.seeds = Number(argv[++i]);
    else if (k === '--workers') a.workers = Math.max(1, Math.min(4, Number(argv[++i])));
    else if (k === '--prices') a.prices = argv[++i].split(',').map((s) => Number(s.trim()));
    else if (k === '--extra') a.extra = JSON.parse(argv[++i]) as Record<string, unknown>;
    else if (k === '--skipRun') a.skipRun = true;
  }
  return a;
}

export interface TentRow {
  price: number;
  feas3: boolean;
  feas4: boolean;
  score: ReturnType<typeof tentPriceScore>;
  /** 各 Bot 的关键指标 */
  perBot: Record<
    string,
    {
      winRate: number;
      ev: number;
      avgTents: number;
      avgCompasses: number;
      equipmentWasteRate: number;
      avgEquipmentSpent: number;
      staminaDeath: number;
      timeout: number;
      restRate: number;
    }
  >;
  tentDistribution: Record<string, number>;
}

function mergeExtra(base: Record<string, unknown>, add: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(add)) {
    const prev = out[k];
    if (prev && typeof prev === 'object' && v && typeof v === 'object') {
      const merged: Record<string, unknown> = { ...(prev as object) };
      for (const [k2, v2] of Object.entries(v as object)) {
        const p2 = merged[k2];
        merged[k2] = p2 && typeof p2 === 'object' && v2 && typeof v2 === 'object' ? { ...(p2 as object), ...(v2 as object) } : v2;
      }
      out[k] = merged;
    } else out[k] = v;
  }
  return out;
}

function main(): void {
  const args = parse(process.argv.slice(2));
  mkdirSync(resolve(OUT, 'raw'), { recursive: true });

  if (!args.skipRun) for (const price of args.prices) {
    const tag = `tent${price}`;
    console.log(`\n=== 帐篷单价 ${price} 元 ===`);
    const r = spawnSync(
      process.execPath,
      [
        '--import', 'tsx', 'scripts/mechanism-lab/runLab.ts',
        '--tag', tag,
        '--variants', 'BASE',
        '--bots', TENT_BOTS.join(','),
        '--seeds', String(args.seeds),
        '--workers', String(args.workers),
        '--extra', JSON.stringify(mergeExtra(args.extra, { tentPrice: price })),
      ],
      { cwd: process.cwd(), stdio: 'inherit' },
    );
    if (r.status !== 0) console.error(`  ! 价格 ${price} 运行失败（退出码 ${r.status}）`);
  }

  /* ---- 汇总 ---- */
  const rows: TentRow[] = [];
  for (const price of args.prices) {
    const sweep = readRows(resolve(OUT, 'raw', `sweep-tent${price}.jsonl`));
    if (sweep.length === 0) {
      console.error(`  ! 缺少 tent${price} 的 sweep 结果，跳过`);
      continue;
    }
    const summaries: Record<string, SweepRow['summary']> = {};
    const perBot: TentRow['perBot'] = {};
    const tentDistribution: Record<string, number> = {};
    for (const row of sweep) {
      summaries[row.bot] = row.summary;
      perBot[row.bot] = {
        winRate: row.summary.winRate,
        ev: row.summary.evNetProfitAllRuns,
        avgTents: row.summary.avgTentsBought,
        avgCompasses: row.summary.avgCompassesBought,
        equipmentWasteRate: row.summary.equipmentWasteRate,
        avgEquipmentSpent: row.summary.avgEquipmentSpent,
        staminaDeath: row.summary.failureRates.STAMINA_EXHAUSTED,
        timeout: row.summary.failureRates.TIMEOUT,
        restRate: row.summary.restRate,
      };
      const bucket = row.summary.avgTentsBought.toFixed(1);
      tentDistribution[bucket] = (tentDistribution[bucket] ?? 0) + 1;
    }
    const score = tentPriceScore({ tentPurchaseDistribution: tentDistribution, summaries });
    rows.push({
      price,
      feas3: 3 * price <= 2000,
      feas4: 4 * price > 2000,
      score,
      perBot,
      tentDistribution,
    });
  }

  /* ---- Markdown ---- */
  const L: string[] = [];
  L.push('# 帐篷价格专项扫描（TentPriceScore）');
  L.push('');
  L.push(`- 样本：每价格 ${args.seeds} 局 × ${TENT_BOTS.length} Bot = ${args.seeds * TENT_BOTS.length} 局`);
  L.push('- 控制变量：除 `tentPrice` 外全部配置不变；所有价格共用同一批 Seed（prefix `mechlab`）。');
  L.push('- 硬约束：`3×P ≤ 2000` 且 `4×P > 2000`。');
  L.push('');
  L.push('| 价格 | 3顶买得起 | 4顶买不起 | TentScore | 多样 | 反浪费 | 生存取舍 | 经济 | 说明 |');
  L.push('|---:|:--:|:--:|---:|---:|---:|---:|---:|---|');
  for (const r of rows) {
    L.push(
      `| ${r.price} | ${r.feas3 ? '✅' : '❌'} | ${r.feas4 ? '✅' : '❌'} | **${r.score.total}** | ${r.score.parts.choiceDiversity} | ${r.score.parts.antiWasteful} | ${r.score.parts.survivalTradeoff} | ${r.score.parts.economyHealth} | ${r.score.notes.slice(0, 2).join('；') || '—'} |`,
    );
  }
  L.push('');
  L.push('## 逐 Bot 明细');
  L.push('');
  const botNames = [...new Set(rows.flatMap((r) => Object.keys(r.perBot)))];
  L.push(`| Bot | ${rows.map((r) => r.price).join(' | ')} |`);
  L.push(`|---|${rows.map(() => '---:').join('|')}|`);
  for (const metric of ['winRate', 'ev', 'avgTents', 'equipmentWasteRate', 'staminaDeath', 'timeout'] as const) {
    const label =
      metric === 'winRate'
        ? '胜率%'
        : metric === 'ev'
          ? 'EV'
          : metric === 'avgTents'
            ? '平均买帐篷'
            : metric === 'equipmentWasteRate'
              ? '装备浪费率%'
              : metric === 'staminaDeath'
                ? '耐力死亡%'
                : '超时%';
    for (const bot of botNames) {
      L.push(`| ${bot} · ${label} | ${rows.map((r) => r.perBot[bot]?.[metric] ?? '—').join(' | ')} |`);
    }
  }
  L.push('');
  L.push('## 帐篷购买分布（各价格下「平均购买帐篷数」的取值分布）');
  L.push('');
  L.push('| 价格 | 分布 |');
  L.push('|---:|---|');
  for (const r of rows) {
    L.push(`| ${r.price} | ${Object.entries(r.tentDistribution).map(([k, v]) => `${k}顶×${v}Bot`).join('，')} |`);
  }
  L.push('');
  const md = L.join('\n');
  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, 'tent-price-scan.md'), md + '\n');
  writeFileSync(resolve(OUT, 'raw', 'tent-scan.json'), JSON.stringify(rows, null, 2));
  console.log('\n' + md);
}

main();
