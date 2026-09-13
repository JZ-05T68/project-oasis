import type { BotStrategy, BotRng } from './types';
import type { EventChoice } from '../../game/types';
import { baseBotDecide, pickFrom, type BaseBotConfig } from './utils';
import type { FairView } from '../fairView';

/**
 * v0.1.1 首批 12 个策略 Bot。
 * 全部只通过 FairView（玩家视角）决策、只通过引擎 Action API 行动。
 */

/* ------------------------------------------------------------------ */
/* 1. RandomBot：最低基线，随机合法决策                                  */
/* ------------------------------------------------------------------ */

function randomEventChoice(view: FairView, rng: BotRng): EventChoice | null {
  const ev = view.pendingEvent;
  if (!ev) return null;
  switch (ev.kind) {
    case 'SANDSTORM': {
      const opts: EventChoice[] = [{ kind: 'SANDSTORM', useTent: false, useCompass: false }];
      if (view.tents.length > 0 && view.compasses > 0) {
        opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: true });
      }
      if (view.tents.length > 0) opts.push({ kind: 'SANDSTORM', useTent: true, useCompass: false });
      if (view.compasses > 0) opts.push({ kind: 'SANDSTORM', useTent: false, useCompass: true });
      return pickFrom(opts, rng);
    }
    case 'RAINSTORM':
      return { kind: 'RAINSTORM', useTent: view.tents.length > 0 && rng() < 0.5 };
    case 'CARAVAN':
      return {
        kind: 'CARAVAN',
        action: view.cash >= 300 && rng() < 0.5 ? 'BUY_TENT' : 'TAKE_INTEL',
      };
    case 'THIEF':
      return { kind: 'THIEF', action: rng() < 0.5 ? 'CHASE' : 'GIVE_UP' };
    case 'MARKET':
      return { kind: 'MARKET', action: rng() < 0.5 ? 'TAKE_DISCOUNT' : 'WORK' };
    case 'FORECAST_OFFER':
      return { kind: 'FORECAST_OFFER', accept: rng() < 0.3 };
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
    if (actions.length > 0 && rng() < 0.25) {
      return { type: 'ACTION', action: pickFrom(actions, rng).action };
    }
    if (view.legalMoves.length === 0) {
      // 无路可走：交给引擎的路线中断判定（例如原地休整）
      const rest = actions.find((a) => a.action.type === 'REST');
      if (rest) return { type: 'ACTION', action: rest.action };
      throw new Error('RandomBot 无可行动作');
    }
    return { type: 'MOVE', toNodeId: pickFrom(view.legalMoves, rng) };
  },
};

/* ------------------------------------------------------------------ */
/* 2～12. 基于 baseBotDecide 的策略 Bot                                 */
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
});

export const forecastBot = makeBot({
  name: 'ForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'SAFEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 100 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'heuristic',
  rest: true,
});

export const noForecastBot = makeBot({
  name: 'NoForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'SAFEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 100 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: true,
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
});

export const southMineBot = makeBot({
  name: 'SouthMineBot',
  target: { kind: 'FIXED', mineId: 'mineS' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
});

export const middleMineBot = makeBot({
  name: 'MiddleMineBot',
  target: { kind: 'FIXED', mineId: 'mineC' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
});

export const northMineBot = makeBot({
  name: 'NorthMineBot',
  target: { kind: 'FIXED', mineId: 'mineN' },
  movement: 'SHORTEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
});

/** 天气预报价值对照（北矿高风险路线）：两者唯一差异是是否使用天气预报 */
export const northForecastBot = makeBot({
  name: 'NorthForecastBot',
  target: { kind: 'FIXED', mineId: 'mineN' },
  movement: 'SAFEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'heuristic',
  rest: false,
});

export const northNoForecastBot = makeBot({
  name: 'NorthNoForecastBot',
  target: { kind: 'FIXED', mineId: 'mineN' },
  movement: 'SAFEST',
  equipment: { wantTents: 1, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 5,
  eventPolicy: 'default',
  forecast: 'never',
  rest: false,
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
  southMineBot,
  middleMineBot,
  northMineBot,
  northForecastBot,
  northNoForecastBot,
];

export const BOT_BY_NAME: Record<string, BotStrategy> = Object.fromEntries(
  ALL_BOTS.map((b) => [b.name, b]),
);
