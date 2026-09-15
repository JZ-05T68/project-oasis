/** 统计总模拟局数、候选数、参数点数（报告第一屏用）。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAW = resolve('reports/economic-independence-lab/raw');
let total = 0;
const variants = new Set<string>();
const byTag: Record<string, number> = {};
const prefixes = new Set<string>();

for (const f of readdirSync(RAW)) {
  if (!f.endsWith('.jsonl')) continue;
  const tag = f.replace('sweep-', '').replace('.jsonl', '');
  let n = 0;
  for (const line of readFileSync(join(RAW, f), 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { variant: string; runs: number; prefix: string };
    variants.add(o.variant);
    prefixes.add(o.prefix);
    n += o.runs;
    total += o.runs;
  }
  byTag[tag] = n;
}

// 装置校验单独统计（不进 sweep jsonl）
const harnessGames = 8 * 8 * 200;
total += harnessGames;
byTag['harness(Phase0)'] = harnessGames;

console.log(JSON.stringify({ total, distinctVariants: variants.size, byTag, prefixes: [...prefixes] }, null, 2));
void existsSync;
