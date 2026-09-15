/**
 * Forecast 回归检查（§53）：正式机制变化后重新跑预报梯度，确认 300/3 仍然健康。
 *
 * 判定：
 *   - AdaptiveForecast 购买率必须仍在 15%~80%（§4 的重新标定触发条件）；
 *   - Forecast ΔEV（Adaptive vs NoForecast）必须 > -5%；
 *   - ForecastAbuser 不得成为最高 EV 策略。
 * 任一被破坏 → 允许（且仅允许）对 forecast.* 做最小重新标定。
 *
 * 用法：npx tsx scripts/mechanism-lab/forecastRegression.ts --tag fcPost --extra '{}' --seeds 3000
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forecastScore } from '../forecast-lab/score';
import type { BotSummary } from '../../src/simulation/metrics';
import { readRows } from './runLab';

const OUT = 'reports/mechanism-autolab';
const FC_BOTS = ['NoForecastBot', 'LightForecastBot', 'AdaptiveForecastBot', 'HeavyForecastBot', 'ForecastAbuserBot'];

function main(): void {
  const argv = process.argv.slice(2);
  let tag = 'fcPost';
  let seeds = 3000;
  let workers = 4;
  let extra = '{}';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag') tag = argv[++i];
    else if (argv[i] === '--seeds') seeds = Number(argv[++i]);
    else if (argv[i] === '--workers') workers = Math.min(4, Number(argv[++i]));
    else if (argv[i] === '--extra') extra = argv[++i];
  }

  mkdirSync(resolve(OUT, 'raw'), { recursive: true });
  const r = spawnSync(
    process.execPath,
    [
      '--import', 'tsx', 'scripts/mechanism-lab/runLab.ts',
      '--tag', tag,
      '--variants', 'BASE',
      '--bots', FC_BOTS.join(','),
      '--seeds', String(seeds),
      '--workers', String(workers),
      '--extra', extra,
    ],
    { cwd: process.cwd(), stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('! forecast 回归运行失败');
    process.exit(1);
  }

  const rows = readRows(resolve(OUT, 'raw', `sweep-${tag}.jsonl`));
  const summaries: Record<string, BotSummary> = {};
  for (const row of rows) summaries[row.bot] = row.summary;
  const score = forecastScore({ runsPerBot: seeds, summaries });

  const none = summaries['NoForecastBot'];
  const ada = summaries['AdaptiveForecastBot'];
  const abu = summaries['ForecastAbuserBot'];
  const purchaseRate = ada?.forecast.purchaseRate ?? 0;
  const evDelta = none && none.evNetProfitAllRuns !== 0
    ? (ada.evNetProfitAllRuns - none.evNetProfitAllRuns) / Math.abs(none.evNetProfitAllRuns)
    : 0;
  const abuserIsBest = abu && ada
    ? abu.evNetProfitAllRuns >= Math.max(...Object.values(summaries).map((s) => s.evNetProfitAllRuns))
    : false;

  const checks = [
    { id: 'FC1', name: 'Adaptive 购买率 ≥ 15%', pass: purchaseRate >= 15, detail: `${purchaseRate}%` },
    { id: 'FC2', name: 'Adaptive 购买率 ≤ 80%', pass: purchaseRate <= 80, detail: `${purchaseRate}%` },
    { id: 'FC3', name: 'Forecast ΔEV > -5%', pass: evDelta > -0.05, detail: `${(evDelta * 100).toFixed(2)}%` },
    { id: 'FC4', name: 'ForecastAbuser 不是最高 EV 策略', pass: !abuserIsBest, detail: abu ? `abuser EV=${abu.evNetProfitAllRuns}` : '—' },
    { id: 'FC5', name: 'Forecast Score ≥ 70', pass: score.total >= 70, detail: `${score.total}` },
  ];
  const allPass = checks.every((c) => c.pass);

  const L: string[] = [];
  L.push('# Forecast 回归检查（正式机制落盘后）');
  L.push('');
  L.push(`- 样本：${seeds} 局 / Bot × ${FC_BOTS.length} Bot，shared seed（prefix \`mechlab\`）`);
  L.push(`- 生效覆盖：\`${extra}\``);
  L.push(`- 结论：**${allPass ? '300 / 3 仍然健康，不需要重新标定' : '⚠️ 预报机制被破坏，触发最小重新标定条件'}**`);
  L.push('');
  L.push('| 检查 | 内容 | 结果 | 实测 |');
  L.push('|---|---|:--:|---|');
  for (const c of checks) L.push(`| ${c.id} | ${c.name} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`);
  L.push('');
  L.push('## Forecast Score 明细');
  L.push('');
  L.push(`- 总分 **${score.total}**（noFc=${score.noForecastViability} div=${score.purchaseDiversity} evBal=${score.forecastEVBalance} decUtil=${score.decisionUtility} packUse=${score.packUsage} dmgEff=${score.damageEfficiency} abuse=-${score.abusePenalty} domOpen=-${score.dominantOpeningPenalty}）`);
  for (const n of score.notes) L.push(`- ${n}`);
  L.push('');
  L.push('## 预报梯度明细');
  L.push('');
  L.push('| Bot | 胜率% | EV | 购买率% | 平均包数 | 套餐使用率% | 有效预报率% | 花费 |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const b of FC_BOTS) {
    const s = summaries[b];
    if (!s) continue;
    L.push(`| ${b} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.forecast.purchaseRate} | ${s.forecast.avgPacks} | ${s.forecast.packUsageRate} | ${s.forecast.decisionUtilityRate} | ${s.forecast.avgMoneySpent} |`);
  }
  L.push('');

  const md = L.join('\n');
  if (existsSync(resolve(OUT))) writeFileSync(resolve(OUT, 'forecast-regression.md'), md + '\n');
  console.log('\n' + md);
  if (!allPass) process.exitCode = 1;
}

main();
