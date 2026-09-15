import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runBatchSeeds } from '../../src/simulation/runner';
import { aggregateBot, aggregateOutcome } from '../../src/simulation/metrics';
const N = 600;
const seeds = Array.from({length: N}, (_, i) => `outcome:${i}`);
const bot = BOT_BY_NAME['OutcomeMasterBot'];
const rs = runBatchSeeds(bot, seeds, 0);
const s = aggregateBot(rs); const o = aggregateOutcome(rs);
console.log('=== 成功局利润分布（当前机制全关） ===');
console.log(JSON.stringify(o.profitCompleted));
console.log('全部局分布:', JSON.stringify(o.profitAll));
console.log('avgGemsKg(成功局) =', s.avgGemsKgWins, ' avgGemPrice ≈ 收入/kg');
// 成功局的收入结构
const wins = rs.filter(r => (r.expeditionCompleted ?? r.status==='VICTORY'));
const revs = wins.map(r => r.gemRevenue);
const spent = wins.map(r => 2000 - r.cashRemaining + r.equipmentSpent);
console.log('成功局平均宝石收入 =', Math.round(revs.reduce((a,b)=>a+b,0)/wins.length));
console.log('成功局平均总支出 =', Math.round(spent.reduce((a,b)=>a+b,0)/wins.length));
console.log('成功局平均装备支出 =', Math.round(wins.reduce((a,r)=>a+r.equipmentSpent,0)/wins.length));
// 若要把 profitAmongCompleted 压到 ~64%，需要在成功局里平均多花多少钱？
const target = 0.64;
const need = [...wins].sort((a,b)=>a.netProfit-b.netProfit);
const idx = Math.floor(wins.length * (1 - target));
console.log('要把成功后盈利率压到 64%，需要让', wins.length - idx, '个成功局（', Math.round((wins.length-idx)/wins.length*100), '%）变成亏损');
console.log('对应需要在这些局里多花 ≈', need[idx].netProfit, '元（第', idx, '个百分位的净利润）');
