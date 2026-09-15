import { createNewGame, performAction, performMove, resolvePendingEvent } from '../game';
import type { EventChoice, GameAction, GameState, TileId } from '../game/types';
import { hashSeed, nextRandom } from '../game/random/rng';
import { gameConfig } from '../game/config/gameConfig';
import { buildFairView, FairView } from './fairView';
import { bfsPath, isNormalTile } from '../game/map/grid';
import { returnViaFilterExcept } from '../game/rules/movement';
import type { RunResult } from './metrics';
import { summarizeEventChoice } from './metrics';
import {
  emptyForecastAcc,
  forecastWeatherOf,
  hasActiveForecast,
  isSevereWeather,
  recordAvoidance,
  recordEntry,
  severeOptions,
} from './forecastTelemetry';

/**
 * 仿真 runner：直接驱动正式 Game Engine，不依赖 React/DOM。
 * Bot 只能通过合法 Action API 玩游戏，且只能看到 FairView（玩家视角信息）。
 */

export type BotRng = () => number;

export interface BotStrategy {
  readonly name: string;
  /** 每个回合调用一次；返回一个合法决策，由 runner 通过引擎 API 执行 */
  decide(view: FairView, rng: BotRng): BotDecision;
  /** 【仅遥测】忽略预报时本回合会走的格子（见 bots/utils.blindNextTile） */
  blindMove?(view: FairView): TileId | null;
}

export type BotDecision =
  | { type: 'MOVE'; toTileId: TileId }
  | { type: 'ACTION'; action: GameAction }
  | { type: 'EVENT'; choice: EventChoice };

export const MAX_TURNS = 500;

/** 遭遇类事件（用于统计遭遇触发密度，天气不算遭遇） */
const ENCOUNTER_KINDS = new Set(['CARAVAN', 'THIEF', 'MARKET', 'HERDSMAN']);

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
  const mineSlot = state.mineEntranceId
    ? (state.map.tiles[state.mineEntranceId]?.mineSlot ?? null)
    : null;
  // 地形/天气/遭遇 遥测（纯统计，不参与玩法判定）
  let oasisVisits = 0;
  let villageVisits = 0;
  for (const id of [...state.visitedOutbound, ...state.visitedReturn]) {
    const t = state.map.tiles[id]?.terrain;
    if (t === 'OASIS') oasisVisits += 1;
    else if (t === 'VILLAGE') villageVisits += 1;
  }
  let weatherDamageHits = 0;
  let weatherDamageTotal = 0;
  for (const entry of state.log) {
    const m = /耐力 -(\d+)/.exec(entry.text);
    if (m) {
      weatherDamageHits += 1;
      weatherDamageTotal += Number(m[1]);
    }
  }
  const settlementDays = state.stats;
  const status: RunResult['status'] = state.status === 'VICTORY' ? 'VICTORY' : 'DEFEAT';
  return {
    seed,
    bot,
    status,
    defeatReason: state.defeatReason,
    error,
    mineId: state.mineEntranceId,
    mineSlot,
    endStamina: state.stamina,
    endDaysRemaining: Math.max(0, gameConfig.maxDays - state.daysUsed),
    oasisVisits,
    villageVisits,
    weatherDamageHits,
    weatherDamageTotal,
    encounterCount: 0,
    restCount: 0,
    waitCount: 0,
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
      gameConfig.startCash,
    tentsBought: 0,
    compassesBought: 0,
    tentUses: 0,
    compassUses: 0,
    tentsChargesLeft: state.tents.reduce((a, b) => a + b.charges, 0),
    compassesLeft: state.compasses,
    events: [],
    nodeVisits,
    edgeUses,
    droppedKg: state.stats.droppedKg ?? 0,
    miningAccidents: state.stats.miningAccidents ?? 0,
    miningAccidentLostKg: state.stats.miningAccidentLostKg ?? 0,
    loadPenaltyDays: state.stats.loadPenaltyDays ?? 0,
    returnPath: [...state.visitedReturn],
    returnFirstStep: state.visitedReturn.filter((id) => id !== state.mineEntranceId)[0] ?? null,
    returnBfsFirstStep: bfsFirstReturnStep(state),
  };
}

/**
 * 重建「纯最短跳数返程」的第一步。
 *
 * 为什么可行：返程起点的禁行集合 = 去程烧掉的全部普通格（城市与当前矿区豁免），
 * 而去程足迹在终态里原封不动保留着，因此不需要中途快照就能精确重建。
 */
function bfsFirstReturnStep(state: GameState): TileId | null {
  const mine = state.mineEntranceId;
  if (!mine) return null;
  const forbidden = state.visitedOutbound.filter((id) => isNormalTile(state.map, id));
  const via = returnViaFilterExcept(state.map, mine);
  const p = bfsPath(state.map, mine, state.map.cityId, forbidden, via);
  return p && p.length > 1 ? p[1] : null;
}

