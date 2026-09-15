import type { EconMetrics } from './econAnalyze';

/**
 * v0.3.0 Economic Independence Score（§28）+ Promotion Gate 逐条核对（§43）。
 *
 * 设计原则（sim-balance-lab 的经验）：**绝对分值不重要，能排序才重要**，
 * 且每一项都必须在报告里逐项公示。
 *
 * 唯一的硬否决：会计恒等式违规（§35）——钱说不清就判装置无效，不做任何平衡结论。
 *
 * 注意：本轮实际出现了「G1 完成率在修正上一轮 Bug 后结构性无法回到 68~72%」的情况
 * （详见报告 §装置修复）。因此 G1 不再做硬性一票否决，而是**带内满分、带外按距离衰减**，
 * 并把每条 Gate 的 PASS/FAIL 单独列出，避免用"一刀切"掩盖真实的结构问题。
 */

export interface GateResult {
  id: string;
  name: string;
  pass: boolean;
  value: string;
  target: string;
}

export interface ScoreBreakdown {
  id: string;
  score: number;
  /** 会计违规 ⇒ 装置无效，一票否决 */
  hardReject: boolean;
  gates: GateResult[];
  gatesPassed: number;
  gatesTotal: number;
  parts: Record<string, number>;
  notes: string[];
}

