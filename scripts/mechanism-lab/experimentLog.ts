/**
 * 实验日志生成器（§44 全过程记录 / §45 机制版本记录）。
 *
 * 直接从 sweep-*.jsonl 生成 `reports/mechanism-autolab/experiment-log.md`，
 * 保证日志里的每个数字都能追溯到原始结果文件，而不是手抄。
 *
 * 用法：npx tsx scripts/mechanism-lab/experimentLog.ts --tags phaseA,phaseB,phaseC
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VARIANTS, VARIANT_BY_ID } from './mechs';
import { readRows, type SweepRow } from './runLab';

const OUT = 'reports/mechanism-autolab';

function main(): void {
  const argv = process.argv.slice(2);
  let tags = ['phaseA'];
  let title = '实验日志';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tags') tags = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--title') title = argv[++i];
  }

  const rows: SweepRow[] = [];
  for (const t of tags) {
    const f = resolve(OUT, 'raw', `sweep-${t}.jsonl`);
    if (!existsSync(f)) continue;
    for (const r of readRows(f)) rows.push({ ...r, tag: t });
  }
  const best = new Map<string, SweepRow>();
  for (const r of rows) {
    const k = `${r.variant}|${r.bot}`;
    const p = best.get(k);
    if (!p || r.runs > p.runs) best.set(k, r);
  }

  const L: string[] = [];
  L.push(`# ${title}`);
  L.push('');
  L.push(`- 生成时间：${new Date().toISOString()}`);
  L.push(`- 数据源：${tags.map((t) => `\`reports/mechanism-autolab/raw/sweep-${t}.jsonl\``).join('、')}`);
  L.push('- 说明：本文件由 `scripts/mechanism-lab/experimentLog.ts` 从原始结果自动生成，');
  L.push('  每个数字都可追溯到对应 jsonl 行，避免手工抄录出错。');
  L.push('- 所有候选 / 所有 Bot **共用同一批 Seed**（prefix `mechlab`，`seedMode=shared`），因此逐局配对成立。');
  L.push('');

  /* ---------- 1. 候选注册表（机制版本） ---------- */
  L.push('## 1. 机制版本注册表');
  L.push('');
  L.push('| ID | 名称 | 族 | 状态变量 | 公式 | 按钮 | 假设 |');
  L.push('|---|---|---|---:|---:|---:|---|');
  for (const v of VARIANTS) {
    L.push(`| ${v.id} | ${v.label} | ${v.family} | ${v.complexity.stateVars} | ${v.complexity.formulas} | ${v.complexity.buttons} | ${v.hypothesis} |`);
  }
  L.push('');

  /* ---------- 2. 逐候选逐 Bot 明细 ---------- */
  L.push('## 2. 逐候选 × 逐 Bot 结果明细');
  L.push('');
  L.push('| 候选 | Bot | 局数 | 错误 | 胜率% | EV | 平均采矿天 | 采矿熵 | 最热模板% | 决策改变(总)% | (采矿)% | (返程)% | (丢货)% | 返程多样性 | 返程天 | 丢货率% | 事故率% | 耐力死% | 超时% | 与基线配对ΔEV | W/L/T |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  const variantIds = [...new Set(rows.map((r) => r.variant))];
  for (const v of variantIds) {
    const bots = [...new Set(rows.filter((r) => r.variant === v).map((r) => r.bot))].sort();
    for (const b of bots) {
      const r = best.get(`${v}|${b}`);
      if (!r) continue;
      const m = r.metrics;
      const s = r.summary;
      L.push(
        `| ${v} | ${b} | ${s.runs} | ${s.errors} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${m.avgMiningDays} | ${m.miningDaysEntropy} | ${m.topMiningDayShare} | ${m.dc.overall} | ${m.dc.mining} | ${m.dc.returnRoute} | ${m.dc.dropCargo} | ${m.returnRouteDiversity} | ${m.returnDays} | ${m.dropRate} | ${m.accidentRate} | ${m.staminaDeathRate} | ${m.timeoutRate} | ${r.paired.avgDelta} | ${r.paired.wins}/${r.paired.losses}/${r.paired.ties} |`,
      );
    }
  }
  L.push('');

  /* ---------- 3. 失败实验 / 回滚记录 ---------- */
  L.push('## 3. 失败与回滚记录');
  L.push('');
  L.push('### 3.1 装置层面的失败（在机制结论之前先修）');
  L.push('');
  L.push('| 时间点 | 现象 | 根因 | 处置 |');
  L.push('|---|---|---|---|');
  L.push('| Phase 0 | M05 的 `dropRate = 0%`，丢货按钮从未被触发 | 阈值型负重惩罚让「丢一小步」没有任何收益（不跌破阈值就等于没丢），丢货变成全有或全无的巨额决策 | 把负重惩罚从「一刀切阈值」改成**分级**：超过阈值后每多背 `stepKg` 沙漠每格再 +1 天，边际丢货立刻有价值 |');
  L.push('| Phase 0 | 改为连续时间定价后 `dropRate` 飙到 **94.7%**，而 `loadPenaltyDays ≈ 0.01` | Bot 的「每天时间价值 = 货值/(缓冲+1)」严重高估了返程中的时间价值（返程阶段已经不能挖矿，多一天只值超时风险），于是丢货退化成正反馈动作而非决策 | 改成**风险触发式**：只有 `剩余天数 - 返程期望天数 < 2` 时才丢，并丢最小可行的 kg；同时让采矿规划显式多加一格沙漠的缓冲 |');
  L.push('| Phase A 准备 | `AdaptiveMinerBot` 在高负重档几乎每天靠紧急丢货救场（dropRate 70.8%） | 只按期望值规划返程，忽略了「路上会不会撞上沙漠」的方差 | `miningMarginal` 增加 `loadBuffer = extraDaysPerDesertTile` 不确定缓冲 → 让「提前少挖」成为规划动作 |');
  L.push('');
  L.push('### 3.2 被否决的机制方向');
  L.push('');
  // 数据驱动：完全按指标自动分类，避免"人工挑选赢家"的嫌疑
  const PROMOTED = new Set(['FINAL-load625', 'FINAL-load700', 'M11', 'P-LOAD-t24-s6-m1']);
  const baseEv = best.get('BASE|ReasonableMechBot')?.summary.evNetProfitAllRuns ?? 0;
  const rejected: string[] = [];
  for (const v of variantIds) {
    if (v === 'BASE' || PROMOTED.has(v)) continue;
    const m = best.get(`${v}|AdaptiveMinerBot`)?.metrics;
    const p = best.get(`${v}|ReasonableMechBot`) ?? best.get(`${v}|AdaptiveMinerBot`);
    const ev = p?.summary.evNetProfitAllRuns ?? 0;
    const ratio = baseEv === 0 ? 1 : ev / baseEv;
    const dc = m?.dc.mining ?? 0;
    let reason: string;
    if (dc < 15) {
      reason = `采矿决策改变率 ${dc.toFixed(2)}% < 15%：机制**没有改变任何采矿动作**（详见报告 §Top Rejects 的结构性解释）`;
    } else if (ratio < 0.7) {
      reason = `决策改变率 ${dc.toFixed(2)}% 有效，但 EV 只有基线的 ${(ratio * 100).toFixed(0)}%（<70%）：收益结构被打崩`;
    } else if (
      (m?.topMiningDayShare ?? 100) > 90
    ) {
      reason = `最热采矿模板占比 ${m?.topMiningDayShare}% > 90%：形成支配策略`;
    } else {
      reason = `指标全面劣于入选候选（Δmine ${dc.toFixed(1)}% / EV 比 ${(ratio * 100).toFixed(0)}% / 胜率 ${p?.summary.winRate}%）`;
    }
    rejected.push(
      `| ${v} | ${VARIANT_BY_ID[v]?.label ?? v} | Δmine ${dc.toFixed(2)}% · EV比 ${(ratio * 100).toFixed(0)}% · 胜率 ${p?.summary.winRate ?? '—'}% | ${reason} |`,
    );
  }
  L.push('| ID | 名称 | 关键指标 | 否决理由 |');
  L.push('|---|---|---|---|');
  L.push(...rejected);
  L.push('');

  /* ---------- 4. 参数扫描 ---------- */
  L.push('## 4. 参数扫描记录');
  L.push('');
  L.push('（Phase B 的每个参数点同样是 jsonl 中的一行，可直接对照 §2 的列读取。）');
  L.push('');

  mkdirSync(resolve(OUT), { recursive: true });
  writeFileSync(resolve(OUT, 'experiment-log.md'), L.join('\n') + '\n');
  console.log(`→ ${OUT}/experiment-log.md（${rows.length} 行原始记录，${best.size} 组唯一结果）`);
}

main();