/** 运行单局。Bot 的每个决策都会经过引擎合法性校验（非法即抛错=框架 Bug） */
export function runOne(bot: BotStrategy, seed: string): RunResult {
  let state = createNewGame(seed);
  const rng = makeBotRng(seed, bot.name);
  // 累计器：过程量（购买/事件/使用）在这里追踪，终局量最后从引擎终态覆盖
  const acc = extractResult(state, bot.name, seed, null);
  const fAcc = emptyForecastAcc();

  let turns = 0;
  while (state.status === 'ONGOING') {
    if (turns++ > MAX_TURNS) {
      throw new Error(`runOne 超过最大回合数（seed=${seed}, bot=${bot.name}）`);
    }
    const view = buildFairView(state);
    // 预报是否对本回合有效（锚定明天）。有效才统计「决策是否被改变」。
    const fcActive = hasActiveForecast(view);
    if (fcActive) {
      fAcc.forecastWindowTurns += 1;
      fAcc.severeOptionsSeen += severeOptions(view).length;
    }
    const decision = bot.decide(view, rng);

    if (fcActive) {
      if (decision.type === 'MOVE') {
        fAcc.decisionOpportunities += 1;
        const blind = bot.blindMove ? bot.blindMove(view) : null;
        if (blind && blind !== decision.toTileId) fAcc.decisionUseful += 1;
        else fAcc.informationalOnly += 1;
        const sev = severeOptions(view);
        if (sev.includes(decision.toTileId)) {
          recordEntry(fAcc, view, decision.toTileId);
        } else if (sev.length > 0) {
          fAcc.severeAvoided += 1;
          recordAvoidance(fAcc, view, sev[0]);
        }
      } else if (decision.type === 'ACTION' && decision.action.type === 'WAIT') {
        // 因为预报显示「当前格明天恶劣」而原地停留 —— 这是最典型的有效预报
        const here = forecastWeatherOf(view, view.position);
        if (here && isSevereWeather(here)) {
          fAcc.decisionOpportunities += 1;
          fAcc.decisionUseful += 1;
          recordAvoidance(fAcc, view, view.position);
        }
      }
    }

    if (decision.type === 'MOVE') {
      state = performMove(state, decision.toTileId);
    } else if (decision.type === 'ACTION') {
      const action = decision.action;
      if (action.type === 'BUY') {
        if (action.item === 'tent') acc.tentsBought += 1;
        if (action.item === 'compass') acc.compassesBought += 1;
      }
      if (action.type === 'REST') acc.restCount = (acc.restCount ?? 0) + 1;
      if (action.type === 'WAIT') acc.waitCount = (acc.waitCount ?? 0) + 1;
      state = performAction(state, action);
    } else {
      const ev = state.pendingEvents[0];
      if (!ev) {
        throw new Error('runner 内部错误：事件队列不匹配');
      }
      const before = { day: state.daysUsed, cash: state.cash };
      if (ENCOUNTER_KINDS.has(ev.kind)) acc.encounterCount = (acc.encounterCount ?? 0) + 1;
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
  // 预报次数/花费以引擎统计为准（过程累计可能因早退缺失）
  fAcc.packsPurchased = state.stats.forecastPacks;
  fAcc.moneySpent = state.forecastSpent;
  fAcc.chargesGranted = state.stats.forecastChargesGranted;
  fAcc.chargesUsed = state.stats.forecastChargesUsed;
  fAcc.chargesUnused = state.forecastCharges;
  const workEvents = acc.events.filter((e) => e.kind === 'MARKET' && e.choice === 'WORK');
  return {
    ...final,
    tentsBought: acc.tentsBought,
    compassesBought: acc.compassesBought,
    tentUses: acc.tentUses,
    compassUses: acc.compassUses,
    encounterCount: acc.encounterCount,
    restCount: acc.restCount,
    waitCount: acc.waitCount,
    events: acc.events,
    forecastMoneySpent: fAcc.moneySpent,
    forecastChargesGranted: fAcc.chargesGranted,
    forecastChargesUsed: fAcc.chargesUsed,
    forecastChargesUnused: fAcc.chargesUnused,
    forecastWindowTurns: fAcc.forecastWindowTurns,
    forecastDecisionOpportunities: fAcc.decisionOpportunities,
    forecastDecisionUseful: fAcc.decisionUseful,
    forecastInformationalOnly: fAcc.informationalOnly,
    forecastSevereOptionsSeen: fAcc.severeOptionsSeen,
    forecastSevereEntered: fAcc.severeEntered,
    forecastSevereAvoided: fAcc.severeAvoided,
    staminaLossAvoidedEstimate: fAcc.staminaLossAvoidedEstimate,
    daysLostAvoidedEstimate: fAcc.daysLostAvoidedEstimate,
    tentDurabilitySavedEstimate: fAcc.tentDurabilitySavedEstimate,
    tentsDestroyedAvoidedEstimate: fAcc.tentsDestroyedAvoidedEstimate,
    compassUsesAvoidedEstimate: fAcc.compassUsesAvoidedEstimate,
    villageWorkDays: workEvents.length,
    villageWorkIncome: workEvents.reduce((a, e) => a + e.cashDelta, 0),
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
    mineSlot: null,
    endStamina: 0,
    endDaysRemaining: 0,
    oasisVisits: 0,
    villageVisits: 0,
    weatherDamageHits: 0,
    weatherDamageTotal: 0,
    encounterCount: 0,
    restCount: 0,
    waitCount: 0,
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
