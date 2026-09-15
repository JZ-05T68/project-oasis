/**
 * Shadow-Lab 专用 Runner（**完全隔离的实验代码，不进入生产路径**）。
 *
 * 目的：在不修改正式引擎、正式 GameState 语义、正式规则页的前提下，
 * 模拟两种候选新机制：
 *   A. 矿井估值的「信息粒度」（无信息 / 粗档位 / ±30% / ±20% / ±10%）
 *   B. 返程负重（携带 ≥ N kg 时每 5 次返程移动额外 -1 耐力）
 *
 * 隔离方式：
 *  - 只 import 引擎的公开 API（createNewGame / performMove / performAction / resolvePendingEvent）；
 *  - 负重通过「包裹返回的 state 上直接写 stamina」实现，属于实验层副作用；
 *  - 观察（观察到的价格）由 shadow 层根据 seed 重算地图得到真值后再降级，
 *    不经过 FairView，因此不会给生产 Bot 打开任何上帝视角入口。
 */
import { createNewGame, performAction, performMove, resolvePendingEvent } from '../../src/game';
import type { EventChoice, GameAction, GameState, TileId } from '../../src/game/types';
import { generateWorld } from '../../src/game/map/generate';
import { buildFairView, type FairView } from '../../src/simulation/fairView';
import { extractResult, makeBotRng, MAX_TURNS, type BotDecision, type BotRng, type BotStrategy } from '../../src/simulation/runner';
import { summarizeEventChoice, type RunResult } from '../../src/simulation/metrics';
import { botTentId, plannedPurchase, planOutboundStep, planReturnStep, wantsRest } from '../../src/simulation/bots/utils';
import { minReturnDays } from '../../src/simulation/simGraph';

const ENCOUNTER_KINDS = new Set(['CARAVAN', 'THIEF', 'MARKET', 'HERDSMAN']);

/* ------------------------------------------------------------------ */
/* A. 矿价信息粒度                                                      */
/* ------------------------------------------------------------------ */

export type MineInfoVariant = 'none' | 'tier' | 'range30' | 'range20' | 'range10';

export const MINE_INFO_VARIANTS: MineInfoVariant[] = ['none', 'tier', 'range30', 'range20', 'range10'];

export interface MineEstimate {
  /** 点估计（元/kg）：Bot 用它估算「再挖一天值多少」 */
  point: number;
  lo: number;
  hi: number;
  tier?: 'LOW' | 'MEDIUM' | 'HIGH';
}

/** 公开的定价区间（规则页已知：140 ~ 320 元/kg） */
const PUB_LO = 140;
const PUB_HI = 320;
const TIER_LOW_MAX = 190;
const TIER_HIGH_MIN = 250;

/** 根据「真值 + 变体」生成玩家可见的观察（降级信息） */
export function observeMinePrice(variant: MineInfoVariant, truePrice: number): MineEstimate {
  switch (variant) {
    case 'none':
      // 只有「价格区间公开、但不知道具体值」这一条先验
      return { point: Math.round((PUB_LO + PUB_HI) / 2), lo: PUB_LO, hi: PUB_HI };
    case 'tier': {
      if (truePrice < TIER_LOW_MAX) return { point: 165, lo: PUB_LO, hi: TIER_LOW_MAX, tier: 'LOW' };
      if (truePrice > TIER_HIGH_MIN) return { point: 285, lo: TIER_HIGH_MIN, hi: PUB_HI, tier: 'HIGH' };
      return { point: 220, lo: TIER_LOW_MAX, hi: TIER_HIGH_MIN, tier: 'MEDIUM' };
    }
    case 'range30':
      return { point: truePrice, lo: Math.round(truePrice * 0.7), hi: Math.round(truePrice * 1.3) };
    case 'range20':
      return { point: truePrice, lo: Math.round(truePrice * 0.8), hi: Math.round(truePrice * 1.2) };
    case 'range10':
      return { point: truePrice, lo: Math.round(truePrice * 0.9), hi: Math.round(truePrice * 1.1) };
    default:
      return { point: Math.round((PUB_LO + PUB_HI) / 2), lo: PUB_LO, hi: PUB_HI };
  }
}

/** 从 seed 重算地图真值（shadow 层专用；生产 Bot 拿不到） */
export function trueMinePrices(seed: string): Array<{ slot: 'A' | 'B'; tileId: TileId; price: number }> {
  const map = generateWorld(seed);
  return map.mines.map((m) => ({ slot: m.slot, tileId: m.tileId, price: m.gemPrice }));
}

/**
 * AdaptiveMinerBot —— 实验用「会算账的矿工」。
 *
 * 决策规则（边际分析，可解释）：
 *   多挖一天的边际收入 = 2kg × 价格估计
 *   多挖一天的边际风险 = 当前货物估值 × 每日失败概率
 *   只有当「边际收入 > 边际风险」且时间/耐力仍有安全余量时才继续挖。
 *
 * 因此价格估计越低 → 越早返程；越高 → 挖得越久。
 * 不同信息粒度会让这条规则产生不同的采矿天数 —— 这正是 Decision Change Rate 的来源。
 */
