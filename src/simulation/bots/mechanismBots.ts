import type { EventChoice, GameAction, TileId } from '../../game/types';
import type { BotDecision, BotRng, BotStrategy } from '../runner';
import type { FairView } from '../fairView';
import { gameConfig } from '../../game/config/gameConfig';
import { desertExtraDaysForLoad } from '../../game/rules/mining';
import {
  bfsPath,
  dijkstraPath,
  minReturnDays,
  minReturnCostLoadAware,
  returnForbidden,
  returnViaFilter,
  expectedMoveDays,
  bfsDistMap,
} from '../simGraph';
import {
  baseBotDecide,
  botTentId,
  eventChoice,
  planOutboundStep,
  planReturnStep,
  plannedPurchase,
  wantsRest,
  type MovementStyle,
  type MineTarget,
} from './utils';

/**
 * Autonomous Mechanism Evolution Lab —— 机制专项 Bot。
 *
 * 设计原则（来自 sim-balance-lab 的「必查陷阱 A」）：
 *  1. 新 Bot **必须继承基础装备 / 休整 / 事件策略**，否则测出来的是生存率而不是被测机制；
 *  2. 新 Bot **必须真的读取机制信息**（view.rules.*），并且这些信息**必须真的能改变动作**；
 *  3. 每个 Bot 暴露 `blindMove`：把机制信息置空后重放**同一套决策骨架**，
 *     用来区分「读了也改了」与「读了没改」。
 */

/** 公开定价区间（规则页已知：140 ~ 320 元/kg）→ 取中值作为先验估计，不使用真值 */
const PRICE_LO = 140;
const PRICE_HI = 320;
const PRICE_EST = Math.round((PRICE_LO + PRICE_HI) / 2);

const EQUIP = { wantTents: 2, wantCompasses: 1, cashReserve: 0 };

/* ------------------------------------------------------------------ */
/* 通用：把一次「采矿 vs 返程」的边际账算清楚                              */
/* ------------------------------------------------------------------ */

export interface MiningMarginal {
  /** 再挖一天的期望收益（元） */
  gain: number;
  /** 再挖一天的期望损失（元 + 时间） */
  lossCash: number;
  /** 再挖一天带来的额外时间占用（天，期望） */
  lossDays: number;
  /** 返程所需天数（含负重期望） */
  returnCost: number;
  /** 剩余时间余量 */
  slack: number;
  /** 结论 */
  mine: boolean;
}

/**
 * 边际分析（全部只用 view.rules 里的公开规则参数 + 公开价格区间）：
 *
 *   期望收益 = 下一天产量 × 价格先验
 *   期望损失 = P(事故) × [ 当日产量 × 价格 × 损失比例
 *                        + 已携带货值 × 价格 × 货损比例 ]
 *   时间约束 = 剩余天数 > 返程代价（含负重期望） + buffer + 事故期望天数
 *
 * 关键：`returnCost` 用的是**负重感知**代价，所以「多挖一天 → 货更重 → 返程更贵」
 * 这条链路会真实进入决策，这正是 Goal B 要求的「采矿量影响返程选择」。
 */
export function miningMarginal(view: FairView, buffer: number): MiningMarginal {
  const r = view.rules;
  // 机制关闭时负重感知代价退化为纯 BFS 跳数，这里直接短路，避免无谓的 Dijkstra
  const nextYield = r.nextMiningYield;
  const gain = nextYield * PRICE_EST;

  // 事故期望损失
  let lossCash = 0;
  if (r.accidentRisk.enabled) {
    const p = r.nextMiningAccidentChance;
    const yieldLost = nextYield * r.accidentRisk.yieldLossFraction * PRICE_EST;
    const cargoLost = view.gemsKg * r.accidentRisk.cargoLossFraction * PRICE_EST;
    lossCash = p * (yieldLost + cargoLost);
  }

  // 时间：返程代价 + 事故额外天数期望 + buffer + 负重不确定缓冲
  const baseReturn = minReturnCostLoadAware(view) ?? minReturnDays(view) ?? 99;
  const accidentDays = r.accidentRisk.enabled
    ? r.nextMiningAccidentChance * r.accidentRisk.extraDays
    : 0;
  // 负重机制下返程代价对"路上会不会撞上沙漠"高度敏感，只按期望值规划会系统性偏紧，
  // 于是玩家几乎每天都要靠紧急丢货救场（实测 dropRate 70.8%）。这里显式多留
  // 「一格沙漠的额外天数」作为不确定缓冲，让"提前少挖"成为真正的规划动作。
  const loadBuffer = r.loadReturn.extraDaysPerDesertTile;
  const returnCost = baseReturn + accidentDays;
  const slack = view.daysRemaining - returnCost - buffer - loadBuffer;

  const profitable = gain > lossCash;
  const mine = slack > 0 && view.stamina > 1 && profitable;
  return { gain, lossCash, lossDays: accidentDays, returnCost, slack, mine };
}

