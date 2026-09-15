/**
 * Shadow-Lab worker：跑一个实验变体的一段 seed 区间，结果写 JSON。
 * 由 runShadow.ts 以子进程方式启动（workers 固定 ≤4，沿用已验证的安全设置）。
 */
import { writeFileSync } from 'node:fs';
import { shadowRun, makeAdaptiveMinerBot, observeMinePrice, trueMinePrices, type MineInfoVariant, type LoadModel } from './shadowRunner';
import { FORECAST_BOTS, BOT_BY_NAME } from '../../src/simulation/bots';
import type { BotStrategy } from '../../src/simulation/runner';
import type { RunResult } from '../../src/simulation/metrics';

interface Args {
  exp: 'mineinfo' | 'returnload';
  variant: string;
  bot: string;
  start: number;
  end: number;
  prefix: string;
  out: string;
}

function parse(argv: string[]): Args {
  const a: Args = {
    exp: 'mineinfo',
    variant: 'none',
    bot: 'AdaptiveMinerBot',
    start: 0,
    end: 0,
    prefix: 'shadow',
    out: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--exp') a.exp = argv[++i] as Args['exp'];
    else if (k === '--variant') a.variant = argv[++i];
    else if (k === '--bot') a.bot = argv[++i];
    else if (k === '--start') a.start = Number(argv[++i]);
    else if (k === '--end') a.end = Number(argv[++i]);
    else if (k === '--prefix') a.prefix = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else throw new Error(`未知参数: ${k}`);
  }
  return a;
}

const args = parse(process.argv.slice(2));

/** 当前正在跑的对局 seed（AdaptiveMinerBot 的价格观察依赖它） */
let currentSeed = '';
const priceCache = new Map<string, ReturnType<typeof trueMinePrices>>();
function truthOf(seed: string): ReturnType<typeof trueMinePrices> {
  let v = priceCache.get(seed);
  if (!v) {
    v = trueMinePrices(seed);
    priceCache.set(seed, v);
    if (priceCache.size > 64) priceCache.clear();
  }
  return v;
}

function buildBot(name: string): BotStrategy {
  if (name === 'AdaptiveMinerBot') {
    return makeAdaptiveMinerBot('AdaptiveMinerBot', {
      estimate: (slot) => {
        const mine = truthOf(currentSeed).find((m) => m.slot === slot);
        if (!mine) return null;
        const variant = args.exp === 'mineinfo' ? (args.variant as MineInfoVariant) : 'range10';
        return observeMinePrice(variant, mine.price);
      },
    });
  }
  const b = BOT_BY_NAME[name];
  if (!b) throw new Error(`未知 Bot: ${name}`);
  return b;
}

const results: RunResult[] = [];
const bot = buildBot(args.bot);

for (let i = args.start; i < args.end; i++) {
  // 注意：prefix 由编排器统一指定（所有变体共用同一批 Seed → 配对比较）
  const seed = `${args.prefix}:${i}`;
  currentSeed = seed;
  try {
    const r = shadowRun(bot, seed, args.exp === 'returnload' ? { loadModel: args.variant as LoadModel } : null);
    results.push(r);
  } catch (e) {
    results.push({
      seed,
      bot: args.bot,
      status: 'DEFEAT',
      defeatReason: null,
      error: e instanceof Error ? e.message : String(e),
      mineId: null,
      mineSlot: null,
      mineDifficulty: null,
      mineJitter: null,
      routeScore: null,
      daysUsed: 0,
      outboundDays: null,
      miningDays: 0,
      returnDays: 0,
      forecastPacks: 0,
      gemsKg: 0,
      gemPrice: null,
      gemRevenue: 0,
      equipmentSpent: 0,
      cashRemaining: 0,
      finalAssets: 0,
      netProfit: 0,
      tentsBought: 0,
      compassesBought: 0,
      tentUses: 0,
      compassUses: 0,
      tentsChargesLeft: 0,
      compassesLeft: 0,
      events: [],
      nodeVisits: {},
      edgeUses: {},
    } as RunResult);
  }
}

void FORECAST_BOTS;
writeFileSync(args.out, JSON.stringify(results));
process.stderr.write(`shadow-worker-done ${args.exp}/${args.variant}/${args.bot} [${args.start},${args.end})\n`);
