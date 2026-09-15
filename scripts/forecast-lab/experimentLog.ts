/**
 * 由 sweep-*.jsonl 生成 reports/forecast-autolab/experiment-log.md。
 *
 * 规则要求：每次实验都必须记录 ID / 时间 / 价格 / 次数 / 样本规模 /
 * 五个预报 Bot 的关键指标 / Score / ACCEPT 或 REJECT / 理由。
 * 失败方案也**必须**保留（不允许只写成功的）。
 *
 *   npx tsx scripts/forecast-lab/experimentLog.ts --tags b1,c1,d1
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ForecastLabResult } from './lab';

interface Args {
  tags: string[];
  out: string;
}

function parse(argv: string[]): Args {
  const a: Args = { tags: ['b1'], out: 'reports/forecast-autolab' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tags') a.tags = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  return a;
}

function verdict(r: ForecastLabResult): { ok: boolean; reasons: string[] } {
  const s = Object.fromEntries(r.summaries.map((x) => [x.bot, x]));
  const ada = s['AdaptiveForecastBot'];
  const none = s['NoForecastBot'];
  const abuser = s['ForecastAbuserBot'];
  const heavy = s['HeavyForecastBot'];
  const reasons: string[] = [];
  // 硬性拒绝条件
  if (ada.forecast.purchaseRate <= 1) reasons.push(`Adaptive 购买率 ${ada.forecast.purchaseRate}% ≈ 0：等价于天气预报不存在`);
  if (ada.forecast.purchaseRate >= 99) reasons.push(`Adaptive 购买率 ${ada.forecast.purchaseRate}% ≈ 100：变成必买，没有取舍`);
  if (abuser.evNetProfitAllRuns > Math.max(none.evNetProfitAllRuns, ada.evNetProfitAllRuns)) {
    reasons.push(`ForecastAbuser EV ${abuser.evNetProfitAllRuns} 高于对照组：滥用预报成为最优`);
  }
  if (heavy.evNetProfitAllRuns >= none.evNetProfitAllRuns) {
    reasons.push(`HeavyForecastBot EV ${heavy.evNetProfitAllRuns} ≥ NoForecast：过度囤预报没有代价`);
  }
  const delta = (ada.evNetProfitAllRuns - none.evNetProfitAllRuns) / Math.max(1, Math.abs(none.evNetProfitAllRuns));
  if (delta < -0.08) reasons.push(`Adaptive EV 比 NoForecast 低 ${(delta * 100).toFixed(1)}%：花钱买情报是净亏`);
  const ok = reasons.length === 0;
  if (ok) {
    reasons.push('无硬性拒绝条件触发');
    if (delta >= 0) reasons.push(`Adaptive EV 不低于 NoForecast（${(delta * 100).toFixed(1)}%）`);
    else reasons.push(`Adaptive EV 略低（${(delta * 100).toFixed(1)}%）但在容忍带内，可用现金成本换取伤害减少`);
    reasons.push(`有效预报率 ${ada.forecast.decisionUtilityRate}%、套餐使用率 ${ada.forecast.packUsageRate}%`);
  }
  return { ok, reasons };
}

function main(): void {
  const args = parse(process.argv.slice(2));
  const outDir = resolve(args.out);
  const rows: Array<{ file: string; r: ForecastLabResult }> = [];
  for (const tag of args.tags) {
    const f = resolve(outDir, 'raw', `sweep-${tag}.jsonl`);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push({ file: `sweep-${tag}`, r: JSON.parse(line) as ForecastLabResult });
      } catch {
        /* 忽略半行 */
      }
    }
  }
  // 按标签 + 价格排序
  rows.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.r.params.packPrice - b.r.params.packPrice ||
      a.r.params.chargesPerPack - b.r.params.chargesPerPack,
  );

  const L: string[] = [];
  L.push('# Forecast Economy Autonomous Lab — 实验日志（experiment-log）\n');
  L.push(`- 生成时间：${new Date().toISOString()}`);
  L.push('- 每次实验只改 `forecast.packPrice` / `forecast.chargesPerPack` / `forecast.autoUseOnPurchase`；');
  L.push('  其余全部参数为控制变量（`startCash` / `tentPrice` / `compassPrice` / `encounter` / `weather` / 地图 / 矿价…）。');
  L.push('- 五个 Bot **共用同一批 Seed**（同一批地图与天气），因此所有对比都是配对比较。');
  L.push('- 接受的判定口径见 `scripts/forecast-lab/score.ts` 与每条记录的「理由」。\n');

  let accepted = 0;
  let rejected = 0;
  for (const { file, r } of rows) {
    const v = verdict(r);
    if (v.ok) accepted += 1;
    else rejected += 1;
    const s = Object.fromEntries(r.summaries.map((x) => [x.bot, x]));
    const price = r.params.packPrice;
    const ch = r.params.chargesPerPack;
    const id = `${file} · P${price}C${ch}`;
    L.push(`## ${id}\n`);
    L.push(`- **时间**：${r.timestamp}`);
    L.push(`- **价格 / 次数 / 自动使用**：${price} 元 / ${ch} 次 / ${r.params.autoUseOnPurchase} 次（单价 ${(price / ch).toFixed(1)} 元每次）`);
    L.push(`- **样本规模**：每 Bot ${r.runs} 局 × ${r.bots.length} Bot = **${r.games} 局**（workers=${r.workers}，分片超时 ${r.timeouts}）`);
    L.push(`- **Forecast Score**：**${r.score.total}**（可玩性 ${r.score.noForecastViability} / 购买多样性 ${r.score.purchaseDiversity} / EV 平衡 ${r.score.forecastEVBalance} / 决策有效性 ${r.score.decisionUtility} / 套餐使用 ${r.score.packUsage} / 减伤效率 ${r.score.damageEfficiency} / 滥用罚 -${r.score.abusePenalty} / 开局罚 -${r.score.dominantOpeningPenalty}）\n`);
    L.push('| Bot | 胜率% | EV | 净收益中位(胜局) | 平均包数 | 花费 | 购买率% | 使用率% | 有效预报% | 平均耐力 | 天气伤害次数 |');
    L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const name of ['NoForecastBot', 'LightForecastBot', 'AdaptiveForecastBot', 'HeavyForecastBot', 'ForecastAbuserBot']) {
      const b = s[name];
      if (!b) continue;
      L.push(
        `| ${name} | ${b.winRate} | ${b.evNetProfitAllRuns} | ${b.finalAssetsWins.median} | ${b.forecast.avgPacks} | ${b.forecast.avgMoneySpent} | ${b.forecast.purchaseRate} | ${b.forecast.packUsageRate} | ${b.forecast.decisionUtilityRate} | ${b.avgEndStamina} | ${b.avgWeatherHits} |`,
      );
    }
    const paired = r.paired ?? {};
    const pLine = ['LightForecastBot', 'AdaptiveForecastBot', 'HeavyForecastBot', 'ForecastAbuserBot']
      .map((b) => {
        const p = paired[b];
        return p ? `${b.replace('ForecastBot', '').replace('Bot', '')}: ${p.wins}W/${p.losses}L Δ${p.avgDelta}` : null;
      })
      .filter(Boolean)
      .join(' ｜ ');
    if (pLine) L.push(`- **配对对比（vs NoForecast，同一 Seed）**：${pLine}`);
    if (r.score.notes.length) {
      L.push('- **Score 备注**：');
      for (const n of r.score.notes) L.push(`  - ${n}`);
    }
    L.push(`- **结论：${v.ok ? 'ACCEPT' : 'REJECT'}**`);
    for (const rr of v.reasons) L.push(`  - ${rr}`);
    L.push('');
  }

  L.push('---\n');
  L.push(`## 汇总\n`);
  L.push(`- 本日志共 ${rows.length} 组候选：**ACCEPT ${accepted}** / **REJECT ${rejected}**。`);
  L.push('- 失败方案（太便宜 / 太贵 / 次数过少 / 次数过多）全部保留在上面，未做删除。');

  const md = L.join('\n');
  writeFileSync(resolve(outDir, 'experiment-log.md'), md + '\n');
  console.log(`写入 ${resolve(outDir, 'experiment-log.md')}（${rows.length} 组，ACCEPT ${accepted} / REJECT ${rejected}）`);
}

main();
