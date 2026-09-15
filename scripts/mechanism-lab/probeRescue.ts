import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runBatchSeeds } from '../../src/simulation/runner';
import { aggregateBot, aggregateOutcome } from '../../src/simulation/metrics';
const N = 400;
const seeds = Array.from({length: N}, (_, i) => `outcome:${i}`);
for (const name of ['OutcomeMasterBot','RescueOnlyBot','OutcomeBlindBot']) {
  const bot = BOT_BY_NAME[name];
  if (!bot) { console.log('missing', name); continue; }
  const rs = runBatchSeeds(bot, seeds, 0);
  const s = aggregateBot(rs); const o = aggregateOutcome(rs);
  const n = rs.length;
  console.log(JSON.stringify({
    bot: name, comp: o.completionRate, prof: o.profitableRate, among: o.profitAmongCompleted,
    ev: s.evNetProfitAllRuns, medAll: o.profitAll.median, medComp: o.profitCompleted.median,
    p10Comp: o.profitCompleted.p10, highProfit: o.highProfitRate, threshold: o.highProfitThreshold,
    stamina: s.failureRates.STAMINA_EXHAUSTED, timeout: s.failureRates.TIMEOUT, severed: s.failureRates.RETURN_ROUTE_SEVERED,
    rescueRate: Math.round(rs.filter(r => (r.emergencyRescues ?? 0) > 0).length / n * 10000)/100,
    avgDays: s.avgDaysUsed, avgMining: s.avgMiningDays, avgGems: s.avgGemsKgWins,
  }));
}
