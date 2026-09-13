/**
 * 仿真 worker：由 run-sim.ts 以 `node --import tsx` 子进程方式启动。
 * 运行一个 Bot 的一个 Seed 分片，把结果 JSON 写入指定文件。
 */
import { writeFileSync } from 'node:fs';
import { BOT_BY_NAME } from '../src/simulation/bots';
import { runBatchSeeds } from '../src/simulation/runner';
import { gameConfig } from '../src/game/config/gameConfig';

// 价格扫描支持：通过环境变量覆盖矿区固定价（仅 Balance 分析用）
if (process.env.SWEEP_NORTH) gameConfig.mineBasePrice.NORTH = Number(process.env.SWEEP_NORTH);
if (process.env.SWEEP_MIDDLE) gameConfig.mineBasePrice.CENTRAL = Number(process.env.SWEEP_MIDDLE);

interface Args {
  bot: string;
  prefix: string;
  start: number;
  end: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { bot: '', prefix: 'sim', start: 0, end: 0, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bot') args.bot = argv[++i];
    else if (a === '--prefix') args.prefix = argv[++i];
    else if (a === '--start') args.start = Number(argv[++i]);
    else if (a === '--end') args.end = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`未知参数: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const bot = BOT_BY_NAME[args.bot];
if (!bot) throw new Error(`未知 Bot: ${args.bot}`);
const seeds: string[] = [];
for (let i = args.start; i < args.end; i++) seeds.push(`${args.prefix}:${args.bot}:${i}`);
const results = runBatchSeeds(bot, seeds, 0);
writeFileSync(args.out, JSON.stringify(results));
process.stderr.write(`worker-done ${args.bot} [${args.start},${args.end})\n`);