export interface AdaptiveMinerOptions {
  /** 每日失败概率估计（用于把钱和风险换算到同一单位） */
  failPerDay?: number;
  /** 时间安全余量：返程最短天数 + buffer */
  buffer?: number;
  /** 耐力安全线：低于此值立即返程 */
  staminaFloor?: number;
  /** 价格估计提供者（按矿区槽位） */
  estimate: (slot: 'A' | 'B') => MineEstimate | null;
}

export function makeAdaptiveMinerBot(name: string, opts: AdaptiveMinerOptions): BotStrategy {
  const failPerDay = opts.failPerDay ?? 0.03;
  const buffer = opts.buffer ?? 4;
  const staminaFloor = opts.staminaFloor ?? 2;
  const equipment = { wantTents: 2, wantCompasses: 1, cashReserve: 0 };
  return {
    name,
    decide(view: FairView, _rng: BotRng): BotDecision {
      if (view.pendingEvent) {
        const c = eventChoiceFor(view);
        if (c) return { type: 'EVENT', choice: c };
      }
      // 装备与修整：与 ReasonablePlayerBot 一致，避免「裸奔出门」把实验变成测生存率
      const purchase = plannedPurchase(view, equipment);
      if (purchase) return { type: 'ACTION', action: purchase.action };
      if (wantsRest(view)) {
        return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
      }
      if (view.phase !== 'MINING') {
        // 去/返程直接复用生产 Bot 的规划器（SHORTEST），
        // 保证与 NoForecastBot 的运动质量一致 —— 本实验的自变量只有「采矿天数决策」。
        const to = view.phase === 'OUTBOUND'
          ? planOutboundStep(view, { kind: 'NEAREST' }, 'SHORTEST', () => 0.5)
          : planReturnStep(view, 'SHORTEST');
        return { type: 'MOVE', toTileId: to };
      }
      const slot = view.map.tiles[view.mineEntranceId ?? view.position]?.mineSlot ?? 'A';
      const est = opts.estimate(slot as 'A' | 'B');
      const point = est ? est.point : Math.round((PUB_LO + PUB_HI) / 2);
      const gemPerDay = 2;
      const cargoValue = view.gemsKg * point;
      const marginalRevenue = gemPerDay * point;
      const marginalRisk = cargoValue * failPerDay;
      // 真实最短合法返程天数（BFS，不是曼哈顿距离——后者会严重低估，导致超时）
      const trueReturn = minReturnDays(view) ?? 99;
      const timeSafe = view.daysRemaining > trueReturn + buffer;
      const staminaSafe = view.stamina > staminaFloor;
      const worthIt = marginalRevenue > marginalRisk;
      return timeSafe && staminaSafe && worthIt
        ? { type: 'ACTION', action: { type: 'MINE' } }
        : { type: 'ACTION', action: { type: 'START_RETURN' } };
    },
  };
}

function eventChoiceFor(view: FairView): EventChoice | null {
  const ev = view.pendingEvent;
  if (!ev) return null;
  const tentId = view.tents.length > 0 ? view.tents[0].id : undefined;
  switch (ev.kind) {
    case 'SANDSTORM':
      return { kind: 'SANDSTORM', useTent: view.tents.length > 0, useCompass: view.compasses > 0, tentId };
    case 'RAINSTORM':
      return { kind: 'RAINSTORM', useTent: view.tents.length > 0, tentId };
    case 'CARAVAN':
      return { kind: 'CARAVAN', action: 'TAKE_INTEL' };
    case 'THIEF':
      return { kind: 'THIEF', action: 'GIVE_UP' };
    case 'MARKET':
      return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
    default:
      return null;
  }
}

/** 简单的 BFS 逐步移动（shadow 专用，避免依赖生产 utils 的内部状态） */
function stepToward(view: FairView): TileId {
  const target = view.phase === 'MINING' ? view.map.cityId : nearestMineId(view);
  const banned = new Set<string>(view.phase === 'RETURN' ? [...view.visitedOutbound, ...view.visitedReturn] : view.visitedOutbound);
  banned.delete(view.map.cityId);
  if (view.mineEntranceId) banned.delete(view.mineEntranceId);
  const blockedMines = view.map.mineIds.filter((id) => id !== view.mineEntranceId && id !== target);
  const prev = new Map<string, string | null>([[view.position, null]]);
  const q: string[] = [view.position];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === target) {
      const path: string[] = [];
      let p: string | null = cur;
      while (p !== null) {
        path.unshift(p);
        p = prev.get(p) ?? null;
      }
      const next = path[1];
      return next && view.legalMoves.includes(next) ? next : view.legalMoves[0];
    }
    for (const nb of view.map.neighbors(cur)) {
      if (prev.has(nb)) continue;
      if (banned.has(nb) && nb !== target) continue;
      if (blockedMines.includes(nb)) continue;
      prev.set(nb, cur);
      q.push(nb);
    }
  }
  return view.legalMoves[0];
}

