/**
 * §51 结果分层 + §52 利润分布：从 raw JSON 直接生成报告表格。
 * 用法: tsx scripts/mechanism-lab/outcomeLayering.ts <variantId> <tag> [seeds]
 */

import fs from 'node:fs';
import { LAB_DIR, SEED_PREFIX } from './runOutcomeLab';

const variant = process.argv[2] ?? 'EH1';
const tag = process.argv[3] ?? 'phaseC';
const seeds = Number(process.argv[4] ?? 5000);
const bot = process.argv[5] ?? 'OutcomeMasterBot';

interface RunRow {
  seed: string;
  status: string;
  expeditionCompleted: boolean;
  netProfit: number;
}

function load(file: string): RunRow[] {
  const p = `${LAB_DIR}/raw/${file}`;
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8')) as RunRow[];
}

const rows = load(`${variant}-${tag}-${seeds}-${bot}.json`);
const baseRows = load(`base-${tag}-${seeds}-${bot}.json`);

function layering(rs: RunRow[], label: string): void {
  const n = rs.length;
  const comp = rs.filter((r) => r.expeditionCompleted);
  const failed = n - comp.length;
  const unprof = comp.filter((r) => r.netProfit <= 0).length;
  const profits = comp.map((r) => r.netProfit).sort((a, b) => a - b);
  const p75 = profits[Math.floor((profits.length - 1) * 0.75)];
  const high = comp.filter((r) => r.netProfit >= p75).length;

  console.log(`\n### ${label}（n=${n}）\n`);
  console.log('| 分层 | 局数 | 占比 |');
  console.log('|---|---:|---:|');
  console.log(`| 远征失败 | ${failed} | ${((failed / n) * 100).toFixed(2)}% |`);
  console.log(`| 成功返城但亏损/保本 | ${unprof} | ${((unprof / n) * 100).toFixed(2)}% |`);
  console.log(`| 成功返城且盈利（非高收益） | ${comp.length - unprof - high} | ${(((comp.length - unprof - high) / n) * 100).toFixed(2)}% |`);
  console.log(`| 高收益（成功局 p75 = ${p75} 元以上） | ${high} | ${((high / n) * 100).toFixed(2)}% |`);
  const sum = failed + unprof + (comp.length - unprof - high) + high;
  console.log(`| **总和检查** | ${sum} | ${((sum / n) * 100).toFixed(2)}% |`);
}

function dist(rs: RunRow[], label: string, onlyCompleted: boolean): void {
  const arr = (onlyCompleted ? rs.filter((r) => r.expeditionCompleted) : rs).map((r) => r.netProfit);
  arr.sort((a, b) => a - b);
  if (arr.length === 0) return;
  const q = (p: number) => arr[Math.floor((arr.length - 1) * p)];
  console.log(`\n**${label}**（n=${arr.length}）：`);
  console.log(
    `| min | p10 | p25 | median | p75 | p90 | max |\n|---:|---:|---:|---:|---:|---:|---:|\n| ${arr[0]} | ${q(0.1)} | ${q(0.25)} | ${q(0.5)} | ${q(0.75)} | ${q(0.9)} | ${arr[arr.length - 1]} |`,
  );
}

if (rows.length === 0) {
  console.error(`无数据: ${variant}-${tag}-${seeds}-${bot}.json`);
  process.exit(1);
}

layering(rows, `${variant}（候选）`);
dist(rows, `${variant} 全体局利润分布（含失败局计 0 收入 - 全部成本）`, false);
dist(rows, `${variant} 仅成功返城局利润分布`, true);

if (baseRows.length > 0) {
  layering(baseRows, `BASE 基线（同 Seed 同 Bot）`);
  dist(baseRows, 'BASE 仅成功返城局利润分布', true);
}

console.log(`\nSeed 前缀 = ${SEED_PREFIX}（两份数据共享 Seed，逐局配对成立）`);
