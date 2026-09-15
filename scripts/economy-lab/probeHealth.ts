/** 快速体检：装备/情报购买行为、采矿天数、失败结构。用法: probeHealth.ts <tag> [tag2...] */
import { join, resolve } from 'node:path';
import { readRows } from './runEconLab';

const LAB_DIR = 'reports/economic-independence-lab';
for (const tag of process.argv.slice(2)) {
  for (const r of readRows(join(resolve(LAB_DIR, 'raw'), `sweep-${tag}.jsonl`))) {
    const m = r.metrics;
    console.log(
      tag.padEnd(9),
      m.variant.padEnd(16),
      `comp=${String(m.completionRate).padStart(5)}`,
      `prof=${String(m.profitableRate).padStart(5)}`,
      `fc=${String(m.health.forecastBuyRate).padStart(5)}%`,
      `equip=${String(m.waterfall.equipmentSpend).padStart(4)}`,
      `tent=${r.summary.tentsBought}`,
      `cmp=${r.summary.compassesBought}`,
      `mineD=${m.diversity.avgMiningDays}`,
      `gem=${m.health.avgGemsKg}`,
      `days=${m.health.avgDaysUsed}`,
      `upkeep=${m.waterfall.operatingCost}`,
      `fail=${m.topFailureReason}:${m.topFailureShare}%`,
    );
  }
}
