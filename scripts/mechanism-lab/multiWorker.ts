/**
 * Mechanism-Lab 多 Bot worker。
 *
 * 为什么需要它：驱动器的每个分片都要 spawn 一个 `node --import tsx` 进程，
 * 而 tsx 的启动开销约 2~4s。若每个分片只跑「1 个 Bot × 几十局」，
 * 进程启动就会占掉 80%+ 的墙钟时间（实测 500 局/Bot 时 35s/行，其中真正计算只有 3s）。
 *
 * 解决：一个进程内跑**同一机制配置下的全部 Bot**，Seed 区间由驱动器切分。
 * 因为所有 Bot 用同一批 Seed（`mechlab:<i>`），配对比较依然成立。
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
  const a: Args = { bots: [], prefix: 'mechlab', start: 0, end: 0, out: '' };
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
process.stderr.write(`multi-worker-done [${args.start},${args.end}) bots=${args.bots.length}\n`);
