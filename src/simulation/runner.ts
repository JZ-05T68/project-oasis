import { createNewGame, performAction, performMove, resolvePendingEvent } from '../game';
import type { EventChoice, GameAction, GameState, TileId } from '../game/types';
import { hashSeed, nextRandom } from '../game/random/rng';
import { buildFairView, FairView } from './fairView';
import type { RunResult } from './metrics';
import { summarizeEventChoice } from './metrics';

/**
 * 仿真 runner：直接驱动正式 Game Engine，不依赖 React/DOM。
 * Bot 只能通过合法 Action API 玩游戏，且只能看到 FairView（玩家视角信息）。
 */

export type BotRng = () => number;

export interface BotStrategy {
  readonly name: string;
  /** 每个回合调用一次；返回一个合法决策，由 runner 通过引擎 API 执行 */
  decide(view: FairView, rng: BotRng): BotDecision;
}

export type BotDecision =
  | { type: 'MOVE'; toTileId: TileId }
  | { type: 'ACTION'; action: GameAction }
  | { type: 'EVENT'; choice: EventChoice };

export const MAX_TURNS = 500;

/** 用局 Seed + Bot 名派生 Bot 私有随机流（可复现，且不消耗游戏 RNG） */
export function makeBotRng(seed: string, botName: string): BotRng {
  let state = hashSeed(`${botName}::${seed}`);
  return () => {
    const [v, next] = nextRandom(state);
    state = next;
    return v;
  };
}

function extractResult(state: GameState, bot: string, seed: string, error: string | null): RunResult {
  const nodeVisits: RunResult['nodeVisits'] = {};
  for (const id of state.visitedOutbound) {
    const a = (nodeVisits[id] ??= { out: 0, ret: 0 });
    a.out += 1;
  }
  for (const id of state.visitedReturn) {
    const a = (nodeVisits[id] ??= { out: 0, ret: 0 });
    a.ret += 1;
  }
  const edgeUses: RunResult['edgeUses'] = {};
  const countEdges = (list: TileId[]) => {
    for (let i = 0; i < list.length - 1; i++) {
      const key = [list[i], list[i + 1]].sort().join('~');
      edgeUses[key] = (edgeUses[key] ?? 0) + 1;
    }
  };
  countEdges(state.visitedOutbound);
  countEdges(state.visitedReturn);

  const mineInfo = state.mineEntranceId
    ? state.map.mines.find((m) => m.tileId === state.mineEntranceId)
    : undefined;
  const settlementDays = state.stats;
  const status: RunResult['status'] = state.status === 'VICTORY' ? 'VICTORY' : 'DEFEAT';
  return {
    seed,
    bot,
    status,
    defeatReason: state.defeatReason,
    error,
    mineId: state.mineEntranceId,
    mineDifficulty: mineInfo?.difficultyScore ?? null,
    mineJitter: mineInfo?.detail.jitter ?? null,
    routeScore: state.routeScore,
    daysUsed: state.daysUsed,
    outboundDays: settlementDays.outboundDays,
    miningDays: settlementDays.miningDays,
    returnDays: settlementDays.returnStartDay !== null ? state.daysUsed - settlementDays.returnStartDay : 0,
    forecastPacks: state.stats.forecastPacks,
    gemsKg: state.gemsKg,
    gemPrice: state.gemPrice,
    gemRevenue: state.status === 'VICTORY' ? Math.round(state.gemsKg * (state.gemPrice ?? 0)) : 0,
    equipmentSpent: state.equipmentSpent,
    cashRemaining: state.cash,
    finalAssets: state.cash + (state.status === 'VICTORY' ? Math.round(state.gemsKg * (state.gemPrice ?? 0)) : 0),
    netProfit:
      state.cash +
      (state.status === 'VICTORY' ? Math.round(state.gemsKg * (state.gemPrice ?? 0)) : 0) -
      2000,
    tentsBought: 0,
    compassesBought: 0,
    tentUses: 0,
    compassUses: 0,
    tentsChargesLeft: state.tents.reduce((a, b) => a + b.charges, 0),
    compassesLeft: state.compasses,
    events: [],
    nodeVisits,
    edgeUses,
  };
}