/* ------------------------------------------------------------------ */
/* 1. AdaptiveMinerBot —— 会算账的矿工（Goal A 的真人代理）               */
/* ------------------------------------------------------------------ */

export interface AdaptiveMinerOptions {
  name: string;
  buffer?: number;
  target?: MineTarget;
  movement?: MovementStyle;
  /** 是否在返程中考虑丢货减负 */
  considerDrop?: boolean;
  /** 丢货阈值：省下的期望天数价值 > 丢掉的宝石价值时才丢 */
  dropEagerness?: number;
}

export function makeAdaptiveMinerBot(opts: AdaptiveMinerOptions): BotStrategy {
  const buffer = opts.buffer ?? 4;
  const target: MineTarget = opts.target ?? { kind: 'NEAREST' };
  const movement: MovementStyle = opts.movement ?? 'SHORTEST';
  const considerDrop = opts.considerDrop ?? false;
  const eagerness = opts.dropEagerness ?? 1;

  /** 决策骨架（与 baseBotDecide 同构，只在采矿/丢货两处新增机制分支） */
  const decideInner = (view: FairView, useMechanism: boolean, rng: BotRng): BotDecision => {
    if (view.pendingEvent) {
      const c = eventChoice(view, 'default');
      if (c) return { type: 'EVENT', choice: c };
    }
    const purchase = plannedPurchase(view, EQUIP);
    if (purchase) return { type: 'ACTION', action: purchase.action };
    if (wantsRest(view)) {
      return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
    }

    if (view.phase === 'MINING') {
      const verdict = useMechanism
        ? miningMarginal(view, buffer).mine
        : fallbackKeepMining(view, buffer);
      return verdict
        ? { type: 'ACTION', action: { type: 'MINE' } }
        : { type: 'ACTION', action: { type: 'START_RETURN' } };
    }

    if (view.phase === 'RETURN' && considerDrop && useMechanism) {
      const drop = dropDecision(view, eagerness);
      if (drop) return { type: 'ACTION', action: drop };
    }

    if (view.phase === 'OUTBOUND') {
      return { type: 'MOVE', toTileId: planOutboundStep(view, target, movement, rng) };
    }
    return { type: 'MOVE', toTileId: planLoadAwareReturnStep(view, movement) };
  };

  return {
    name: opts.name,
    decide: (view, rng) => decideInner(view, true, rng),
    // 遥测：机制信息置空后重放同一骨架 → 动作不同 = 机制真的改变了决策
    blindMove: (view) => {
      if (view.phase !== 'RETURN') return null;
      const blind = blindView(view);
      const d = decideInner(blind, false, () => 0.5);
      return d.type === 'MOVE' ? d.toTileId : null;
    },
  };
}

/** 基线规则（机制关闭时既有 Bot 用的同一条时间规则） */
function fallbackKeepMining(view: FairView, buffer: number): boolean {
  const m = minReturnDays(view);
  if (m === null) return false;
  return view.daysRemaining > m + buffer;
}

