/**
 * 打印某个实验结果的关键 Markdown 表格（供报告编写时引用，不写文件）。
 * 用法：npx tsx scripts/overnight/dump.ts <label> [table...]
 *   table ∈ bot | resource | fail | mine | score | all（默认 all）
 */
import { readFileSync } from 'node:fs';
import type { BotSummary } from '../../src/simulation/metrics';

const label = process.argv[2];
if (!label) throw new Error('用法: dump.ts <label> [bot|resource|fail|mine|score|all]');
const which = process.argv[3] ?? 'all';
const j = JSON.parse(readFileSync(`reports/overnight-balance/raw/${label}.json`, 'utf-8'));
const sums: BotSummary[] = j.summaries;
const pick = (n: string) => sums.find((s) => s.bot === n);
const num = (v: number | undefined | null, d = 0) => (v ?? d).toFixed(2);

const FOCUS = [
  'ReasonablePlayerBot',
  'CautiousPlayerBot',
  'ShortestPathBot',
  'SafeBot',
  'PreparedBot',
  'GreedyMinerBot',
  'WastefulBot',
  'CheapBot',
];

if (which === 'all' || which === 'score') {
  const s = j.score;
  console.log(`\n### ${label} · Score = ${s.total}`);
  console.log('| 分量 | 权重 | 得分 |');
  console.log('| --- | --- | --- |');
  console.log(`| reasonableViability | 30 | ${num(s.reasonableViability)} |`);
  console.log(`| strategyDiversity | 20 | ${num(s.strategyDiversity)} |`);
  console.log(`| economicHealth | 15 | ${num(s.economicHealth)} |`);
  console.log(`| resourceRelevance | 15 | ${num(s.resourceRelevance)} |`);
  console.log(`| failureDiversity | 10 | ${num(s.failureDiversity)} |`);
  console.log(`| mineChoiceBalance | 10 | ${num(s.mineChoiceBalance)} |`);
  console.log(`| exploitPenalty | 减法 | -${num(s.exploitPenalty)} |`);
  console.log('');
  for (const n of s.notes) console.log(`- ${n}`);
}

if (which === 'all' || which === 'bot') {
  console.log(`\n### ${label} · Bot 数据表（${j.games} 局）`);
  console.log('| Bot | 局数 | 胜率% | EV | 成功局中位资产 | p10 | 平均结束天 | 平均剩余耐力 | 平均挖矿天 | 主要失败原因 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const name of [...FOCUS, ...sums.map((s: BotSummary) => s.bot).filter((b: string) => !FOCUS.includes(b))]) {
    const s = pick(name);
    if (!s) continue;
    const fr = s.failureRates as unknown as Record<string, number>;
    const top = Object.entries(fr).sort((a, b) => b[1] - a[1])[0];
    console.log(
      `| ${s.bot} | ${s.runs} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.finalAssetsWins.median} | ${s.finalAssetsWins.p10} | ${num(s.avgDaysUsed)} | ${num(s.avgEndStamina)} | ${num(s.avgMiningDays)} | ${top[1] > 0 ? `${top[0]} ${top[1]}%` : '—'} |`,
    );
  }
}

if (which === 'all' || which === 'resource') {
  console.log(`\n### ${label} · 资源使用`);
  console.log('| Bot | 帐篷购买 | 帐篷使用 | 指南针购买 | 指南针使用 | 预报包 | 绿洲修整率% | 遭遇次数 | 遭遇率% | 绿洲格经过 | 村庄格经过 | 天气伤害次数 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of sums) {
    console.log(
      `| ${s.bot} | ${num(s.avgTentsBought)} | ${num(s.avgTentUses)} | ${num(s.avgCompassesBought)} | ${num(s.avgCompassUses)} | ${num(s.avgForecastPacks)} | ${num(s.restRate)} | ${num(s.avgEncounters)} | ${num(s.encounterRate)} | ${num(s.avgOasisVisits)} | ${num(s.avgVillageVisits)} | ${num(s.avgWeatherHits)} |`,
    );
  }
}

if (which === 'all' || which === 'fail') {
  console.log(`\n### ${label} · 失败原因分布（占全部局 %）`);
  console.log('| Bot | TIMEOUT | STAMINA_EXHAUSTED | RETURN_ROUTE_SEVERED | TRAPPED |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const s of sums) {
    const fr = s.failureRates as unknown as Record<string, number>;
    console.log(`| ${s.bot} | ${num(fr.TIMEOUT)} | ${num(fr.STAMINA_EXHAUSTED)} | ${num(fr.RETURN_ROUTE_SEVERED)} | ${num(fr.TRAPPED)} |`);
  }
}

if (which === 'all' || which === 'mine') {
  console.log(`\n### ${label} · 两矿选择`);
  console.log('| Bot | Mine A % | Mine B % |');
  console.log('| --- | --- | --- |');
  for (const s of sums) {
    console.log(`| ${s.bot} | ${num(s.mineSlotShare['A'])} | ${num(s.mineSlotShare['B'])} |`);
  }
}
