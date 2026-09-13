/**
 * 矿区价格扫描：在同一套 Bot/Seed 上比较不同 (北, 中) 价格组合的 EV/胜率。
 * 仅用于 Balance 分析，不影响游戏运行时（扫描中临时改 gameConfig）。
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { aggregateBot, type BotSummary, type RunResult } from '../src/simulation/metrics';
import { gameConfig } from '../src/game/config/gameConfig';

const RUNS = Number(process.argv[2] ?? 3000);
const WORKERS = Math.max(1, Math.min(12, cpus().length - 2));
const COMBOS: Array<[number, number]> = [
  [280, 180],
  [260, 170],
  [240, 160],
  [220, 150],
  [240, 170],
  [260, 160],
];
const BOTS = ['SouthMineBot', 'MiddleMineBot', 'NorthMineBot', 'GreedyMinerBot'];
const PREFIX = 'sweep';

interface ChunkTask {
  bot: string;
  north: number;
  middle: number;
  start: number;
  end: number;
  outFile: string;
}

function runChunk(task: ChunkTask): Promise<void> {
  return new Promise((fulfil, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx',
        'scripts/sim-worker.ts',
        '--bot', task.bot,
        '--prefix', `${PREFIX}:${task.north}-${task.middle}:${task.bot}`,
        '--start', String(task.start),
        '--end', String(task.end),
        '--out', task.outFile,
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('exit', (code) => (code === 0 ? fulfil() : reject(new Error(stderr.slice(-300)))));
    child.on('error', reject);
  });
}

async function main(): Promise<void> {
  const tmp = resolve('reports/.sweep-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const tasks: ChunkTask[] = [];
  for (const [north, middle] of COMBOS) {
    for (const bot of BOTS) {
      const per = Math.ceil(RUNS / WORKERS);
      for (let s = 0; s < RUNS; s += per) {
        tasks.push({ bot, north, middle, start: s, end: Math.min(RUNS, s + per), outFile: join(tmp, `${bot}-${north}-${middle}-${s}.json`) });
      }
    }
  }

  // worker 需要知道价格：通过环境变量传递
  const originalSpawn = tasks.map((t) => t);
  void originalSpawn;
  let idx = 0;
  const errors: string[] = [];
  async function runner() {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      const env = { ...process.env, SWEEP_NORTH: String(task.north), SWEEP_MIDDLE: String(task.middle) };
      await new Promise<void>((fulfil, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--import', 'tsx',
            'scripts/sim-worker.ts',
            '--bot', task.bot,
            '--prefix', `${PREFIX}:${task.north}-${task.middle}:${task.bot}`,
            '--start', String(task.start),
            '--end', String(task.end),
            '--out', task.outFile,
          ],
          { cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += String(d)));
        child.on('exit', (code) => (code === 0 ? fulfil() : reject(new Error(stderr.slice(-300)))));
        child.on('error', reject);
      }).catch((e) => errors.push(String(e)));
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => runner()));
  if (errors.length > 0) throw new Error(errors.join('\n'));

  // worker 内读 env 不可行（gameConfig 在 worker 进程里）——改为在 worker 里支持 SWEEP 环境变量
  const byCombo = new Map<string, RunResult[]>();
  for (const task of tasks) {
    const key = `${task.north}-${task.middle}`;
    const chunk: RunResult[] = JSON.parse(readFileSync(task.outFile, 'utf-8'));
    const list = byCombo.get(key) ?? [];
    list.push(...chunk);
    byCombo.set(key, list);
  }
  rmSync(tmp, { recursive: true, force: true });

  const lines: string[] = [];
  lines.push(`# 价格扫描（每组合 ${BOTS.length} Bot × ${RUNS} seeds）`);
  lines.push('');
  lines.push('| 组合(北/中) | Bot | 胜率% | EV | 胜局均收益 | 耐力% | 超时% |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  const summaries: Array<{ combo: string; bot: string; s: BotSummary }> = [];
  for (const [north, middle] of COMBOS) {
    for (const bot of BOTS) {
      const results = byCombo.get(`${north}-${middle}`)!.filter((r) => r.bot === bot);
      const s = aggregateBot(results);
      summaries.push({ combo: `${north}/${middle}`, bot, s });
      lines.push(`| ${north}/${middle} | ${bot} | ${s.winRate} | ${s.evNetProfitAllRuns} | ${s.avgNetProfitWins} | ${s.failureRates.STAMINA_EXHAUSTED} | ${s.failureRates.TIMEOUT} |`);
    }
  }
  lines.push('');
  // 组合级对比：三矿 EV
  lines.push('## 组合级三矿 EV 对比');
  lines.push('');
  lines.push('| 组合(北/中) | 南EV | 中EV | 北EV | 北/南 EV 比 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [north, middle] of COMBOS) {
    const get = (bot: string) => summaries.find((x) => x.combo === `${north}/${middle}` && x.bot === bot)!.s;
    const south = get('SouthMineBot').evNetProfitAllRuns;
    const mid = get('MiddleMineBot').evNetProfitAllRuns;
    const northEv = get('NorthMineBot').evNetProfitAllRuns;
    lines.push(`| ${north}/${middle} | ${south} | ${mid} | ${northEv} | ${(northEv / south).toFixed(2)} |`);
  }
  writeFileSync('reports/price-sweep.md', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  void gameConfig;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