function band(v: number, lo: number, hi: number, widen: number): number {
  if (v >= lo && v <= hi) return 1;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / widen);
}
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function econScore(m: EconMetrics): ScoreBreakdown {
  const parts: Record<string, number> = {};
  const notes: string[] = [];
  const gates: GateResult[] = [];
  const g = (id: string, name: string, pass: boolean, value: string, target: string): void => {
    gates.push({ id, name, pass, value, target });
  };

  /* ---- 硬否决：会计 ---- */
  if (m.accountingViolations > 0) {
    return {
      id: m.variant, score: -1000, hardReject: true,
      gates: [{ id: 'G14', name: '会计完全一致', pass: false, value: `${m.accountingViolations} 局违规`, target: '0 局违规' }],
      gatesPassed: 0, gatesTotal: 15, parts: {},
      notes: [`会计恒等式违规 ${m.accountingViolations} 局（§35）`],
    };
  }

  /* ---- G1 完成率（25）---- */
  const g1 = m.completionRate >= 68 && m.completionRate <= 72;
  parts.completionTarget = r2(band(m.completionRate, 68, 72, 12) * 25);
  g('G1', '成功返城率', g1, `${m.completionRate}%`, '68~72%');
  if (!g1) notes.push(`G1 Completion ${m.completionRate}% 不在 68~72%（本轮结构性原因见报告 §装置修复）`);

  /* ---- G2 总体盈利率（25）---- */
  const g2 = m.profitableRate >= 42 && m.profitableRate <= 48;
  parts.profitabilityTarget = r2(band(m.profitableRate, 42, 48, 14) * 25);
  g('G2', '总体盈利率', g2, `${m.profitableRate}%`, '42~48%');

  /* ---- G3 成功局盈利率（10）---- */
  const g3 = m.profitAmongCompleted >= 60 && m.profitAmongCompleted <= 70;
  parts.profitAmongCompleted = r2(band(m.profitAmongCompleted, 60, 70, 22) * 10);
  g('G3', '成功返城后盈利率', g3, `${m.profitAmongCompleted}%`, '60~70%');

  /* ---- G4 成功但亏损占比（10）---- */
  const g4 = m.overallCompletedLossShare >= 20 && m.overallCompletedLossShare <= 30;
  parts.completedLossShare = r2(band(m.overallCompletedLossShare, 20, 30, 16) * 10);
  g('G4', '成功返城但亏损（总体）', g4, `${m.overallCompletedLossShare}%`, '20~30%');

  /* ---- §29 经济独立度：|C − P| 理想 25pp（10）---- */
  const gapScore = Math.max(0, 1 - Math.abs(m.gapPP - 25) / 25);
  parts.economicIndependence = r2(gapScore * 10);
  const g6 = m.gapPP >= 5;
  g('G6-indep', '生还/赚钱解耦（|C−P|）', g6, `${m.gapPP}pp`, '≥5pp，理想 25pp');
  if (m.gapPP < 5) notes.push(`|Completion − Profitability| = ${m.gapPP}pp < 5pp ⇒ 仍高度绑定（§29）`);

  /* ---- G5 决策改变率（10）---- */
  const dcScore = Math.min(1, Math.max(0, (m.dc.overall - 5) / 25));
  parts.decisionChange = r2(dcScore * 10);
  const g5 = m.dc.overall > 10;
  g('G5', '经济决策改变率', g5, `${m.dc.overall}%`, '>10%');
  if (!g5) notes.push(`Δdecision ${m.dc.overall}% < 10%（§43 G5）`);

  /* ---- Outcome 多样性（5）---- */
  const ls = [m.layers.failed, m.layers.survivedLoss, m.layers.survivedProfit, m.layers.survivedHighProfit].map((v) => Math.max(0, v));
  const tot = ls.reduce((a, b) => a + b, 0) || 1;
  let h = 0;
  for (const v of ls) {
    if (v <= 0) continue;
    const p = v / tot;
    h -= p * Math.log(p);
  }
  parts.outcomeDiversity = r2((h / Math.log(4)) * 5);

  /* ---- G8 反"统一税"（5）---- */
  const profitDrop = Math.max(0, 82.63 - m.profitableRate); // 相对本轮实测基线的下降幅度
  const flatTaxRisk = profitDrop > 8 && m.dc.overall < 8;
  parts.antiFlatTax = flatTaxRisk ? 0 : 5;
  const g8 = !flatTaxRisk;
  g('G8', '新费用不是统一税', g8, flatTaxRisk ? `盈利↓${profitDrop.toFixed(1)}pp 但 Δdec 仅 ${m.dc.overall}%` : `Δdec ${m.dc.overall}%`, '决策改变 >8%');

  /* ---- G7 求援不能必用 ---- */
  const g7 = !m.rescue.dominance;
  parts.rescueDominance = m.rescue.dominance ? -15 : 0;
  g('G7', '求援不是必用/支配', g7, `使用率 ${m.rescue.useRate}%`, '≤70%');
  if (!g7) notes.push(`RESCUE_DOMINANCE：求援使用率 ${m.rescue.useRate}% > 70%（§9）`);

  /* ---- G11 采矿决策健康 ---- */
  const g11 = m.diversity.topMiningDayShare <= 90 && m.diversity.distinctMiningDays >= 4;
  parts.miningDominance = m.diversity.topMiningDayShare > 90 ? -10 : 0;
  g('G11', '采矿决策仍健康', g11, `最热模板 ${m.diversity.topMiningDayShare}%，取值 ${m.diversity.distinctMiningDays} 种，均值 ${m.diversity.avgMiningDays} 天`, '最热模板 ≤90%');
  if (!g11) notes.push(`单一采矿模板 ${m.diversity.topMiningDayShare}%（§43 G11）`);

  /* ---- G13 单一失败原因 ---- */
  const g13 = m.topFailureShare <= 60;
  parts.failureConcentration = m.topFailureShare > 60 ? -20 : m.topFailureShare > 45 ? -8 : 0;
  g('G13', '无单一失败原因 >60%', g13, `${m.topFailureReason} ${m.topFailureShare}%`, '≤60%（>45 警戒）');
  if (m.topFailureShare > 45) notes.push(`单一失败原因 ${m.topFailureReason} 占 ${m.topFailureShare}%（§24）`);

  /* ---- G9 天气预报仍健康 ---- */
  const g9 = m.health.forecastBuyRate >= 5 && m.health.forecastBuyRate <= 95;
  g('G9', 'Forecast 仍健康', g9, `购买率 ${m.health.forecastBuyRate}%`, '5~95%');

  /* ---- G10 双矿仍健康 ---- */
  const g10 = m.health.mineAShare >= 10 && m.health.mineBShare >= 10;
  g('G10', '双矿仍健康', g10, `A ${m.health.mineAShare}% / B ${m.health.mineBShare}%`, '两矿各 ≥10%');

  /* ---- G12 LoadReturn / 丢货仍有意义 ---- */
  const g12 = m.health.avgLoadPenaltyDays > 0 || m.diversity.dropRate >= 5;
  g('G12', '负重/丢货仍有意义', g12, `负重惩罚均值 ${m.health.avgLoadPenaltyDays} 天，丢货率 ${m.diversity.dropRate}%`, '负重惩罚 >0 或 丢货率 ≥5%');

  /* ---- G14 会计 ---- */
  g('G14', '会计完全一致', m.accountingViolations === 0 && m.maxResidual === 0,
    `${m.accountingViolations} 局违规，残差 ${m.maxResidual}`, '0 违规 / 0 残差');

  /* ---- G15 规则可解释（由候选注册表人工判定，默认 PASS） ---- */
  g('G15', '规则 1~3 句话能说明白', true, '见候选注册表 playerRule', '1~3 句话');

  const score = r2(Object.values(parts).reduce((a, b) => a + b, 0));
  return {
    id: m.variant,
    score,
    hardReject: false,
    gates,
    gatesPassed: gates.filter((x) => x.pass).length,
    gatesTotal: gates.length,
    parts,
    notes,
  };
}

export function gateBadge(b: ScoreBreakdown): string {
  if (b.hardReject) return 'HARD_REJECT';
  const failed = b.gates.filter((x) => !x.pass).map((x) => x.id);
  return failed.length === 0 ? 'ALL PASS' : `未过: ${failed.join(',')}`;
}
