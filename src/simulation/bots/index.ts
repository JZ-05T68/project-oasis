import type { BotRng, BotStrategy } from './types';
import type { EventChoice } from '../../game/types';
import type { FairView } from '../fairView';
import { baseBotDecide, botTentId, pickFrom, type BaseBotConfig } from './utils';

/**
 * v0.1.2 策略 Bot（格子地图版，供 Smoke Simulation 使用）。
 * 全部只通过 FairView（玩家视角）决策、只通过引擎 Action API 行动。
 */

/* ------------------------------------------------------------------ */
/* 1. RandomBot：最低基线，随机合法决策                                 */
/* ------------------------------------------------------------------ */

function randomEventChoice(view: FairView, rng: BotRng): EventChoice | null {
  const ev = view.pendingEvent;
  if (!ev) return null;
  const tentId = botTentId(view);
  switch (ev.kind) {
    case 'SANDSTORM': {
      const opts: EventChoice[] = [{ kind: 'SANDSTORM', useTent: false, useCompass: false }];
      if (view.tents.length > 0 && view.compasses > 0) {
        opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: true, tentId });
      }
      if (view.tents.length > 0) {
        opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: false, tentId });
      }
      if (view.compasses > 0) opts.push({ kind: 'SANDSTORM', useTent: false, useCompass: true });
      return pickFrom(opts, rng);
    }
    case 'RAINSTORM':
      return {
        kind: 'RAINSTORM',
        useTent: view.tents.length > 0 && rng() < 0.5,
        tentId,
      };
    case 'CARAVAN':
      return {
        kind: 'CARAVAN',
        action: view.cash >= 300 && rng() < 0.5 ? 'BUY_TENT' : 'TAKE_INTEL',
      };
    case 'THIEF':
      return { kind: 'THIEF', action: rng() < 0.5 ? 'CHASE' : 'GIVE_UP' };
    case 'MARKET':
      return { kind: 'MARKET', action: rng() < 0.5 ? 'TAKE_DISCOUNT' : 'WORK' };
    default:
      return null;
  }
}

export const randomBot: BotStrategy = {
  name: 'RandomBot',
  decide(view, rng) {
    if (view.pendingEvent) {
      const c = randomEventChoice(view, rng);
      if (c) return { type: 'EVENT', choice: c };
    }
    if (view.phase === 'MINING') {
      return rng() < 0.7
        ? { type: 'ACTION', action: { type: 'MINE' } }
        : { type: 'ACTION', action: { type: 'START_RETURN' } };
    }
    const actions = view.availableActions.filter((a) => !a.disabled);
    if (actions.length > 0 && rng() < 0.2) {
      const picked = pickFrom(actions, rng).action;
      if (picked.type === 'WAIT' || picked.type === 'REST') {
        if (picked.tentId === undefined && view.tents.length === 0 && view.map.tiles[view.position].terrain !== 'CITY' && view.map.tiles[view.position].terrain !== 'VILLAGE') {
          // 无帐篷不能野外宿营——退回移动
        } else {
          return {
            type: 'ACTION',
            action: { ...picked, tentId: picked.tentId ?? botTentId(view) },
          };
        }
      } else {
        return { type: 'ACTION', action: picked };
      }
    }
    if (view.legalMoves.length === 0) {
      throw new Error('RandomBot 无可行动作');
    }
    return { type: 'MOVE', toTileId: pickFrom(view.legalMoves, rng) };
  },
};

/* ------------------------------------------------------------------ */
/* 2～11. 基于 baseBotDecide 的策略 Bot                                 */
/* ------------------------------------------------------------------ */

function makeBot(cfg: BaseBotConfig): BotStrategy {
  return { name: cfg.name, decide: (view, rng) => baseBotDecide(view, cfg, rng) };
}

export const shortestPathBot = makeBot({
  name: 'ShortestPathBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 4,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
  wait: false,
});

export const safeBot = makeBot({
  name: 'SafeBot',
  target: { kind: 'SAFEST' },
  movement: 'SAFEST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 200 },
  miningBuffer: 8,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

export const preparedBot = makeBot({
  name: 'PreparedBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 3, wantCompasses: 2, cashReserve: 300 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

export const cheapBot = makeBot({
  name: 'CheapBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 0, wantCompasses: 0, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'cheap',
  forecast: 'never',
  rest: false,
  wait: false,
});

export const forecastBot = makeBot({
  name: 'ForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 100 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'heuristic',
  rest: true,
  wait: true,
});

export const noForecastBot = makeBot({
  name: 'NoForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 100 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

export const greedyMinerBot = makeBot({
  name: 'GreedyMinerBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 1,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
  wait: false,
});

export const conservativeMinerBot = makeBot({
  name: 'ConservativeMinerBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 2, wantCompasses: 2, cashReserve: 100 },
  miningBuffer: 10,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
  wait: false,
});

export const mineABot = makeBot({
  name: 'MineABot',
  target: { kind: 'FIXED', slot: 'A' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
  wait: false,
});

export const mineBBot = makeBot({
  name: 'MineBBot',
  target: { kind: 'FIXED', slot: 'B' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
  wait: false,
});

/* ------------------------------------------------------------------ */
/* 经济校准基准 Bot（v0.1.2b Human Playtest Fix Round 1）               */
/* ------------------------------------------------------------------ */

/**
 * ReasonablePlayerBot —— 代表「基本理性的真人玩家」。
 *
 * 行为（不做任何上帝视角操作，全部基于 FairView 的合法 Action）：
 * - 装备：2 顶帐篷 + 1 只指南针（覆盖 2 次沙暴或 1 次暴雨 + 1 次沙暴，不过度囤货）；
 * - 路线：走最近的矿区，去返程都用最短合法路线，不刻意绕路踩危险地形；
 * - 采矿：始终为自己保留 6 天机动余量（沙尘暴迷路 / 泥沼 / 追贼各可能吃掉 1 天）；
 * - 事件：沙暴用帐篷+指南针，暴雨用帐篷，盗贼在时间宽裕时追回，市集拿八折；
 * - 绿洲：有水且耐力未满时修整。
 *
 * 经济校准以它为准，避免把「无意义买 5 顶帐篷 / 只挖 1 天 / 可以返程却继续拖延」
 * 这类愚蠢行为的亏损算进价格保底里。
 */
export const reasonablePlayerBot = makeBot({
  name: 'ReasonablePlayerBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

/** 更保守的对照：3 顶帐篷 + 2 只指南针，保留 9 天余量 */
export const cautiousPlayerBot = makeBot({
  name: 'CautiousPlayerBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 3, wantCompasses: 2, cashReserve: 0 },
  miningBuffer: 9,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

/** 浪费型对照：无意义买 5 顶帐篷 + 3 只指南针（用于确认「乱花钱仍会亏损」） */
export const wastefulBot = makeBot({
  name: 'WastefulBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 5, wantCompasses: 3, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
  wait: false,
});

/** 全部策略（含 RandomBot） */
export const ALL_BOTS: BotStrategy[] = [
  randomBot,
  shortestPathBot,
  safeBot,
  preparedBot,
  cheapBot,
  forecastBot,
  noForecastBot,
  greedyMinerBot,
  conservativeMinerBot,
  mineABot,
  mineBBot,
  reasonablePlayerBot,
  cautiousPlayerBot,
  wastefulBot,
];

export const BOT_BY_NAME: Record<string, BotStrategy> = Object.fromEntries(
  ALL_BOTS.map((b) => [b.name, b]),
);
