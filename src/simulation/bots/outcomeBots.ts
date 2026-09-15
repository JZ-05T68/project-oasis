import type { EventChoice, GameAction, TileId } from '../../game/types';
import type { BotDecision, BotRng, BotStrategy } from '../runner';
import type { FairView } from '../fairView';
import {
  minReturnCostLoadAware,
  minReturnDays,
  expectedMoveDays,
  bfsDistMap,
  returnForbidden,
  returnViaFilter,
} from '../simGraph';
import {
  baseBotDecide,
  botTentId,
  eventChoice,
  planOutboundStep,
  planReturnStep,
  plannedPurchase,
  wantsRest,
  type MineTarget,
} from './utils';
import { dropDecision, planLoadAwareReturnStep, DROP_SAFETY_DAYS } from './mechanismBots';

/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 新机制族的专项 Bot。
 *
 * 每个新机制都必须有 (§28)：
 *   - MechanismAware  —— 真的读 `view.rules.*` 并把信息用进决策
 *   - MechanismBlind  —— **同骨架、同装备、同事件策略**，只把机制信息置空
 * 两组同 Seed 跑，才能证明「机制真的改变了决策」而不是「Bot 运气不同」。
 *
 * 骨架统一复用既有生产逻辑（plannedPurchase / wantsRest / eventChoice /
 * planOutboundStep），只在新机制的分支上分叉——这是 sim-balance-lab 的
 * 「陷阱 A」要求：新 Bot 若不继承基础生存策略，测出来的是生存率而不是机制。
 */

const EQUIP_SAFE = { wantTents: 2, wantCompasses: 1, cashReserve: 0 };
/** 指南针型情报需要 1 只指南针，因此这组 Bot 带 2 只（否则机制永远无法触发） */
const EQUIP_SCOUT = { wantTents: 2, wantCompasses: 2, cashReserve: 0 };