/** 把机制信息置空后的「没有任何新机制知识」视图（保留拓扑与自身状态） */
function blindView(view: FairView): FairView {
  return {
    ...view,
    rules: {
      ...view.rules,
      nextMiningYield: gameConfig.gemPerMiningDay,
      nextMiningAccidentChance: 0,
      diminishingYield: { enabled: false, mode: 'tier' },
      accidentRisk: { enabled: false, yieldLossFraction: 0, extraDays: 0, cargoLossFraction: 0 },
      loadReturn: { ...view.rules.loadReturn, enabled: false, overloaded: false },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2. 丢货减负决策（D4）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 丢货规则（风险触发式，单条判据）：
 *
 *   只 在「不丢就走不完」的时候才丢。
 *   判据：剩余天数 - 负重感知返程期望天数 < SAFETY（默认为 2）→ 时间已经不够宽裕。
 *   然后在 k = 1,2,3… 步中找**最小的** k，使丢完之后
 *       剩余天数 - 丢完后的返程期望天数 >= SAFETY
 *   若没有任何 k 能满足，则果断不丢（保住全部收益，接受风险）。
 *
 * 为什么不用「时间价值 × 省下的天数 vs 丢掉的货值」这种连续定价：
 *   实测那样会让丢货退化成**反射动作**（dropRate 94.7%，而负重惩罚几乎从不真正发生），
 *   也就是说它不再是决策。改成风险阈值后，丢货只在真正吃紧时才出现，
 *   与「多挖一天 → 更重 → 更可能走不完」形成干净的因果链。
 */
export const DROP_SAFETY_DAYS = 2;

export function dropDecision(view: FairView, _eagerness = 1): GameAction | null {
  const cfg = view.rules.loadReturn;
  if (!cfg.enabled || !cfg.allowDrop) return null;
  if (!cfg.overloaded) return null;
  const step = cfg.dropStepKg;
  if (view.gemsKg <= 0) return null;

  const daysNow = minReturnCostLoadAware(view);
  if (daysNow === null) return null;
  if (view.daysRemaining - daysNow >= DROP_SAFETY_DAYS) return null; // 时间宽裕 → 不牺牲收益

  const maxK = Math.max(1, Math.floor(view.gemsKg / step));
  // 性能：`minReturnCostLoadAware` 是一次 Dijkstra。正面遍历每个 k 会让每回合做 10+ 次
  // （实测把整机吞吐从 ~37 局/秒压到 ~13 局/秒）。由于返程代价只通过
  // `extraDaysPerDesertTile` 依赖载重，而它是一个**分级台阶**函数，
  // 只需在台阶发生变化时重算 —— 每回合最多 3 次 Dijkstra，行为完全等价。
  const seenExtra = new Set<number>([desertExtraDaysForLoad(view.gemsKg)]);
  for (let k = 1; k <= maxK; k++) {
    const after = round2(view.gemsKg - k * step);
    if (after < 0) break;
    const extraAfter = desertExtraDaysForLoad(after);
    if (seenExtra.has(extraAfter)) continue;
    seenExtra.add(extraAfter);
    const daysAfter = minReturnCostLoadAware({ ...view, gemsKg: after }) ?? daysNow;
    if (view.daysRemaining - daysAfter >= DROP_SAFETY_DAYS) {
      return { type: 'DROP_GEMS', dropKg: round2(k * step) };
    }
  }
  return null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* 3. 负重感知返程步进（ReturnPlannerBot 的核心）                          */
/* ------------------------------------------------------------------ */

/**
 * 在**所有合法下一步**之间做真实比较：
 *   评分 = 走这一步的期望天数 + 走完后到城市的期望剩余天数（Dijkstra 距离场）
 * 机制关闭时它与生产 Bot 的 `planReturnStep(SHORTEST)` 完全等价（所有代价都是 1，同分按 id 稳定排序）。
 */
export function planLoadAwareReturnStep(view: FairView, style: MovementStyle): TileId {
  if (!view.rules.loadReturn.enabled) return planReturnStep(view, style);
  const forbidden = returnForbidden(view);
  const via = returnViaFilter(view);
  const banned = new Set(forbidden);
  banned.delete(view.map.cityId);
  banned.delete(view.position);
  const dist = bfsDistMap(view.map, view.map.cityId, banned, via);
  if (!dist) return planReturnStep(view, style);

  // 用「期望天数」做 Dijkstra 距离场（从城反向不可行，因为权重与方向无关 → 直接正算到城）
  const scored: Array<{ id: TileId; score: number }> = [];
  for (const id of view.legalMoves) {
    const rest = dist.get(id);
    if (rest === undefined) continue;
    const stepCost = expectedMoveDays(view, id);
    // 未来路径用「同一天/每格」的保守估计：每格期望 1 + prior×extraDays
    const futureCost = rest * expectedMoveDays(view, view.position);
    scored.push({ id, score: stepCost + futureCost });
  }
  if (scored.length === 0) return planReturnStep(view, style);
  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored[0].id;
}

/** 计算从当前位置出发、在若干条候选返程路线上的期望天数（供 ReturnPlannerBot 报告多样性） */
export function enumerateReturnOptions(view: FairView): Array<{ first: TileId; cost: number }> {
  const out: Array<{ first: TileId; cost: number }> = [];
  for (const id of view.legalMoves) {
    const after: FairView = {
      ...view,
      position: id,
      visitedReturn: [...view.visitedReturn, id],
    };
    const c = minReturnCostLoadAware(after);
    if (c === null) continue;
    out.push({ first: id, cost: expectedMoveDays(view, id) + c });
  }
  return out.sort((a, b) => a.cost - b.cost || a.first.localeCompare(b.first));
}

/* ------------------------------------------------------------------ */
/* 4. ReturnPlannerBot —— 在每个合法返程分歧点真实比较路线                  */
/* ------------------------------------------------------------------ */

export interface ReturnPlannerOptions {
  name: string;
  buffer?: number;
  target?: MineTarget;
  considerDrop?: boolean;
  /** 只在真正有分歧（≥2 条候选且代价差 ≥ 阈值）时才切换路线；用于测 routeSwitchRate */
  switchMargin?: number;
}

export function makeReturnPlannerBot(opts: ReturnPlannerOptions): BotStrategy {
  const buffer = opts.buffer ?? 4;
  const target: MineTarget = opts.target ?? { kind: 'NEAREST' };
  const considerDrop = opts.considerDrop ?? true;

  const decideInner = (view: FairView, useMechanism: boolean, rng: BotRng): BotDecision => {
    void rng;
    if (view.pendingEvent) {
      const c = eventChoice(view, 'default');
      if (c) return { type: 'EVENT', choice: c };
    }
    const purchase = plannedPurchase(view, EQUIP);
    if (purchase) return { type: 'ACTION', action: purchase.action };
    if (wantsRest(view)) {
      return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
    }
    if (view.phase === 'MINING') {
      const mine = useMechanism ? miningMarginal(view, buffer).mine : fallbackKeepMining(view, buffer);
      return mine
        ? { type: 'ACTION', action: { type: 'MINE' } }
        : { type: 'ACTION', action: { type: 'START_RETURN' } };
    }
    if (view.phase === 'RETURN' && considerDrop && useMechanism) {
      const drop = dropDecision(view, 1);
      if (drop) return { type: 'ACTION', action: drop };
    }
    if (view.phase === 'OUTBOUND') {
      return { type: 'MOVE', toTileId: planOutboundStep(view, target, 'SHORTEST', rng) };
    }
    return { type: 'MOVE', toTileId: useMechanism ? planLoadAwareReturnStep(view, 'SHORTEST') : planReturnStep(view, 'SHORTEST') };
  };

  return {
    name: opts.name,
    decide: (view, rng) => decideInner(view, true, rng),
    blindMove: (view) => {
      if (view.phase !== 'RETURN') return null;
      const blind = blindView(view);
      const d = decideInner(blind, false, () => 0.5);
      return d.type === 'MOVE' ? d.toTileId : null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* 5. 对照：完全不读机制的矿工（同一决策骨架，机制信息被屏蔽）              */
/* ------------------------------------------------------------------ */

/**
 * MechanismBlindMinerBot —— 与 AdaptiveMinerBot **同骨架、同装备、同事件策略**，
 * 唯一区别是永远看不到机制参数（等价于落盘前的玩家）。
 * 它是 Decision Change Rate 的分母来源：任何差异都只能来自机制本身。
 */
export function makeBlindMinerBot(name: string, buffer = 4): BotStrategy {
  const bot = makeAdaptiveMinerBot({ name, buffer });
  return {
    name,
    decide: (view, rng) => {
      void rng;
      // 复用外层的 baseBotDecide（既有生产逻辑），保证与落盘前完全一致
      return baseBotDecide(view, {
        name,
        target: { kind: 'NEAREST' },
        movement: 'SHORTEST',
        equipment: EQUIP,
        miningBuffer: buffer,
        eventPolicy: 'default',
        forecast: 'never',
        forecastMaxPacks: 0,
        rest: true,
        wait: false,
      }, () => 0.5);
    },
    ...(bot.blindMove ? { blindMove: bot.blindMove } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 6. 机制梯度：同一机制、不同「贪心程度」                                 */
/* ------------------------------------------------------------------ */

/**
 * 贪心到极限（buffer=0，完全无视事故风险与负重）——用于检测支配策略。
 *
 * 注意：它**不读任何机制信息**（等价于"完全不理会新规则的莽夫"），
 * 复用完整的 baseBotDecide 骨架（装备 / 修整 / 事件 / 路线规划全都在），
 * 只在采矿处把 buffer 压到 0、在负重规则下也不做任何规避。
 * 早先版本自己手写了一个残缺骨架，导致 0% 胜率，是坏对照而不是机制结论。
 */
export function makeGreedyMechanismBot(name: string): BotStrategy {
  return {
    name,
    decide: (view) =>
      baseBotDecide(
        view,
        {
          name,
          target: { kind: 'NEAREST' },
          movement: 'SHORTEST',
          equipment: EQUIP,
          miningBuffer: 0,
          eventPolicy: 'default',
          forecast: 'never',
          forecastMaxPacks: 0,
          rest: true,
          wait: false,
        },
        () => 0.5,
      ),
  };
}

/** 保守到极限（buffer 很大，极度厌恶事故/负重） */
export function makeTimidMechanismBot(name: string, buffer = 8): BotStrategy {
  return makeAdaptiveMinerBot({ name, buffer });
}

/* ------------------------------------------------------------------ */
/* 7. 对外导出（供 worker 按名字构造）                                    */
/* ------------------------------------------------------------------ */

export function mechanismBot(name: string): BotStrategy | null {
  switch (name) {
    case 'AdaptiveMinerBot':
      return makeAdaptiveMinerBot({ name, buffer: 4, considerDrop: true });
    case 'AdaptiveMinerNoDropBot':
      return makeAdaptiveMinerBot({ name, buffer: 4, considerDrop: false });
    case 'LoadAwareMinerBot':
      return makeAdaptiveMinerBot({ name, buffer: 4, considerDrop: true, dropEagerness: 0.7 });
    case 'ReturnPlannerBot':
      return makeReturnPlannerBot({ name, considerDrop: true });
    case 'ReturnPlannerNoDropBot':
      return makeReturnPlannerBot({ name, considerDrop: false });
    case 'MechanismBlindMinerBot':
      return makeBlindMinerBot(name, 4);
    /**
     * ReasonableMechBot —— 「读过新规则书」的合理玩家代理。
     *
     * 与冻结的 `ReasonablePlayerBot` 完全同装备（2 帐篷 + 1 指南针）、
     * 同事件政策、同去程最短，唯一区别是它按新规则调整采矿余量、
     * 按负重代价规划返程、并在真的走不完时丢货。
     * Promotion Gate 的「合理玩家胜率健康区」以它为准（旧代理不知道新规则，
     * 拿它当门槛等于要求"不知道规则也能赢"，是不合理的）。
     */
    case 'ReasonableMechBot':
      return makeAdaptiveMinerBot({ name, buffer: 6, considerDrop: true });
    case 'GreedyMechanismBot':
      return makeGreedyMechanismBot(name);
    case 'TimidMechanismBot':
      return makeTimidMechanismBot(name);
    default:
      return null;
  }
}

export const MECHANISM_BOT_NAMES = [
  'AdaptiveMinerBot',
  'AdaptiveMinerNoDropBot',
  'LoadAwareMinerBot',
  'ReturnPlannerBot',
  'ReturnPlannerNoDropBot',
  'MechanismBlindMinerBot',
  'ReasonableMechBot',
  'GreedyMechanismBot',
  'TimidMechanismBot',
] as const;

void bfsPath;
void dijkstraPath;
void expectedMoveDays;
export type { EventChoice };
