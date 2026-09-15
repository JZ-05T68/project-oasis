/**
 * 读取 sweep-*.jsonl，输出详尽的 Markdown 分析（供最终报告直接引用）。
 *
 * 用法：npx tsx scripts/forecast-lab/analyze.ts --tag b1
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ForecastLabResult } from './lab';

interface Row {
  price: number;
  charges: number;
  score: number;
  none: { wr: number; ev: number; stam: number; wHits: number; wDmg: number; tents: number; tUses: number; comp: number };
  light: { wr: number; ev: number; buy: number };
  ada: {
    wr: number;
    ev: number;
    buy: number;
    packs: number;
    spent: number;
    useRate: number;
    decUtil: number;
    decUseful: number;
    dmgPer100: number;
    stamAvoid: number;
    tentAvoid: number;
    daysAvoid: number;
    stam: number;
    wHits: number;
    wDmg: number;
    tUses: number;
    comp: number;
  };
  heavy: { wr: number; ev: number; packs: number; buy: number };
  abuse: { wr: number; ev: number; packs: number; spent: number };
  notes: string[];
}

function run(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

function extract(r: ForecastLabResult): Row {
  const m: Record<string, ForecastLabResult['summaries'][number]> = Object.fromEntries(
    r.summaries.map((s) => [s.bot, s]),
  );
  const none = m['NoForecastBot'];
  const ada = m['AdaptiveForecastBot'];
  const heavy = m['HeavyForecastBot'];
  const abuse = m['ForecastAbuserBot'];
  const light = m['LightForecastBot'];
  return {
    price: r.params.packPrice,
    charges: r.params.chargesPerPack,
    score: r.score.total,
    none: {
      wr: none.winRate,
      ev: none.evNetProfitAllRuns,
      stam: none.avgEndStamina,
      wHits: none.avgWeatherHits,
      wDmg: none.avgWeatherDamage,
      tents: none.avgTentsBought,
      tUses: none.avgTentUses,
      comp: none.avgCompassUses,
    },
    light: { wr: light.winRate, ev: light.evNetProfitAllRuns, buy: light.forecast.purchaseRate },
    ada: {
      wr: ada.winRate,
      ev: ada.evNetProfitAllRuns,
      buy: ada.forecast.purchaseRate,
      packs: ada.forecast.avgPacks,
      spent: ada.forecast.avgMoneySpent,
      useRate: ada.forecast.packUsageRate,
      decUtil: ada.forecast.decisionUtilityRate,
      decUseful: ada.forecast.avgDecisionUseful,
      dmgPer100: ada.forecast.damageReductionPer100,
      stamAvoid: ada.forecast.avgStaminaLossAvoidedEstimate,
      tentAvoid: ada.forecast.avgTentsDestroyedAvoidedEstimate,
      daysAvoid: ada.forecast.avgDaysLostAvoidedEstimate,
      stam: ada.avgEndStamina,
      wHits: ada.avgWeatherHits,
      wDmg: ada.avgWeatherDamage,
      tUses: ada.avgTentUses,
      comp: ada.avgCompassUses,
    },
    heavy: { wr: heavy.winRate, ev: heavy.evNetProfitAllRuns, packs: heavy.forecast.avgPacks, buy: heavy.forecast.purchaseRate },
    abuse: { wr: abuse.winRate, ev: abuse.evNetProfitAllRuns, packs: abuse.forecast.avgPacks, spent: abuse.forecast.avgMoneySpent },
    notes: r.score.notes,
  };
}

function main(): void {
  const args = run(process.argv.slice(2));
  const tag = args.tag ?? 'b1';
  const dir = resolve(args.out ?? 'reports/forecast-autolab/raw');
  const file = resolve(dir, `sweep-${tag}.jsonl`);
  if (!existsSync(file)) throw new Error(`找不到 ${file}`);
  const rows: Row[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    rows.push(extract(JSON.parse(line) as ForecastLabResult));
  }
  rows.sort((a, b) => b.score - a.score || a.price - b.price);

  const L: string[] = [];
  L.push(`### ${tag}：全部 ${rows.length} 组，按 Forecast Score 降序\n`);
  L.push(
    '| price | charges | Score | NoFc WR | NoFc EV | Light EV | Ada WR | Ada EV | ΔEV | 购买率% | 包数 | 花费 | 使用率% | 有效预报% | 伤害/100元 | Heavy EV | Abuser EV |',
  );
  L.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const d = ((r.ada.ev - r.none.ev) / Math.max(1, Math.abs(r.none.ev))) * 100;
    L.push(
      `| ${r.price} | ${r.charges} | **${r.score}** | ${r.none.wr} | ${r.none.ev} | ${r.light.ev} | ${r.ada.wr} | ${r.ada.ev} | ${d.toFixed(1)}% | ${r.ada.buy} | ${r.ada.packs} | ${r.ada.spent} | ${r.ada.useRate} | ${r.ada.decUtil} | ${r.ada.dmgPer100} | ${r.heavy.ev} | ${r.abuse.ev} |`,
    );
  }

  // 伤害通道交叉验证表
  L.push(`\n### ${tag}：伤害通道交叉验证（Adaptive vs NoForecast 实际差值，不是估计值）\n`);
  L.push('| price | charges | Δ平均天气伤害次数 | Δ天气伤害总量 | Δ帐篷使用 | Δ指南针使用 | Δ结束耐力 | Δ胜率 |');
  L.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    L.push(
      `| ${r.price} | ${r.charges} | ${(r.ada.wHits - r.none.wHits).toFixed(3)} | ${(r.ada.wDmg - r.none.wDmg).toFixed(3)} | ${(r.ada.tUses - r.none.tUses).toFixed(3)} | ${(r.ada.comp - r.none.comp).toFixed(3)} | ${(r.ada.stam - r.none.stam).toFixed(3)} | ${(r.ada.wr - r.none.wr).toFixed(2)} |`,
    );
  }

  // 热力表
  const prices = [...new Set(rows.map((r) => r.price))].sort((a, b) => a - b);
  const charges = [...new Set(rows.map((r) => r.charges))].sort((a, b) => a - b);
  const pick = <T>(f: (r: Row) => T, fmt: (v: T | null) => string) => {
    L.push('');
    L.push(`| price \\ charges | ${charges.join(' | ')} |`);
    L.push(`|---|${charges.map(() => '---:|').join('')}`);
    for (const p of prices) {
      const cells = charges.map((c) => {
        const r = rows.find((x) => x.price === p && x.charges === c);
        return fmt(r ? f(r) : null);
      });
      L.push(`| **${p}** | ${cells.join(' | ')} |`);
    }
  };

  L.push(`\n### ${tag}：Forecast Score 热力表\n`);
  pick((r) => r.score, (v) => (v === null ? '—' : `${v}`));
  L.push(`\n### ${tag}：Adaptive 购买率 % 热力表\n`);
  pick((r) => r.ada.buy, (v) => (v === null ? '—' : `${v}`));
  L.push(`\n### ${tag}：Adaptive − NoForecast EV 差 (%) 热力表\n`);
  pick(
    (r) => ((r.ada.ev - r.none.ev) / Math.max(1, Math.abs(r.none.ev))) * 100,
    (v) => (v === null ? '—' : `${v.toFixed(1)}`),
  );
  L.push(`\n### ${tag}：有效预报率 % 热力表\n`);
  pick((r) => r.ada.decUtil, (v) => (v === null ? '—' : `${v}`));
  L.push(`\n### ${tag}：套餐使用率 % 热力表\n`);
  pick((r) => r.ada.useRate, (v) => (v === null ? '—' : `${v}`));

  L.push(`\n### ${tag}：Top 3 的说明\n`);
  for (const r of rows.slice(0, 3)) {
    L.push(
      `- **${r.price} 元 / ${r.charges} 次**（Score ${r.score}）：Adaptive 购买率 ${r.ada.buy}%、EV ${r.ada.ev}（vs NoForecast ${r.none.ev}）、有效预报率 ${r.ada.decUtil}%、套餐使用率 ${r.ada.useRate}%、每 100 元减伤 ${r.ada.dmgPer100} 点。`,
    );
    for (const n of r.notes) L.push(`  - ⚠ ${n}`);
  }

  const md = L.join('\n');
  const outFile = resolve(dir, `analysis-${tag}.md`);
  writeFileSync(outFile, md + '\n');
  console.log(md);
  console.log(`\n写入 ${outFile}`);
}

main();
