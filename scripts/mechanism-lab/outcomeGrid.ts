/**
 * Phase B 参数网格速览：打印「参数点 → Completion / Profitability / 成功后盈利 / EV / 用率」，
 * 重点验证「高价求援能否打破 Completion ≈ Profitability 锁死（§18）」。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'reports/outcome-mechanism-lab/raw';
const file = process.argv[2] ?? 'sweep-phaseB-rescue.jsonl';
const bot = process.argv[3] ?? 'OutcomeMasterBot';

const p = path.join(DIR, file);
if (!fs.existsSync(p)) {
  console.error('无文件', p);
  process.exit(1);
}
const rows = fs
  .readFileSync(p, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const base = rows.find((r) => r.variant === 'BASE' && r.bot === bot);
const baseEv = base?.summary.evNetProfitAllRuns ?? 0;

const mine = rows.filter((r) => r.bot === bot && r.variant !== 'BASE');
mine.sort((a, b) => {
  const ao = a.metrics?.outcome;
  const bo = b.metrics?.outcome;
  return (ao?.profitAmongCompleted ?? 0) - (bo?.profitAmongCompleted ?? 0);
});

console.log(`=== ${file} / ${bot}（按「成功后盈利率」升序）===`);
console.log('variant\tcomp%\tprof%\tpAc%\t亏损成功局%\t成功局median\tEV\tdc%\tuse%');
for (const r of mine) {
  const o = r.metrics?.outcome;
  const m = r.metrics;
  const useRate = Math.max(m?.rescueUseRate ?? 0, m?.surgeUseRate ?? 0, m?.villageServiceRate ?? 0);
  console.log(
    [
      r.variant,
      o?.completionRate?.toFixed(2) ?? '-',
      o?.profitableRate?.toFixed(2) ?? '-',
      o?.profitAmongCompleted?.toFixed(1) ?? '-',
      o?.survivedUnprofitableRate?.toFixed(2) ?? '-',
      o?.profitCompleted?.median?.toFixed(0) ?? '-',
      (r.summary.evNetProfitAllRuns ?? 0).toFixed(0),
      m?.dc?.overall?.toFixed(1) ?? '-',
      useRate.toFixed(1),
    ].join('\t'),
  );
}
console.log(`\n基线 EV = ${baseEv.toFixed(0)}`);
console.log(`基线 Completion = ${base?.metrics?.outcome?.completionRate}%`);
