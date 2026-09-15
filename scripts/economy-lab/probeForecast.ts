/**
 * G9 专项：天气预报在当前正式配置下还**买得起**吗？
 *
 * 本轮的 Bot 梯度（EconMasterBot 等）沿用既有装备策略，本身从不购买天气预报，
 * 因此 sweep 里的 forecastBuyRate 恒为 0% —— 那是**Bot 的构造**，不是游戏结论。
 * 这里改用会买预报的 Bot 单独探测，判断"帐篷涨价后是否还买得起预报"。
 */
import { runBatchSeeds } from '../../src/simulation/runner';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { gameConfig } from '../../src/game/config/gameConfig';

const N = Number(process.argv[2] ?? 400);
console.log(
  `tentPrice=${gameConfig.tentPrice}  forecast.packPrice=${gameConfig.forecast.packPrice}  startCash=${gameConfig.startCash}`,
);
for (const name of ['AdaptiveForecastBot', 'HeavyForecastBot', 'ReasonablePlayerBot']) {
  const bot = BOT_BY_NAME[name];
  if (!bot) {
    console.log(`  跳过 ${name}（不存在）`);
    continue;
  }
  const rs = runBatchSeeds(bot, Array.from({ length: N }, (_, i) => `econ-fc:${i}`));
  const buyRate = (rs.filter((r) => (r.forecastPacks ?? 0) > 0).length / rs.length) * 100;
  const avgCashLeft = rs.reduce((a, r) => a + r.cashRemaining, 0) / rs.length;
  const avgEquip = rs.reduce((a, r) => a + r.equipmentSpent, 0) / rs.length;
  console.log(
    `  ${name}  预报购买率=${buyRate.toFixed(1)}%  平均装备支出=${avgEquip.toFixed(0)}  平均返城现金=${avgCashLeft.toFixed(0)}`,
  );
}