/** 把 view.rules 里的 v0.2.0 机制信息全部置空的盲视图 */
export function blindOutcomeView(view: FairView): FairView {
  return {
    ...view,
    rules: {
      ...view.rules,
      returnIntel: { enabled: false, mode: 'survey1', coneCandidates: 0, scoutRadius: 0, compassCostPerScout: 0 },
      villageService: {
        enabled: false,
        restCostPerStamina: 0,
        intelPrice: 0,
        intelTiles: 0,
        sellEnabled: false,
        sellPriceRatio: 0,
        sellStepKg: 0,
      },
      surgeMining: { enabled: false, oncePerRun: true, yieldMultiplier: 1, extraDays: 0, used: true },
      emergencyRescue: {
        enabled: false,
        cost: 0,
        extraDays: 0,
        staminaBack: 0,
        triggerMarginDays: 0,
        used: 99,
        maxUses: 0,
        expectedReturnDays: 0,
      },
      villageHere: false,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 1. 通用：从 availableActions 里挑一个合法 Action                       */
/* ------------------------------------------------------------------ */

function pickAction(view: FairView, type: string): GameAction | null {
  const found = view.availableActions.find((a) => a.action.type === type && !a.disabled);
  return found ? found.action : null;
}

/* ------------------------------------------------------------------ */
/* 2. Family G —— 深层采矿决策（矿区第二层决策）                          */
/* ------------------------------------------------------------------ */

/**
 * 深层采矿值不值得拿？——**刻意做成一眼可理解的三条判据**，不需要算期望值（§15）：
 *
 *   ① 时间够不够：拿完之后仍然能在时限内完成返程（含安全余量）；
 *   ② 拿了之后会不会超载到"返程彻底走不动"（负重惩罚的上限台阶）；
 *   ③ 机会成本：只有当这次机会能把收益明显推高时才拿。
 *
 * 第 ③ 条用「倍率 ≥ 2」+「剩余时间宽裕」表达——玩家看到的就是
 * 「一次能多敲 3 倍的矿，但要多待 1 天」，不需要任何数字表格。
 */
export function surgeDecision(view: FairView, buffer: number): GameAction | null {
  const cfg = view.rules.surgeMining;
  if (!cfg.enabled || cfg.used) return null;
  if (view.phase !== 'MINING') return null;

  const nextYield = view.rules.nextMiningYield;
  const gained = nextYield * cfg.yieldMultiplier;
  // 拿完之后的位置与载重
  const after: FairView = { ...view, gemsKg: view.gemsKg + gained };
  const baseReturn = minReturnCostLoadAware(after) ?? minReturnDays(after);
  if (baseReturn === null) return null;
  // ① 时间：额外 extraDays 之后仍要有余量
  const slack = view.daysRemaining - cfg.extraDays - baseReturn - buffer;
  if (slack <= 0) return null; // 拿不起 → 不拿（这就是决策的一半）
  // ② 不能把载重推到负重惩罚的上限档（那等于返程彻底瘫痪）
  const load = view.rules.loadReturn;
  if (load.enabled) {
    const afterSteps = Math.floor(Math.max(0, after.gemsKg - load.thresholdKg) / load.stepKg);
    if (afterSteps > load.maxExtraPerDesertTile - 1 && load.maxExtraPerDesertTile > 0) {
      // 已经到顶格就不再加重
      if (after.gemsKg >= load.thresholdKg + load.stepKg * load.maxExtraPerDesertTile) return null;
    }
  }
  // ③ 机会成本：倍率必须真的值得（≥1.5 才拿，避免"多花 1 天换 1.1 倍"这种亏本买卖）
  if (cfg.yieldMultiplier < 1.5) return null;
  return { type: 'SURGE_MINE' };
}

/* ------------------------------------------------------------------ */
/* 3. Family F —— 村庄服务决策                                           */
/* ------------------------------------------------------------------ */

/**
 * 村庄三选一（每个都是一眼可理解的规则）：
 *
 *   REST  —— 只有当「耐力 ≤ 3（真的危险）且现金充裕」才歇脚。
 *            刻意不是"见村就休"：那会让村庄变成必停点（§13 禁止）。
 *   INTEL —— 只有当「返程还没开始或刚开始、且还有大量迷雾」时才买；
 *            已经走了一半再买情报毫无价值。
 *   SELL  —— 只有当「超载 + 时间吃紧」时才卖。它比丢货好一点点（换回现金），
 *            但比回城鉴定亏得多，因此不是常规变现手段。
 */
export function villageDecision(view: FairView, cashReserve: number): GameAction | null {
  const cfg = view.rules.villageService;
  if (!cfg.enabled || !view.rules.villageHere) return null;

  // REST：耐力危险 + 付得起 + 留够余量
  if (view.stamina <= 3 && view.cash - cfg.restCostPerStamina >= cashReserve) {
    const a = pickAction(view, 'VILLAGE_SERVICE');
    // 需要精确挑到 REST：逐个扫描 availableActions
    const rest = view.availableActions.find(
      (x) => x.action.type === 'VILLAGE_SERVICE' && x.action.service === 'REST' && !x.disabled,
    );
    if (rest) return rest.action;
    void a;
  }

  // SELL：超载 + 时间吃紧 → 卖货减负（比纯丢货好：至少换回现金）
  if (cfg.sellEnabled && view.gemsKg > 0 && view.rules.loadReturn.overloaded) {
    const eta = minReturnCostLoadAware(view) ?? minReturnDays(view);
    if (eta !== null && view.daysRemaining - eta < DROP_SAFETY_DAYS) {
      const sell = view.availableActions.find(
        (x) => x.action.type === 'VILLAGE_SERVICE' && x.action.service === 'SELL' && !x.disabled,
      );
      if (sell) return sell.action;
    }
  }

  // INTEL：返程刚开始（还没走几步）且还有未知地形 → 买情报
  if (view.cash - cfg.intelPrice >= cashReserve) {
    const unknownAhead = countUnknownNearCityDirection(view);
    if (unknownAhead >= 2) {
      const intel = view.availableActions.find(
        (x) => x.action.type === 'VILLAGE_SERVICE' && x.action.service === 'INTEL' && !x.disabled,
      );
      if (intel) return intel.action;
    }
  }
  return null;
}

/** 朝城市方向的候选格里有多少还是未知地形（决定"买情报值不值"） */
function countUnknownNearCityDirection(view: FairView): number {
  let unknown = 0;
  for (const id of view.map.neighbors(view.position)) {
    const t = view.map.tiles[id];
    if (!t) continue;
    if (t.isCity || t.isMine) continue;
    if (t.terrain === null) unknown += 1;
  }
  return unknown;
}

/* ------------------------------------------------------------------ */
/* 4. Family E —— 指南针侦察决策                                         */
/* ------------------------------------------------------------------ */

/**
 * 什么时候花指南针侦察？
 *   只有在**返程途中**、且「前方仍有未知地形会影响选路」时才花。
 *   同时必须为"沙尘暴需要指南针"留 1 只（否则侦察会把救命道具吃光）。
 */
export function scoutDecision(view: FairView): GameAction | null {
  const cfg = view.rules.returnIntel;
  if (!cfg.enabled || cfg.mode !== 'compass') return null;
  if (view.phase !== 'RETURN') return null;
  // 为沙尘暴保留 1 只
  if (view.compasses <= cfg.compassCostPerScout) return null;
  if (countUnknownNearCityDirection(view) < 2) return null;
  return pickAction(view, 'SCOUT');
}

/* ------------------------------------------------------------------ */
/* 5. Family H —— 应急补救（求援）决策                                    */
/* ------------------------------------------------------------------ */

/**
 * 求援只在两种情况下用（与引擎的门槛一致）：
 *   ① 时间真的不够了（剩余天数 − 返程估计 < margin）
 *   ② 耐力见底（≤ 2）
 * 并且要求「求援后确实能活下来」——如果连求援都救不回来，就不该浪费这 400 元。
 */
export function rescueDecision(view: FairView, cashReserve: number): GameAction | null {
  const cfg = view.rules.emergencyRescue;
  if (!cfg.enabled) return null;
  if (cfg.used >= cfg.maxUses) return null;
  if (view.cash - cfg.cost < cashReserve) return null;

  const eta = minReturnCostLoadAware(view) ?? minReturnDays(view);
  const daysLeft = view.daysRemaining;
  const timeTight = eta === null || daysLeft - eta < cfg.triggerMarginDays;
  const staminaLow = view.stamina <= 2;
  if (!timeTight && !staminaLow) return null;
  // 求援后能不能真的走完？不能就别浪费钱
  if (eta !== null && daysLeft + cfg.extraDays - eta < 0) return null;
  return pickAction(view, 'EMERGENCY_RESCUE');
}

/* ------------------------------------------------------------------ */
/* 6. OutcomeMasterBot —— 读全部新机制的合理玩家代理                       */
/* ------------------------------------------------------------------ */

export interface OutcomeBotOptions {
  name: string;
  buffer?: number;
  target?: MineTarget;
  /** 是否读机制（false = 同骨架盲对照组） */
  aware: boolean;
  /**【单机制对照用】只打开某一个机制族，其余按"不理会"处理 */
  only?: 'surge' | 'village' | 'scout' | 'rescue' | 'all';
  cashReserve?: number;
  /** 指南针装备数（侦察机制需要 2 只） */
  compasses?: number;
}

/**
 * OutcomeMasterBot —— v0.2.0 的「合理玩家代理」。
 *
 * 它在既有 AdaptiveMinerBot 的骨架上，按优先级依次检查新机制：
 *   求援（救命）> 村庄服务 > 侦察 > 深层采矿 > 常规挖矿/返程
 * 优先级刻意按"救命的排前面"排列，这既是真人会做的顺序，也避免
 * 「为了多敲一矿而错过救命机会」这种明显不合理的坏玩法污染结论。
 */
export function makeOutcomeBot(opts: OutcomeBotOptions): BotStrategy {
  const buffer = opts.buffer ?? 5;
  const target: MineTarget = opts.target ?? { kind: 'NEAREST' };
  const reserve = opts.cashReserve ?? 0;
  const only = opts.only ?? 'all';
  const equip = (opts.compasses ?? 2) > 1 ? EQUIP_SCOUT : EQUIP_SAFE;
  const watch = (k: 'surge' | 'village' | 'scout' | 'rescue'): boolean =>
    opts.aware && (only === 'all' || only === k);

  const decideInner = (view: FairView, rng: BotRng): BotDecision => {
    if (view.pendingEvent) {
      const c = eventChoice(view, 'default');
      if (c) return { type: 'EVENT', choice: c };
    }
    const purchase = plannedPurchase(view, equip);
    if (purchase) return { type: 'ACTION', action: purchase.action };
    if (wantsRest(view)) {
      return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
    }

    /* --- 新机制分支（按救命优先级排序） --- */
    if (watch('rescue')) {
      const r = rescueDecision(view, reserve);
      if (r) return { type: 'ACTION', action: r };
    }
    if (watch('village') && view.rules.villageHere) {
      const v = villageDecision(view, reserve);
      if (v) return { type: 'ACTION', action: v };
    }
    if (watch('scout')) {
      const s = scoutDecision(view);
      if (s) return { type: 'ACTION', action: s };
    }
    if (watch('surge')) {
      const g = surgeDecision(view, buffer);
      if (g) return { type: 'ACTION', action: g };
    }

    /* --- 常规采矿 / 丢货 / 移动（与 AdaptiveMinerBot 完全同构） --- */
    if (view.phase === 'MINING') {
      const marginal = miningMarginalOutcome(view, buffer);
      return marginal
        ? { type: 'ACTION', action: { type: 'MINE' } }
        : { type: 'ACTION', action: { type: 'START_RETURN' } };
    }
    if (view.phase === 'RETURN') {
      const drop = dropDecision(view, 1);
      if (drop) return { type: 'ACTION', action: drop };
    }
    if (view.phase === 'OUTBOUND') {
      return { type: 'MOVE', toTileId: planOutboundStep(view, target, 'SHORTEST', rng) };
    }
    return { type: 'MOVE', toTileId: planLoadAwareReturnStep(view, 'SHORTEST') };
  };

  const bot: BotStrategy = {
    name: opts.name,
    decide: (view, rng) => decideInner(view, rng),
    blindMove: (view) => {
      if (view.phase !== 'RETURN') return null;
      const d = decideInner(blindOutcomeView(view), () => 0.5);
      return d.type === 'MOVE' ? d.toTileId : null;
    },
  };
  return bot;
}

/**
 * 采矿边际判断（与 mechanismBots.miningMarginal 同构，但额外把
 * **深层采矿的额外天数**计入机会成本——否则 Bot 会先把时间花光再想深层采矿，
 * 导致机制永远无法被使用（这是"Bot 缺陷伪装成机制失败"的典型）。
 */
function miningMarginalOutcome(view: FairView, buffer: number): boolean {
  const r = view.rules;
  const baseReturn = minReturnCostLoadAware(view) ?? minReturnDays(view);
  if (baseReturn === null) return false;
  // 若深层采矿机会还在，为它预留 extraDays——这样 Bot 会在"还能拿"的时候拿
  const surgeReserve =
    r.surgeMining.enabled && !r.surgeMining.used ? r.surgeMining.extraDays : 0;
  const loadBuffer = r.loadReturn.extraDaysPerDesertTile;
  const accidentDays = r.accidentRisk.enabled ? r.nextMiningAccidentChance * r.accidentRisk.extraDays : 0;
  const slack = view.daysRemaining - baseReturn - accidentDays - loadBuffer - buffer - surgeReserve;
  return slack > 0 && view.stamina > 1;
}

/* ------------------------------------------------------------------ */
/* 7. 纯盲对照 Bot（完全不读任何 v0.2.0 机制）                            */
/* ------------------------------------------------------------------ */

/** 与 OutcomeMasterBot 同骨架，但把全部 v0.2.0 机制信息置空 */
export function makeOutcomeBlindBot(name: string, buffer = 5): BotStrategy {
  const bot = makeOutcomeBot({ name, buffer, aware: false });
  return {
    name,
    decide: (view) => baseBotDecide(view, {
      name,
      target: { kind: 'NEAREST' },
      movement: 'SHORTEST',
      equipment: EQUIP_SAFE,
      miningBuffer: buffer,
      eventPolicy: 'default',
      forecast: 'never',
      forecastMaxPacks: 0,
      rest: true,
      wait: false,
    }, () => 0.5),
    ...(bot.blindMove ? { blindMove: bot.blindMove } : {}),
  };
}

void expectedMoveDays;
void bfsDistMap;
void returnForbidden;
void returnViaFilter;
void planReturnStep;
export type { EventChoice, TileId };

/* ------------------------------------------------------------------ */
/* 8. 对外导出（供 worker 按名字构造）                                    */
/* ------------------------------------------------------------------ */

export function outcomeBot(name: string): BotStrategy | null {
  switch (name) {
    /* --- 全量：读全部 v0.2.0 机制 --- */
    case 'OutcomeMasterBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'all', compasses: 2 });
    case 'OutcomeMasterNoReserveBot':
      // 不预留装备预算的"莽一点"版本，用于确认结算余量真的是决策而不是运气
      return makeOutcomeBot({ name, buffer: 3, aware: true, only: 'all', compasses: 2 });

    /* --- 单机制对照：只读一个族，其余忽略 --- */
    case 'SurgeOnlyBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'surge', compasses: 2 });
    case 'VillageOnlyBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'village', compasses: 2 });
    case 'ScoutOnlyBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'scout', compasses: 2 });
    case 'RescueOnlyBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'rescue', compasses: 2 });

    /* --- 盲对照：同骨架，完全不读 v0.2.0 机制 --- */
    case 'OutcomeBlindBot':
      return makeOutcomeBlindBot(name, 5);
    case 'OutcomeBlindTightBot':
      return makeOutcomeBlindBot(name, 3);

    /* --- 装备梯度（沿用既有装备哲学，便于与旧报告对齐） --- */
    case 'OutcomeCheapBot':
      return makeOutcomeBot({ name, buffer: 5, aware: true, only: 'all', cashReserve: 0, compasses: 1 });
    default:
      return null;
  }
}

export const OUTCOME_BOT_NAMES = [
  'OutcomeMasterBot',
  'OutcomeMasterNoReserveBot',
  'SurgeOnlyBot',
  'VillageOnlyBot',
  'ScoutOnlyBot',
  'RescueOnlyBot',
  'OutcomeBlindBot',
  'OutcomeBlindTightBot',
  'OutcomeCheapBot',
] as const;
