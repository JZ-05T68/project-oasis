/**
 * v0.2.0 机制冒烟 worker：**一个进程 = 一个 override**（gameConfig 在模块加载时读 env，
 * 所以同一进程内无法切换 override）。
 *
 * 用法：OASIS_CONFIG_OVERRIDE='{...}' npx tsx scripts/mechanism-lab/outcomeSmoke.ts \
 *         --bots OutcomeMasterBot,OutcomeBlindBot --seeds 300 --prefix outcome-smoke
 *
 * 输出一行 JSON：每个 Bot 的遥测计数与 Outcome 分层。
 */
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runBatchSeeds } from '../../src/simulation/runner';
import { aggregateBot } from '../../src/simulation/metrics';

interface Args {
  bots: string[];
  seeds: number;
  prefix: string;
}

function parse(argv: string[]): Args {
  const a: Args = { bots: [], seeds: 300, prefix: 'outcome-smoke' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--bots') a.bots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--seeds') a.seeds = Number(argv[++i]);
    else if (k === '--prefix') a.prefix = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

const args = parse(process.argv.slice(2));
const seeds = Array.from({ length: args.seeds }, (_, i) => `${args.prefix}:${i}`);

const out: Record<string, unknown> = {};
for (const name of args.bots) {
  const bot = BOT_BY_NAME[name];
  if (!bot) throw new Error(`未知 Bot: ${name}`);
  const rs = runBatchSeeds(bot, seeds, 0);
  const s = aggregateBot(rs);
  const n = Math.max(1, rs.length);
  out[name] = {
    completion: s.outcome.completionRate,
    profitable: s.outcome.profitableRate,
    profitAmongCompleted: s.outcome.profitAmongCompleted,
    failed: s.outcome.failedRate,
    survivedUnprofitable: s.outcome.survivedUnprofitableRate,
    highProfit: s.outcome.highProfitRate,
    ev: s.evNetProfitAllRuns,
    medianProfitAll: s.outcome.profitAll.median,
    staminaDeath: s.failureRates.STAMINA_EXHAUSTED,
    timeout: s.failureRates.TIMEOUT,
    severed: s.failureRates.RETURN_ROUTE_SEVERED,
    trapped: s.failureRates.TRAPPED,
    // 机制行为痕迹
    villageServices: round2(rs.reduce((a, r) => a + (r.villageServicesUsed ?? 0), 0) / n),
    villageSpent: round2(rs.reduce((a, r) => a + (r.villageServiceSpent ?? 0), 0) / n),
    villageRate: round2((rs.filter((r) => (r.villageServicesUsed ?? 0) > 0).length / n) * 100),
    surgeUses: round2(rs.reduce((a, r) => a + (r.surgeMiningUses ?? 0), 0) / n),
    surgeRate: round2((rs.filter((r) => (r.surgeMiningUses ?? 0) > 0).length / n) * 100),
    rescueUses: round2(rs.reduce((a, r) => a + (r.emergencyRescues ?? 0), 0) / n),
    rescueRate: round2((rs.filter((r) => (r.emergencyRescues ?? 0) > 0).length / n) * 100),
    intelTiles: round2(rs.reduce((a, r) => a + (r.returnIntelTiles ?? 0), 0) / n),
    dropRate: round2((rs.filter((r) => (r.droppedKg ?? 0) > 0).length / n) * 100),
    avgMiningDays: s.avgMiningDays,
    errors: s.errors,
  };
}
process.stdout.write(JSON.stringify(out));
process.stderr.write('smoke-done\n');

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
