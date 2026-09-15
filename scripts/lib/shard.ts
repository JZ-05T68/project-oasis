/**
 * 通用分片仿真执行器（供二次数值扫描 / 影子实验复用）。
 * 安全约束：workers ≤ 4、每分片看门狗、全局无进展看门狗。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RunResult } from '../../src/simulation/metrics';

export interface ShardOptions {
  bots: string[];
  /** OASIS_CONFIG_OVERRIDE 的 JSON 字符串 */
  override: string;
  runs: number;
  workers?: number;
  /** 每分片看门狗（秒） */
  timeout?: number;
  /** 临时目录 */
  tmpDir: string;
  /** seed 前缀（不同实验用不同前缀会改对局内容，同一实验内必须一致） */
  prefix?: string;
  /** 运行的 worker 脚本路径（默认主仿真 worker） */
  worker?: string;
  onProgress?: (done: number, total: number) => void;
}

function spawnChunk(
  worker: string,
  bot: string,
  prefix: string,
  start: number,
  end: number,
  outFile: string,
  override: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((ok) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        worker,
        '--bot',
        bot,
        '--prefix',
        prefix,
        '--start',
        String(start),
        '--end',
        String(end),
        '--out',
        outFile,
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, OASIS_CONFIG_OVERRIDE: override },
      },
    );
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      ok(false);
    }, timeoutMs);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ok(code === 0);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ok(false);
    });
  });
}

export async function runSharded(opts: ShardOptions): Promise<Map<string, RunResult[]>> {
  const workers = Math.min(4, Math.max(1, opts.workers ?? 4));
  const timeout = (opts.timeout ?? 120) * 1000;
  const prefix = opts.prefix ?? 'sim';
  const worker = opts.worker ?? 'scripts/sim-worker.ts';
  mkdirSync(opts.tmpDir, { recursive: true });

  const chunksPerBot = workers * 2;
  const tasks: Array<{ bot: string; s: number; e: number; f: string }> = [];
  for (const bot of opts.bots) {
    const per = Math.ceil(opts.runs / chunksPerBot);
    for (let s = 0; s < opts.runs; s += per) {
      const e = Math.min(opts.runs, s + per);
      tasks.push({ bot, s, e, f: join(opts.tmpDir, `${bot}-${s}-${e}.json`) });
    }
  }

  const byBot = new Map<string, RunResult[]>();
  for (const b of opts.bots) byBot.set(b, []);
  let i = 0;
  let done = 0;
  const workerFn = async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      const okChunk = await spawnChunk(worker, t.bot, prefix, t.s, t.e, t.f, opts.override, timeout);
      done += 1;
      opts.onProgress?.(done, tasks.length);
      if (!okChunk) continue;
      try {
        byBot.get(t.bot)!.push(...(JSON.parse(readFileSync(t.f, 'utf-8')) as RunResult[]));
      } catch {
        /* 读取失败则该分片作废 */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, () => workerFn()));
  try {
    rmSync(opts.tmpDir, { recursive: true, force: true });
  } catch {
    /* Windows EPERM，忽略 */
  }
  return byBot;
}

export function tmpDirFor(out: string, tag: string): string {
  return resolve(out, 'raw', `.tmp-${tag}-${Date.now()}`);
}
