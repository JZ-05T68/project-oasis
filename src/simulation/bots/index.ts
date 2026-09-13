import type { BotRng, BotStrategy } from './types';
import type { EventChoice } from '../../game/types';
import type { FairView } from '../fairView';
import { baseBotDecide, botTentIndex, pickFrom, type BaseBotConfig } from './utils';

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
  const tentIdx = botTentIndex(view);
  switch (ev.kind) {
    case 'SANDSTORM': {
      const opts: EventChoice[] = [{ kind: 'SANDSTORM', useTent: false, useCompass: false }];
      if (view.tents.length > 0 && view.compasses > 0) {
        opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: true, tentIndex: tentIdx });
      }
      if (view.tents.length > 0) {
        opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: false, tentIndex: tentIdx });
      }
      if (view.compasses > 0) opts.push({ kind: 'SANDSTORM', useTent: false, useCompass: true });
      return pickFrom(opts, rng);
    }
    case 'RAINSTORM':
      return {
        kind: 'RAINSTORM',
        useTent: view.tents.length > 0 && rng() < 0.5,
        tentIndex: tentIdx,
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
        if (picked.tentIndex === undefined && view.tents.length === 0 && view.map.tiles[view.position].terrain !== 'CITY' && view.map.tiles[view.position].terrain !== 'VILLAGE') {
          // 无帐篷不能野外宿营——退回移动
        } else {
          return {
            type: 'ACTION',
            action: { ...picked, tentIndex: picked.tentIndex ?? botTentIndex(view) },
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
];

export const BOT_BY_NAME: Record<string, BotStrategy> = Object.fromEntries(
  ALL_BOTS.map((b) => [b.name, b]),
);
