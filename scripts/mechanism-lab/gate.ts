/**
 * Promotion Gate 判定器（§30）。
 *
 * 逐条核对 8 项条件，输出「候选 × 条件」矩阵与最终裁决。
 * 只有全部通过的候选才可以 PROMOTE TO PRODUCTION。
 *
 * 用法：npx tsx scripts/mechanism-lab/gate.ts --tags phaseA,phaseB,phaseC --candidates M11,M09
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VARIANT_BY_ID } from './mechs';
import { readRows, type SweepRow } from './runLab';

const OUT = 'reports/mechanism-autolab';

export interface GateResult {
  candidate: string;
  label: string;
  checks: Array<{ id: string; name: string; pass: boolean; detail: string }>;
  pass: boolean;
  reason: string;
}

/** Gate 判定的「合理玩家代理」：读过新规则书的合理玩家（见 mechanismBots.ReasonableMechBot） */
const GATE_BOT = 'ReasonableMechBot';
const ADAPTIVE_BOT = 'AdaptiveMinerBot';

export function evaluateGate(
  variant: string,
  row: SweepRow | undefined,
  adaptive: SweepRow | undefined,
  base: SweepRow | undefined,
  baseAdaptive: SweepRow | undefined,
  meta: { complexityOk: boolean; explainSentences: number },
): GateResult {
  const checks: GateResult['checks'] = [];
  const label = VARIANT_BY_ID[variant]?.label ?? variant;

  if (!row || !base) {
    return { candidate: variant, label, checks: [{ id: 'G0', name: '数据存在', pass: false, detail: '缺少 sweep 结果' }], pass: false, reason: '缺少数据' };
  }

  const dcMining = adaptive?.metrics.dc.mining ?? 0;
  const dcOverall = adaptive?.metrics.dc.overall ?? 0;
  const winRate = row.summary.winRate;
  const stam = row.summary.failureRates.STAMINA_EXHAUSTED;
  const ev = row.summary.evNetProfitAllRuns;
  const baseEv = base.summary.evNetProfitAllRuns;
  const topShare = adaptive?.metrics.topMiningDayShare ?? 100;
  const distinct = adaptive?.metrics.distinctMiningDays ?? 1;
  const slotShare = row.summary.mineSlotShare;
  const baseSlotShare = base.summary.mineSlotShare;
  const errors = row.summary.errors + (adaptive?.summary.errors ?? 0);

  // 1. 决策改变率显著 > 0
  checks.push({
    id: 'G1',
    name: 'Decision Change Rate 显著 > 0（采矿 ≥15% 视为有意义）',
    pass: dcMining >= 15,
    detail: `采矿决策改变率 ${dcMining}%（整体 ${dcOverall}%）`,
  });
  // 2. 没有支配策略
  checks.push({
    id: 'G2',
    name: '没有支配策略（最热采矿模板 ≤90% 且取值 ≥4 种）',
    pass: topShare <= 90 && distinct >= 4,
    detail: `最热模板 ${topShare}%，不同采矿天数 ${distinct} 种`,
  });
  // 3. 合理玩家胜率健康区 65~90%
  checks.push({
    id: 'G3',
    name: '合理玩家（懂新规则）胜率落在 65%~90%',
    pass: winRate >= 65 && winRate <= 90,
    detail: `${GATE_BOT} 胜率 ${winRate}%（基线 ${base.summary.winRate}%）`,
  });
  // 4. 耐力死亡不失控
  checks.push({
    id: 'G4',
    name: 'STAMINA_EXHAUSTED ≤ 40%（>50% 直接拒绝）',
    pass: stam <= 40,
    detail: `${stam}%（基线 ${base.summary.failureRates.STAMINA_EXHAUSTED}%）`,
  });
  // 5. 不破坏 Forecast 机制 —— 结构上：机制没有改动 forecast.* 的任何字段
  const touchedForecast = JSON.stringify(VARIANT_BY_ID[variant]?.patch ?? {}).includes('forecast');
  checks.push({
    id: 'G5a',
    name: '未改动 forecast.* 配置字段',
    pass: !touchedForecast,
    detail: touchedForecast ? 'patch 里含 forecast 覆盖' : 'patch 不含 forecast 覆盖',
  });
  // 6. 不破坏双矿选择：两矿被选中的比例不能退化到 0
  const slotA = slotShare['A'] ?? 0;
  const slotB = slotShare['B'] ?? 0;
  const baseA = baseSlotShare['A'] ?? 0;
  const baseB = baseSlotShare['B'] ?? 0;
  checks.push({
    id: 'G6',
    name: '双矿选择仍然存在（A / B 都有人去，且相对基线没有塌到 0）',
    pass: slotA > 0 && slotB > 0 && baseA > 0 && baseB > 0,
    detail: `A/B = ${slotA}% / ${slotB}%（基线 ${baseA}% / ${baseB}%）`,
  });
  // 7. 收益结构健康
  const ratio = baseEv === 0 ? 1 : ev / baseEv;
  checks.push({
    id: 'G7',
    name: '收益结构健康（EV > 0 且不低于基线的 70%）',
    pass: ev > 0 && ratio >= 0.7,
    detail: `EV ${ev}（基线 ${baseEv}，比值 ${ratio.toFixed(2)}）`,
  });
  // 8. 复杂度可控
  checks.push({
    id: 'G8',
    name: '规则复杂度可控（≤1 状态变量 / ≤1 公式 / ≤1 按钮）且可用 1~3 句说清',
    pass: meta.complexityOk && meta.explainSentences <= 3,
    detail: `预算合规=${meta.complexityOk}，解释句数=${meta.explainSentences}`,
  });
  // 兜底：无框架错误
  checks.push({ id: 'G9', name: '无框架错误（errors = 0）', pass: errors === 0, detail: `errors=${errors}` });

  const pass = checks.every((c) => c.pass);
  const failed = checks.filter((c) => !c.pass);
  return {
    candidate: variant,
    label,
    checks,
    pass,
    reason: pass ? 'PROMOTE' : failed.map((f) => f.id).join(',') + ' 未通过：' + failed.map((f) => f.name).join('；'),
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const tags: string[] = [];
  let candidates: string[] = [];
  let explainFile = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tags') tags.push(...argv[++i].split(',').map((s) => s.trim()));
    else if (argv[i] === '--candidates') candidates = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--explain') explainFile = argv[++i];
  }
  const rows: SweepRow[] = [];
  for (const t of tags) {
    const f = resolve(OUT, 'raw', `sweep-${t}.jsonl`);
    if (existsSync(f)) rows.push(...readRows(f));
  }
  const best = new Map<string, SweepRow>();
  for (const r of rows) {
    const k = `${r.variant}|${r.bot}`;
    const p = best.get(k);
    if (!p || r.runs > p.runs) best.set(k, r);
  }
  const explains: Record<string, number> = explainFile && existsSync(explainFile)
    ? (JSON.parse(readFileSync(explainFile, 'utf-8')) as Record<string, number>)
    : {};

  if (candidates.length === 0) candidates = [...new Set(rows.map((r) => r.variant))].filter((v) => v !== 'BASE');

  const results: GateResult[] = [];
  for (const c of candidates) {
    const meta = VARIANT_BY_ID[c]?.complexity ?? { stateVars: 0, formulas: 1, buttons: 1 };
    results.push(
      evaluateGate(
        c,
        best.get(`${c}|${GATE_BOT}`) ?? best.get(`${c}|${ADAPTIVE_BOT}`),
        best.get(`${c}|${ADAPTIVE_BOT}`),
        best.get(`BASE|${GATE_BOT}`) ?? best.get(`BASE|${ADAPTIVE_BOT}`),
        best.get(`BASE|${ADAPTIVE_BOT}`),
        { complexityOk: meta.stateVars <= 1 && meta.formulas <= 1 && meta.buttons <= 1, explainSentences: explains[c] ?? 2 },
      ),
    );
  }

  const L: string[] = [];
  L.push('# Promotion Gate 判定（§30）');
  L.push('');
  L.push('| 候选 | 名称 | G1 决策改变 | G2 无支配 | G3 胜率带 | G4 耐力 | G5 预报 | G6 双矿 | G7 收益 | G8 复杂度 | G9 无错 | 裁决 |');
  L.push('|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|');
  for (const r of results) {
    const cell = (id: string, alt?: string) => {
      const c = r.checks.find((x) => x.id === id) ?? r.checks.find((x) => x.id === alt);
      return c ? (c.pass ? '✅' : '❌') : '—';
    };
    L.push(
      `| ${r.candidate} | ${r.label} | ${cell('G1')} | ${cell('G2')} | ${cell('G3')} | ${cell('G4')} | ${cell('G5a', 'G5')} | ${cell('G6')} | ${cell('G7')} | ${cell('G8')} | ${cell('G9')} | ${r.pass ? '**PROMOTE**' : 'REJECT'} |`,
    );
  }
  L.push('');
  L.push('## 逐条明细');
  L.push('');
  for (const r of results) {
    L.push(`### ${r.candidate} — ${r.label}`);
    L.push('');
    L.push(`**${r.pass ? 'PASS' : 'FAIL'}**：${r.reason}`);
    L.push('');
    L.push('| 条件 | 内容 | 结果 | 实测 |');
    L.push('|---|---|:--:|---|');
    for (const c of r.checks) L.push(`| ${c.id} | ${c.name} | ${c.pass ? '✅' : '❌'} | ${c.detail} |`);
    L.push('');
  }

  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, 'promotion-gate.md'), L.join('\n') + '\n');
  writeFileSync(resolve(OUT, 'raw', 'gate.json'), JSON.stringify(results, null, 2));
  console.log(L.join('\n'));
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/mechanism-lab/gate.ts')) main();