/** 运行单局。Bot 的每个决策都会经过引擎合法性校验（非法即抛错=框架 Bug） */
export function runOne(bot: BotStrategy, seed: string): RunResult {
  let state = createNewGame(seed);
  const rng = makeBotRng(seed, bot.name);
  // 累计器：过程量（购买/事件/使用）在这里追踪，终局量最后从引擎终态覆盖
  const acc = extractResult(state, bot.name, seed, null);

  let turns = 0;
  while (state.status === 'ONGOING') {
    if (turns++ > MAX_TURNS) {
      throw new Error(`runOne 超过最大回合数（seed=${seed}, bot=${bot.name}）`);
    }
    const view = buildFairView(state);
    const decision = bot.decide(view, rng);

    if (decision.type === 'MOVE') {
      state = performMove(state, decision.toTileId);
    } else if (decision.type === 'ACTION') {
      const action = decision.action;
      if (action.type === 'BUY') {
        if (action.item === 'tent') acc.tentsBought += 1;
        if (action.item === 'compass') acc.compassesBought += 1;
      }
      state = performAction(state, action);
    } else {
      const ev = state.pendingEvents[0];
      if (!ev) {
        throw new Error('runner 内部错误：事件队列不匹配');
      }
      const before = { day: state.daysUsed, cash: state.cash };
      if (decision.choice.kind === 'SANDSTORM' && decision.choice.useTent) acc.tentUses += 1;
      if (decision.choice.kind === 'RAINSTORM' && decision.choice.useTent) acc.tentUses += 1;
      if (decision.choice.kind === 'SANDSTORM' && decision.choice.useCompass) acc.compassUses += 1;
      if (decision.choice.kind === 'CARAVAN' && decision.choice.action === 'BUY_TENT') {
        acc.tentsBought += 1;
      }
      state = resolvePendingEvent(state, ev.id, decision.choice);
      acc.events.push({
        kind: ev.kind,
        choice: summarizeEventChoice(decision.choice),
        dayDelta: state.daysUsed - before.day,
        cashDelta: state.cash - before.cash,
      });
    }
  }

  // 用引擎终态覆盖终局量，保留过程量
  const final = extractResult(state, bot.name, seed, acc.error);
  return {
    ...final,
    tentsBought: acc.tentsBought,
    compassesBought: acc.compassesBought,
    tentUses: acc.tentUses,
    compassUses: acc.compassUses,
    events: acc.events,
  };
}

export interface BatchOptions {
  /** Seed 前缀；实际 seed = `${prefix}:${i}` */
  seedPrefix?: string;
  runs: number;
  /** 进度回调（每完成 progressEvery 局调用一次） */
  onProgress?: (done: number, total: number) => void;
  progressEvery?: number;
}

/** 按显式 Seed 列表运行（并行分片用） */
export function runBatchSeeds(bot: BotStrategy, seeds: string[], progressEvery = 0): RunResult[] {
  const results: RunResult[] = [];
  for (let i = 0; i < seeds.length; i++) {
    try {
      results.push(runOne(bot, seeds[i]));
    } catch (e) {
      results.push({
        ...emptyResult(),
        seed: seeds[i],
        bot: bot.name,
        status: 'DEFEAT',
        defeatReason: null,
        error: e instanceof Error ? `${e.message}` : String(e),
      });
    }
    if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
      process.stderr.write(`progress ${bot.name} ${i + 1}/${seeds.length}\n`);
    }
  }
  return results;
}

/** 批量运行：任一局抛错会记录为 error 局而不是中断整个批次 */
export function runBatch(bot: BotStrategy, runs: number, opts: Partial<BatchOptions> = {}): RunResult[] {
  const prefix: string = opts.seedPrefix ?? 'sim';
  const results: RunResult[] = [];
  const progressEvery = opts.progressEvery ?? Math.max(1, Math.floor(runs / 20));
  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}:${bot.name}:${i}`;
    try {
      results.push(runOne(bot, seed));
    } catch (e) {
      results.push({
        ...emptyResult(),
        seed,
        bot: bot.name,
        status: 'DEFEAT',
        defeatReason: null,
        error: e instanceof Error ? `${e.message}` : String(e),
      });
    }
    if (opts.onProgress && i % progressEvery === 0) opts.onProgress(i + 1, runs);
  }
  if (opts.onProgress) opts.onProgress(runs, runs);
  return results;
}

function emptyResult(): RunResult {
  return {
    seed: '',
    bot: '',
    status: 'DEFEAT',
    defeatReason: null,
    error: 'no-result',
    mineId: null,
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
  };
}

/** 供 runner 重新提取终局（错误路径使用） */
export { extractResult };
