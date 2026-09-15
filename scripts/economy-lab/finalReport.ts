/**
 * 生成 §62~§67 需要的全部数据块（第一屏 / 四层分布 / 瀑布 / 利润分布 / 归因 / Gate 清单）。
 * 用法：npx tsx scripts/economy-lab/finalReport.ts <tag> <variant> [bot]
 */
import { join, resolve } from 'node:path';
import { readRows } from './runEconLab';
import { gateBadge } from './econScore';

const LAB_DIR = 'reports/economic-independence-lab';

function main(): void {
  const tag = process.argv[2];
  const variant = process.argv[3];
  const bot = process.argv[4] ?? 'EconMasterBot';
  if (!tag || !variant) throw new Error('用法: finalReport.ts <tag> <variant> [bot]');
  const file = join(resolve(LAB_DIR, 'raw'), `sweep-${tag}.jsonl`);
  const rows = readRows(file).filter((r) => r.variant === variant && r.bot === bot);
  if (rows.length === 0) throw new Error(`${file} 里没有 ${variant}/${bot}`);
  const r = rows[rows.length - 1];
  const m = r.metrics;

  const out: string[] = [];
  const p = (s: string) => out.push(s);

  p(`### ${variant} / ${bot}（${tag}，${m.runs} 局）`);
  p('');
  p('**一级指标（含 95% CI）**');
  p('');
  p('| 指标 | 值 | 95% CI | 目标 |');
  p('|---|---:|---|---|');
  p(`| 成功返城率 Completion | ${m.completionRate}% | [${m.ci.completion[0]}, ${m.ci.completion[1]}] | 68~72% |`);
  p(`| 总体盈利率 Profitability | ${m.profitableRate}% | [${m.ci.profitability[0]}, ${m.ci.profitability[1]}] | 42~48% |`);
  p(`| 成功返城后盈利率 | ${m.profitAmongCompleted}% | [${m.ci.profitAmongCompleted[0]}, ${m.ci.profitAmongCompleted[1]}] | 60~70% |`);
  p(`| 成功返城但亏损（总体） | ${m.overallCompletedLossShare}% | [${m.ci.completedLossShare[0]}, ${m.ci.completedLossShare[1]}] | 20~30% |`);
  p(`| 成功返城但亏损（成功局口径） | ${m.completedLossShare}% | — | — |`);
  p(`| 保本占比 | ${m.breakEvenShare}% | — | — |`);
  p(`| \\|Completion − Profitability\\| | ${m.gapPP}pp | — | 理想 ≈25pp，<5pp 扣分 |`);
  p('');

  p('**§63 四层 Outcome 分布（占全部开局）**');
  p('');
  p('| 层 | 占比 | 目标 |');
  p('|---|---:|---|');
  p(`| 远征失败 | ${m.layers.failed}% | 28~32% |`);
  p(`| 成功返城但亏损/保本 | ${m.layers.survivedLoss}% | 22~28% |`);
  p(`| 成功返城且普通盈利（≤3000） | ${m.layers.survivedProfit}% | — |`);
  p(`| 成功返城且高收益（>3000） | ${m.layers.survivedHighProfit}% | — |`);
  p('');

  p('**§64 经济瀑布（均值，元）**');
  p('');
  const groups: Array<[string, string]> = [
    ['all', '所有局'],
    ['completedProfit', '成功盈利局'],
    ['completedLoss', '成功亏损局'],
    ['rescued', '求援局'],
    ['nonRescued', '非求援局'],
  ];
  p('| 项 | ' + groups.map(([, n]) => n).join(' | ') + ' |');
  p('|---|' + groups.map(() => '---:').join('|') + '|');
  const wfKeys: Array<[string, string]> = [
    ['initialCash', '初始资金'],
    ['tripCashFlow', '旅途中现金净变动'],
    ['grossGemRevenue', '宝石销售毛收入'],
    ['lateSaleLoss', '逾期折价'],
    ['rescueSettlement', '求援结算费'],
    ['operatingCost', '远征运营成本'],
    ['otherSettlement', '运输/佣金/鉴定'],
    ['settlementExpenses', '结算期费用合计'],
    ['finalCash', '最终现金'],
    ['netProfit', '净利润'],
  ];
  for (const [k, label] of wfKeys) {
    p(`| ${label} | ` + groups.map(([g]) => String((m.groups[g] as unknown as Record<string, number>)[k] ?? 0)).join(' | ') + ' |');
  }
  p(`| 平均总天数 | ` + groups.map(([g]) => String(m.groups[g].daysUsed)).join(' | ') + ' |');
  p(`| 平均采矿天数 | ` + groups.map(([g]) => String(m.groups[g].miningDays)).join(' | ') + ' |');
  p(`| 平均载货 kg | ` + groups.map(([g]) => String(m.groups[g].gemsKg)).join(' | ') + ' |');
  p(`| 局数 | ` + groups.map(([g]) => String(m.groups[g].n)).join(' | ') + ' |');
  p('');

  p('**途中现金分解（所有局均值，元）**');
  p('');
  p('| 项 | 金额 |');
  p('|---|---:|');
  p(`| 装备支出 | ${m.waterfall.equipmentSpend} |`);
  p(`| 天气预报 | ${m.waterfall.forecastSpend} |`);
  p(`| 村庄服务 | ${m.waterfall.villageSpend} |`);
  p(`| 求援当场支付 | ${m.waterfall.rescueImmediateSpend} |`);
  p(`| 事件等其它渠道净变动 | ${m.waterfall.otherCashDelta} |`);
  p(`| 求援结算：固定债务 | ${m.waterfall.rescueDeferredDebt} |`);
  p(`| 求援结算：收入抽成 | ${m.waterfall.rescueRevenueShare} |`);
  p(`| 运输费 | ${m.waterfall.transportCost} |`);
  p(`| 销售佣金 | ${m.waterfall.commissionCost} |`);
  p(`| 鉴定费 | ${m.waterfall.appraisalFee} |`);
  p('');

  p('**§65 成功局净利润分布（元）**');
  p('');
  p('| min | p10 | p25 | median | p75 | p90 | max | mean |');
  p('|---:|---:|---:|---:|---:|---:|---:|---:|');
  p(`| ${m.profitDist.min} | ${m.profitDist.p10} | ${m.profitDist.p25} | ${m.profitDist.median} | ${m.profitDist.p75} | ${m.profitDist.p90} | ${m.profitDist.max} | ${m.profitDist.mean} |`);
  p('');
  p(`成功但亏损局：n=${m.lossDist.n}，平均亏损 ${m.lossDist.mean} 元，中位亏损 ${m.lossDist.median} 元，最大亏损 ${m.lossDist.max} 元。`);
  p('');

  p('**§9 求援使用与支配检查**');
  p('');
  p('| 项 | 值 |');
  p('|---|---:|');
  p(`| 求援使用率（全部开局） | ${m.rescue.useRate}% |`);
  p(`| 求援局完成率 | ${m.rescue.completionAmongRescued}% |`);
  p(`| 求援局盈利率 | ${m.rescue.profitabilityAmongRescued}% |`);
  p(`| 非求援局完成率 | ${m.rescue.completionAmongNonRescued}% |`);
  p(`| 非求援局盈利率 | ${m.rescue.profitabilityAmongNonRescued}% |`);
  p(`| 求援平均固定债务 / 抽成 | ${m.rescue.avgDebt} / ${m.rescue.avgShare} 元 |`);
  p(`| RESCUE_DOMINANCE（>70%） | ${m.rescue.dominance ? '**是**' : '否'} |`);
  p('');

  p('**§27 谁在亏钱（成功但亏损局的归因）**');
  p('');
  p(`成功亏损局共 ${m.lossAttribution.n} 个：`);
  p('');
  p('| 原因 | 占比 |');
  p('|---|---:|');
  p(`| 求援结算费用 | ${m.lossAttribution.rescuedShare}% |`);
  p(`| 远征时间过长 | ${m.lossAttribution.longTripShare}% |`);
  p(`| 装备投入过大 | ${m.lossAttribution.heavyEquipmentShare}% |`);
  p(`| 其它 | ${m.lossAttribution.otherShare}% |`);
  p('');

  p('**决策与机制健康度**');
  p('');
  p('| 项 | 值 |');
  p('|---|---:|');
  p(`| Δ决策（相对基线） | ${m.dc.overall}% |`);
  p(`| 其中：采矿天数改变 | ${m.dc.mining}% |`);
  p(`| 其中：求援使用改变 | ${m.dc.rescue}% |`);
  p(`| 结局翻转（完成↔失败） | ${m.dc.outcomeFlip}% |`);
  p(`| 盈亏翻转 | ${m.dc.profitFlip}% |`);
  p(`| 平均采矿天数 | ${m.diversity.avgMiningDays}（${m.diversity.distinctMiningDays} 种取值，最热模板 ${m.diversity.topMiningDayShare}%） |`);
  p(`| 丢货率 | ${m.diversity.dropRate}% |`);
  p(`| 天气预报购买率 | ${m.health.forecastBuyRate}% |`);
  p(`| 双矿使用 A/B | ${m.health.mineAShare}% / ${m.health.mineBShare}% |`);
  p(`| 负重惩罚均值 | ${m.health.avgLoadPenaltyDays} 天 |`);
  p(`| 首要失败原因 | ${m.topFailureReason} ${m.topFailureShare}% |`);
  p(`| EV（全口径净收益均值） | ${r.summary.evNetProfitAllRuns} |`);
  p('');

  p('**§43 Promotion Gate 逐条**');
  p('');
  p('| Gate | 名称 | 结果 | 实测 | 目标 |');
  p('|---|---|---|---|---|');
  for (const gg of r.score.gates) {
    p(`| ${gg.id} | ${gg.name} | ${gg.pass ? '✅ PASS' : '❌ FAIL'} | ${gg.value} | ${gg.target} |`);
  }
  p('');
  p(`Score = **${r.score.score}**（${r.score.gatesPassed}/${r.score.gatesTotal} 条 Gate 通过）${gateBadge(r.score)}`);
  p('');
  p(`生效覆盖：\`${r.override}\``);
  p('');

  console.log(out.join('\n'));
}

main();