function nearestMineId(view: FairView): TileId {
  const d = (id: TileId) => {
    const t = view.map.tiles[id];
    const p = view.map.tiles[view.position];
    return Math.abs(t.row - p.row) + Math.abs(t.col - p.col);
  };
  return [...view.map.mineIds].sort((a, b) => d(a) - d(b))[0];
}

function minReturn(view: FairView): number {
  const p = view.map.tiles[view.position];
  const c = view.map.tiles[view.map.cityId];
  return Math.abs(p.row - c.row) + Math.abs(p.col - c.col);
}

/** Shadow 专用 runner：与生产 runner 同构，但注入观察提供者 */
export function runShadowMineInfo(
  bot: BotStrategy,
  seed: string,
  _variant: MineInfoVariant,
): RunResult {
  return shadowRun(bot, seed, null);
}

/* ------------------------------------------------------------------ */
/* B. 返程负重                                                          */
/* ------------------------------------------------------------------ */

export type LoadModel = 'model0' | 'modelA' | 'modelB' | 'modelC';

export const LOAD_THRESHOLD: Record<LoadModel, number> = {
  model0: Number.POSITIVE_INFINITY,
  modelA: 10,
  modelB: 15,
  modelC: 20,
};

export const LOAD_EVERY_MOVES = 5;

/* ------------------------------------------------------------------ */
/* 共用 runner（同构复刻生产 runOne，便于加实验层副作用）                 */
/* ------------------------------------------------------------------ */

export interface ShadowHooks {
  loadModel?: LoadModel;
}

export function shadowRun(bot: BotStrategy, seed: string, hooks: ShadowHooks | null): RunResult {
  let state = createNewGame(seed);
  const rng = makeBotRng(seed, bot.name);
  const acc = extractResult(state, bot.name, seed, null);
  const threshold = hooks?.loadModel ? LOAD_THRESHOLD[hooks.loadModel] : Number.POSITIVE_INFINITY;
  let returnMoves = 0;
  let loadStaminaLoss = 0;

  let turns = 0;
  while (state.status === 'ONGOING') {
    if (turns++ > MAX_TURNS) throw new Error(`shadowRun 超过最大回合数（${seed}/${bot.name}）`);
    const view = buildFairView(state);
    const decision = bot.decide(view, rng);
    if (decision.type === 'MOVE') {
      state = performMove(state, decision.toTileId);
      // 实验层：返程负重副作用（仅在 RETURN 阶段、且载重达标时生效）
      if (state.status === 'ONGOING' && state.phase === 'RETURN' && state.gemsKg >= threshold) {
        returnMoves += 1;
        if (returnMoves % LOAD_EVERY_MOVES === 0) {
          loadStaminaLoss += 1;
          state = { ...state, stamina: Math.max(0, state.stamina - 1) };
          if (state.stamina <= 0) {
            state = { ...state, status: 'DEFEAT', defeatReason: 'STAMINA_EXHAUSTED', phase: 'FINISHED' };
          }
        }
      }
    } else if (decision.type === 'ACTION') {
      const action: GameAction = decision.action;
      if (action.type === 'BUY') {
        if (action.item === 'tent') acc.tentsBought += 1;
        if (action.item === 'compass') acc.compassesBought += 1;
      }
      if (action.type === 'REST') acc.restCount = (acc.restCount ?? 0) + 1;
      if (action.type === 'WAIT') acc.waitCount = (acc.waitCount ?? 0) + 1;
      state = performAction(state, action);
    } else {
      const ev = state.pendingEvents[0];
      if (!ev) throw new Error('shadowRun 内部错误：事件队列不匹配');
      const before = { day: state.daysUsed, cash: state.cash };
      if (ENCOUNTER_KINDS.has(ev.kind)) acc.encounterCount = (acc.encounterCount ?? 0) + 1;
      if (decision.choice.kind === 'SANDSTORM' && decision.choice.useTent) acc.tentUses += 1;
      if (decision.choice.kind === 'RAINSTORM' && decision.choice.useTent) acc.tentUses += 1;
      if (decision.choice.kind === 'SANDSTORM' && decision.choice.useCompass) acc.compassUses += 1;
      state = resolvePendingEvent(state, ev.id, decision.choice);
      acc.events.push({
        kind: ev.kind,
        choice: summarizeEventChoice(decision.choice),
        dayDelta: state.daysUsed - before.day,
        cashDelta: state.cash - before.cash,
      });
    }
  }

  const final = extractResult(state, bot.name, seed, acc.error);
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
    returnLoadStaminaLoss: loadStaminaLoss,
  };
}

export type { GameState };
