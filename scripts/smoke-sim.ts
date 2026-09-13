import { runBatch } from '../src/simulation/runner';
import { ALL_BOTS, BOT_BY_NAME } from '../src/simulation/bots';
import type { RunResult } from '../src/simulation/metrics';

/**
 * v0.1.2 Smoke Simulation：
 * 每个关键 Bot × 200 Seeds，确认不崩、无死循环、地图可完成、矿价不离谱。
 * （不是平衡调参——那留给 v0.1.3）
 */

const smokeBots = ['ShortestPathBot', 'SafeBot', 'ForecastBot', 'MineABot', 'MineBBot', 'RandomBot'];
const RUNS = 200;

function summarize(name: string, results: RunResult[]) {
  const errors = results.filter((r) => r.error);
  const victories = results.filter((r) => r.status === 'VICTORY' && !r.error);
  const defeatReasons: Record<string, number> = {};
  for (const r of results) {
    if (r.error) continue;
    if (r.status === 'DEFEAT') defeatReasons[r.defeatReason ?? '?'] = (defeatReasons[r.defeatReason ?? '?'] ?? 0) + 1;
  }
  const prices = results.filter((r) => r.gemPrice !== null && !r.error).map((r) => r.gemPrice!);
  const profits = victories.map((r) => r.netProfit);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  console.log(`\n[${name}]`);
  console.log(`  error 局: ${errors.length}${errors.length ? ' ←←← 需要检查: ' + errors[0].error : ''}`);
  console.log(`  胜率: ${(victories.length / results.length * 100).toFixed(1)}%  (胜利 ${victories.length}/${results.length})`);
  console.log(`  失败原因分布: ${JSON.stringify(defeatReasons)}`);
  if (prices.length) {
    console.log(`  成交矿价: min=${Math.min(...prices)} max=${Math.max(...prices)} avg=${avg(prices)}`);
    const outOfRange = prices.filter((p) => p < 80 || p > 320);
    if (outOfRange.length) console.log(`  ←←← 矿价越界: ${outOfRange.length} 局`);
  }
  if (profits.length) console.log(`  胜局净收益: min=${Math.min(...profits)} max=${Math.max(...profits)} avg=${avg(profits)}`);
  return errors.length;
}

let totalErrors = 0;
for (const name of smokeBots) {
  const bot = BOT_BY_NAME[name];
  if (!bot) {
    console.log(`bot 不存在: ${name}（可用: ${ALL_BOTS.map((b) => b.name).join(', ')}）`);
    continue;
  }
  const results = runBatch(bot, RUNS, { seedPrefix: `smoke-v012-${name}` });
  totalErrors += summarize(name, results);
}

console.log(`\n=== SMOKE SUMMARY ===`);
console.log(`bots=${smokeBots.length} runs_per_bot=${RUNS} total_error_runs=${totalErrors}`);
console.log(totalErrors === 0 ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(totalErrors === 0 ? 0 : 1);
