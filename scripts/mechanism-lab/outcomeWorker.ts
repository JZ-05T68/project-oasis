/**
 * v0.2.0 Outcome Lab worker：一个进程内跑「同一 override 下的全部 Bot」。
 * 与 mechanism-lab/multiWorker.ts 同构；Seed 前缀由驱动器统一切分为 `outcome:<i>`，
 * 因此全部候选 / 全部 Bot 共用同一批 Seed，逐局配对比较成立。
 */
import { writeFileSync } from 'node:fs';
import { BOT_BY_NAME } from '../../src/simulation/bots';
import { runBatchSeeds } from '../../src/simulation/runner';
import type { RunResult } from '../../src/simulation/metrics';

interface Args {
  bots: string[];
  prefix: string;
  start: number;
  end: number;
  out: string;
}

function parse(argv: string[]): Args {
  const a: Args = { bots: [], prefix: 'outcome', start: 0, end: 0, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--bots') a.bots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--prefix') a.prefix = argv[++i];
    else if (k === '--start') a.start = Number(argv[++i]);
    else if (k === '--end') a.end = Number(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

const args = parse(process.argv.slice(2));
const seeds: string[] = [];
for (let i = args.start; i < args.end; i++) seeds.push(`${args.prefix}:${i}`);

const out: Record<string, RunResult[]> = {};
for (const name of args.bots) {
  const bot = BOT_BY_NAME[name];
  if (!bot) throw new Error(`未知 Bot: ${name}`);
  out[name] = runBatchSeeds(bot, seeds, 0);
}
writeFileSync(args.out, JSON.stringify(out));
process.stderr.write(`outcome-worker-done [${args.start},${args.end}) bots=${args.bots.length}\n`);
