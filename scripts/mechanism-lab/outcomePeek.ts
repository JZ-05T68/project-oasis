/**
 * Phase A 中途速览：从 sweep jsonl 直接读取，输出关键列，便于在锦标赛跑完前先看趋势。
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'reports/outcome-mechanism-lab/raw';

interface SweepLine {
  variant: string;
  bot: string;
  seeds: number;
  runs: number;
  errors: number;
  summary: {
    winRate: number;
    evNetProfitAllRuns?: number;
    avgEquipmentSpent?: number;
  };
  metrics?: {
    outcome?: {
      completionRate: number;
      profitableRate: number;
      profitAmongCompleted: number;
      failedRate: number;
      survivedUnprofitableRate: number;
      highProfitRate: number;
      highProfitThreshold: number;
      profitCompleted?: { median: number; mean: number; min: number };
    };
    topFailureReason?: string;
    topFailureShare?: number;
    staminaDeathRate?: number;
    villageStopGivenVisit?: number;
    villageServiceRate?: number;
    surgeUseRate?: number;
    rescueUseRate?: number;
    avgIntelTiles?: number;
    routeSwitchRate?: number;
    dominantVillageAction?: boolean;
    dominant?: boolean;
    dc?: { overall?: number; newMechanism?: number; outcomeFlip?: number; returnRoute?: number };
  };
  paired?: { completionDelta?: number; avgProfitDelta?: number; profitableDelta?: number };
}

function read(file: string): SweepLine[] {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SweepLine);
}

const file = process.argv[2] ?? 'sweep-phaseA.jsonl';
const rows = read(file);

const byVariant = new Map<string, SweepLine[]>();
for (const r of rows) {
  const arr = byVariant.get(r.variant) ?? [];
  arr.push(r);
  byVariant.set(r.variant, arr);
}

console.log('=== OutcomeMasterBot（机制感知）===');
console.log(
  ['variant', 'comp%', 'prof%', 'pAc%', 'fail%', 'su%', 'high%', 'pMed', 'topFail', 'dc%', 'new%', 'flip%', 'ev', 'vStop%', 'surge%', 'resc%'].join('\t'),
);
for (const [variant, list] of byVariant) {
  for (const r of list) {
    if (r.bot !== 'OutcomeMasterBot') continue;
    const o = r.metrics?.outcome;
    const m = r.metrics;
    const d = m?.dc;
    console.log(
      [
        variant,
        o?.completionRate?.toFixed(2) ?? '-',
        o?.profitableRate?.toFixed(2) ?? '-',
        o?.profitAmongCompleted?.toFixed(1) ?? '-',
        o?.failedRate?.toFixed(2) ?? '-',
        o?.survivedUnprofitableRate?.toFixed(2) ?? '-',
        o?.highProfitRate?.toFixed(2) ?? '-',
        o?.profitCompleted?.median?.toFixed(0) ?? '-',
        `${m?.topFailureReason ?? '-'}@${m?.topFailureShare?.toFixed(1) ?? '-'}`,
        d?.overall?.toFixed(1) ?? '-',
        d?.newMechanism?.toFixed(1) ?? '-',
        d?.outcomeFlip?.toFixed(1) ?? '-',
        (r.summary.evNetProfitAllRuns ?? 0).toFixed(0),
        m?.villageStopGivenVisit?.toFixed(1) ?? '-',
        m?.surgeUseRate?.toFixed(1) ?? '-',
        m?.rescueUseRate?.toFixed(1) ?? '-',
      ].join('\t'),
    );
  }
}

console.log('\n=== 全部 Bot 完成率 ===');
for (const [variant, list] of byVariant) {
  const parts = list.map((r) => `${r.bot.replace('Outcome', '').replace('Bot', '')}=${r.summary.winRate.toFixed(1)}`);
  console.log(variant.padEnd(6), parts.join('  '));
}

console.log('\n=== OutcomeBlindBot（机制盲）完成率 / EV ===');
for (const [variant, list] of byVariant) {
  const b = list.find((r) => r.bot === 'OutcomeBlindBot');
  console.log(
    variant.padEnd(6),
    `comp=${b?.metrics?.outcome?.completionRate?.toFixed(2) ?? b?.summary.winRate.toFixed(1)}`,
    `ev=${(b?.summary.evNetProfitAllRuns ?? 0).toFixed(0)}`,
  );
}
