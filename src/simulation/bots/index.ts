import type { BotRng, BotStrategy } from './types';
import type { EventChoice } from '../../game/types';
import type { FairView } from '../fairView';
import {
  baseBotDecide,
  blindNextTile,
  botTentId,
  pickFrom,
  type BaseBotConfig,
} from './utils';
import { MECHANISM_BOT_NAMES, mechanismBot } from './mechanismBots';
import { OUTCOME_BOT_NAMES, outcomeBot } from './outcomeBots';
import { ECON_BOT_NAMES, econBot } from './econBots';

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

type BotSpec = Omit<BaseBotConfig, 'forecastMaxPacks'> & { forecastMaxPacks?: number };

function makeBot(cfg: BotSpec): BotStrategy {
  const full: BaseBotConfig = { forecastMaxPacks: 0, ...cfg };
  const blind =
    full.forecast === 'never' ? undefined : (view: FairView) => blindNextTile(view, full);
  return {
    name: full.name,
    decide: (view, rng) => baseBotDecide(view, full, rng),
    ...(blind ? { blindMove: blind } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 天气预报策略梯度（v0.1.3 现金计价专项）                              */
/* ------------------------------------------------------------------ */
/**
 * 五个 Bot 除 `forecast` / `forecastMaxPacks` 外**完全同配置**：
 * 同一 mount 目标、同一路线风格（FORECAST：无预报时 = 纯最短路）、
 * 同一装备政策（2 帐篷 + 1 指南针）、同一采矿余量、同一事件应对。
 * 这样「买预报 vs 不买预报」的差异只来自预报本身，而不是装备或路线基线不同。
 */

/** 永远不购买（对照组基线） */
export const noForecastBot = makeBot({
  name: 'NoForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'FORECAST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'never',
  forecastMaxPacks: 0,
  rest: true,
  wait: true,
});

/** 只在特定风险条件下买 1 包（耐力见底 + 前方确有已知风险 / 无帐篷） */
export const lightForecastBot = makeBot({
  name: 'LightForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'FORECAST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'light',
  forecastMaxPacks: 1,
  rest: true,
  wait: true,
});

/** 本轮最重要的「真人代理」Bot：按风险/耐力/帐篷/阶段/现金综合打分决定是否买 */
export const adaptiveForecastBot = makeBot({
  name: 'AdaptiveForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'FORECAST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'adaptive',
  forecastMaxPacks: 3,
  rest: true,
  wait: true,
});

/** 明显偏爱预报，最多 5 包（检测「过度购买是否反而成为最优」） */
export const heavyForecastBot = makeBot({
  name: 'HeavyForecastBot',
  target: { kind: 'NEAREST' },
  movement: 'FORECAST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'heavy',
  forecastMaxPacks: 5,
  rest: true,
  wait: true,
});

/** 尽可能频繁购买，只看现金（检测低价/小包下是否形成预报滥用） */
export const forecastAbuserBot = makeBot({
  name: 'ForecastAbuserBot',
  target: { kind: 'NEAREST' },
  movement: 'FORECAST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'default',
  forecast: 'abuser',
  forecastMaxPacks: Number.POSITIVE_INFINITY,
  rest: true,
  wait: true,
});

/** 预报策略梯度全体（用于专项实验的固定 5 组对照） */
export const FORECAST_BOTS: BotStrategy[] = [
  noForecastBot,
  lightForecastBot,
  adaptiveForecastBot,
  heavyForecastBot,
  forecastAbuserBot,
];

/**
 * 兼容旧报告/脚本的别名：`ForecastBot` = AdaptiveForecastBot。
 * 旧报告里 ForecastBot 的数字对应的是「旧 maxDays 计价 + 旧 heuristic 策略」，
 * 不要跨版本直接对比数值。
 */
export const forecastBot: BotStrategy = adaptiveForecastBot;

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

/**
 * VillageWorkerBot —— 二次数值扫描专用：会考虑「市集打工」的真人代理。
 *
 * 与 ReasonablePlayerBot 完全同配置，唯一区别是事件政策为 'work'：
 * 市集上会按 `marketChoice()` 在「八折」与「打工」之间做取舍。
 * 之所以单独建一个 Bot 而不是改 ReasonablePlayerBot：
 *  - Forecast 实验的 5 个对照 Bot 必须保持事件政策不变，否则预报标定结果会被污染；
 *  - 这样「打工 vs 不打工」也是干净的单变量对照。
 */
export const villageWorkerBot = makeBot({
  name: 'VillageWorkerBot',
  target: { kind: 'NEAREST' },
  movement: 'SHORTEST',
  equipment: { wantTents: 2, wantCompasses: 1, cashReserve: 0 },
  miningBuffer: 6,
  eventPolicy: 'work',
  forecast: 'never',
  forecastMaxPacks: 0,
  rest: true,
  wait: false,
});

/** 更保守的对照：3 顶帐篷 + 2 只指南针，保留 9 天余量 */
export const cautiousPlayerBot = makeBot({  name: 'CautiousPlayerBot',
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
  ...FORECAST_BOTS,
  greedyMinerBot,
  conservativeMinerBot,
  mineABot,
  mineBBot,
  reasonablePlayerBot,
  cautiousPlayerBot,
  wastefulBot,
  villageWorkerBot,
];

export const BOT_BY_NAME: Record<string, BotStrategy> = {
  ...Object.fromEntries(ALL_BOTS.map((b) => [b.name, b])),
  // 机制专项 Bot（Autonomous Mechanism Evolution Lab）：
  // 不放进 ALL_BOTS，避免污染既有报告与"全部策略"清单。
  ...Object.fromEntries(MECHANISM_BOT_NAMES.map((n) => [n, mechanismBot(n)!])),
  // v0.2.0 Outcome & Mechanism Expansion Lab 专项 Bot（同样不进 ALL_BOTS）
  ...Object.fromEntries(OUTCOME_BOT_NAMES.map((n) => [n, outcomeBot(n)!])),
  // v0.3.0 Economic Independence Lab 专项 Bot（同样不进 ALL_BOTS）
  ...Object.fromEntries(ECON_BOT_NAMES.map((n) => [n, econBot(n)!])),
};
