/** 汇总 sweep jsonl：按 Score 排序输出关键指标表（报告与决策都靠它）。 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readRows } from './runEconLab';
import type { EconSweepRow } from './runEconLab';

const LAB_DIR = 'reports/economic-independence-lab';

function main(): void {
  const tag = process.argv[2] ?? 'phaseA';
  const botFilter = process.argv[3];
  const file = join(resolve(LAB_DIR, 'raw'), `sweep-${tag}.jsonl`);
  if (!existsSync(file)) {
    console.error(`找不到 ${file}`);
    process.exit(1);
  }
  const rows = readRows(file).filter((r) => !botFilter || r.bot === botFilter);
  rows.sort((a, b) => b.score.score - a.score.score);
  console.log(`# ${tag}（${rows.length} 行）\n`);
  console.log(
    '| 候选 | Bot | 局数 | 完成% | 盈利% | 成功局盈利% | 成功亏损(总)% | gap | 求援% | 求援局盈利% | Δ决策% | EV | Score |',
  );
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const m = r.metrics;
    console.log(
      `| ${m.variant} | ${m.bot} | ${m.runs} | ${m.completionRate} | ${m.profitableRate} | ${m.profitAmongCompleted} | ` +
      `${m.overallCompletedLossShare} | ${m.gapPP} | ${m.rescue.useRate} | ${m.rescue.profitabilityAmongRescued} | ` +
      `${m.dc.overall} | ${r.summary.evNetProfitAllRuns} | ${r.score.score}${r.score.rejected ? ' ✗ ' + r.score.rejectReason : ''} |`,
    );
  }
  // 失败结构
  console.log('\n## 失败结构与会计\n');
  console.log('| 候选 | 首要失败原因 | 占比% | 会计违规 | 最大残差 |');
  console.log('|---|---|---:|---:|---:|');
  for (const r of rows) {
    const m = r.metrics;
    console.log(`| ${m.variant} | ${m.topFailureReason} | ${m.topFailureShare} | ${m.accountingViolations} | ${m.maxResidual} |`);
  }
  void (undefined as unknown as EconSweepRow);
  void readFileSync;
}

main();
