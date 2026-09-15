/** 扫描进度：列出已完成的 (price, charges) 组合与缺失组合。 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2] ?? 'b1';
const file = resolve(`reports/forecast-autolab/raw/sweep-${tag}.jsonl`);
const have = new Set<string>();
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      have.add(`${r.params.packPrice}/${r.params.chargesPerPack}`);
    } catch {
      /* ignore */
    }
  }
}
const prices = [50, 100, 150, 200, 250, 300, 350, 400, 500];
const charges = [2, 3, 4, 5, 6, 8];
const missing: string[] = [];
for (const p of prices) for (const c of charges) if (!have.has(`${p}/${c}`)) missing.push(`${p}x${c}`);
console.log(`已完成 ${have.size}/54`);
console.log(`缺失 ${missing.length}: ${missing.join(' ')}`);
