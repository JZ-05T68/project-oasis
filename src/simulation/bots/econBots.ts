import type { GameAction } from '../../game/types';
import type { BotDecision, BotRng, BotStrategy } from '../runner';
import type { FairView } from '../fairView';
import { minReturnCostLoadAware, minReturnDays } from '../simGraph';
import {
  botTentId,
  eventChoice,
  planOutboundStep,
  plannedPurchase,
  wantsRest,
  type MineTarget,
} from './utils';
import { dropDecision, planLoadAwareReturnStep } from './mechanismBots';

/**
 * v0.3.0 Economic Independence Lab —— 经济结算机制的专项 Bot（§31/§32/§33）。
 *
 * 硬性要求（本轮用户明确指定）：
 *   §31 每个新机制必须有 Aware / Blind 两组，**同 Seed、同路线骨架、同装备策略、
 *       同采矿策略基础**，唯一区别是"是否理解新机制"；
 *   §32 延期求援 Bot 必须真正理解"负债"——不能"按钮能点就必点"；
 *   §33 运营成本 Bot 必须把「再挖一天的收益 vs 额外运营成本 vs 返程风险」纳入决策。
 *
 * 骨架统一复用生产逻辑（plannedPurchase / wantsRest / eventChoice / planOutboundStep），
 * 只在新机制的分支上分叉 —— 这是 sim-balance-lab 陷阱 A 的要求：
 * 新 Bot 若不继承基础生存策略，测出来的是生存率而不是机制。
 */

const EQUIP_SAFE = { wantTents: 2, wantCompasses: 1, cashReserve: 0 };
const EQUIP_SCOUT = { wantTents: 2, wantCompasses: 2, cashReserve: 0 };

/* ------------------------------------------------------------------ */
/* 0. 盲视图：把 v0.3.0 经济机制信息全部置空                              */
/* ------------------------------------------------------------------ */

export function blindEconView(view: FairView): FairView {
  return {
    ...view,
    rules: {
      ...view.rules,
      rescueSettlement: {
        enabled: false,
        immediateCost: view.rules.emergencyRescue.cost,
        deferredDebt: 0,
        revenueShare: 0,
        minFee: 0,
        debtCap: 0,
      },
      upkeep: {
        enabled: false,
        mode: 'perDay',
        costPerDay: 0,
        freeDays: 999,
        overtimeCostPerDay: 0,
        accruedCost: 0,
        marginalPerDay: 0,
      },
      tradeCost: { enabled: false, transportPerKg: 0, commissionRate: 0, fixedAppraisalFee: 0 },
      lateSale: { enabled: false, deadlineDay: 9999, discount: 0 },
    },
  };
}

/* ------------------------------------------------------------------ */
/* 1. 经济估算工具（Bot 与真人用同一套公开信息，无隐藏价格泄漏）            */
/* ------------------------------------------------------------------ */

/** 当前货值的「回城毛收入」估计（Bot 视角：gemsKg × 已知单价） */
function estGrossRevenue(view: FairView): number {
  const price = view.rules.marketReferencePrice;
  return Math.round(view.gemsKg * price);
}

/** 扣掉佣金/运输/鉴定费后的净收入估计 */
function estNetRevenue(view: FairView, gross: number): number {
  const tc = view.rules.tradeCost;
  if (!tc.enabled) return gross;
  return (
    gross -
    Math.round(tc.commissionRate * gross) -
    Math.round(tc.transportPerKg * view.gemsKg) -
    tc.fixedAppraisalFee
  );
}

/** 逾期折价：若在截止日之后回城，全部收入打折（Family AI-2） */
function lateSaleMultiplier(view: FairView, finishDay: number): number {
  const ls = view.rules.lateSale;
  if (!ls.enabled) return 1;
  return finishDay > ls.deadlineDay ? 1 - ls.discount : 1;
}

/** 求援结算费用（与结算函数 rescueSettlementFee 同公式） */
function estRescueFee(view: FairView, netRevenue: number): number {
  const rs = view.rules.rescueSettlement;
  if (!rs.enabled) return 0;
  const debt = Math.max(0, Math.round(rs.deferredDebt));
  const share = Math.max(0, Math.round(rs.revenueShare * netRevenue));
  let total = Math.max(Math.round(rs.minFee), debt + share);
  if (rs.debtCap > 0) total = Math.min(total, Math.round(rs.debtCap));
  return total;
}

/* ------------------------------------------------------------------ */
/* 2. 求援决策（§32：真正理解"负债"，不是能点就点）                       */
/* ------------------------------------------------------------------ */

/**
 * 延期求援的取舍：
 *
 *   不求援：有机会自己走回去（概率 p0），也有很大概率失败 —— 失败则宝石收入全部归零。
 *   求援  ：存活概率显著提高（p1），但回城后要付一笔结算费用 fee。
 *
 * 判据：`p1 × (净收入 − fee) > p0 × 净收入` 才求援。
 * 于是「货不值钱时宁可认赔也不叫救援」成为一个真实选择 —— 这正是本轮要的经济决策：
 *   货物多 → 值得为它付救援费 → 回来但被抽走一大截 → 可能仍亏损；
 *   货物少 → 救援费不划算 → 放弃求援 → 失败。
 */
export function econRescueDecision(
  view: FairView,
  opts: { always?: boolean; never?: boolean } = {},
): GameAction | null {
  const cfg = view.rules.emergencyRescue;
  if (!cfg.enabled) return null;
  if (opts.never) return null;
  if (cfg.used >= cfg.maxUses) return null;

  const eta = view.rules.emergencyRescue.expectedReturnDays;
  const daysLeft = view.daysRemaining;
  const timeTight = daysLeft - eta < cfg.triggerMarginDays;
  const staminaLow = view.stamina <= 2;
  if (!timeTight && !staminaLow) return null;
  // 求援也救不回来就别浪费
  const returnCost = minReturnCostLoadAware(view) ?? minReturnDays(view) ?? eta;
  if (daysLeft + cfg.extraDays - returnCost < 0) return null;

  const action = view.availableActions.find(
    (a) => a.action.type === 'EMERGENCY_RESCUE' && !a.disabled,
  );
  if (!action) return null;
  if (opts.always) return action.action;

  const gross = estGrossRevenue(view);
  const netRevenue = estNetRevenue(view, gross);
  const fee = estRescueFee(view, netRevenue);
  const immediate = cfg.cost;

  /**
   * 不求援的存活概率：用「真实返程代价」而不是乐观 eta。
   * （eta 是曼哈顿下界，刻意乐观；Bot 若拿它估概率会系统性高估自己能走回去。）
   */
  const slackReal = daysLeft - returnCost;
  let p0 = Math.max(0.05, Math.min(0.92, 0.5 + 0.15 * slackReal));
  if (view.stamina <= 1) p0 *= 0.5; // 耐力见底：下一格坏天气就可能直接倒下
  const p1 = Math.min(0.96, p0 + 0.35);

  const evRescue = p1 * (netRevenue - fee - immediate);
  const evNoRescue = p0 * netRevenue;
  void eta;
  return evRescue > evNoRescue ? action.action : null;
}

/* ------------------------------------------------------------------ */
/* 3. 采矿边际决策（§33：把运营成本 / 逾期折价 / 佣金纳入）                */
/* ------------------------------------------------------------------ */

/**
 * 再挖一天值不值？
 *
 *   边际收益 = 明日产量 × 单价 × (1 − 佣金) × 逾期折价系数 − 运输费 − 当日运营成本
 *   边际成本 = ① 额外占用 1 天所带来的逾期折价风险（若跨过截止日，全部货值打折）
 *             ② 时间余量（不够就走人，与 v0.2.0 骨架一致）
 *
 * 运营成本真正进入边际判断，是 §33 的硬要求；
 * 逾期折价进入判断，使「赶在集市前回城」成为可见的取舍。
 */
/**
 * §33 的核心：风险偏好必须是**经济内生**的，而不是一个写死的常数。
 *
 * 行为假设（真人也是这样）：
 *   - 按当前这趟的预计收益已经明显赚到了 → 求稳，给自己留足返程余量；
 *   - 预计刚够本 → 少留一点余量，多挖一天；
 *   - 预计还要亏 → 只能继续挖，把余量压到最低（这就是"为了翻本冒险"）。
 *
 * 为什么必须有这一层：Bot 若永远用固定 buffer，那么任何"只改结算数字"的经济机制
 * 都无法改变它的行为 ⇒ Δdecision 恒为 0 ⇒ 所有候选都会被判成 METRIC_ONLY_TAX（§16）。
 * 换句话说，缺了这一层，本轮实验根本没有能力区分"真机制"和"统一税"。
 *
 * 注意：在机制全关（BASE）时预计收益本来就很高，因此 buffer 不会下调 ——
 * 这一层不会污染基线，只会在经济机制真的挤压利润时启动。
 */
export function economicBuffer(view: FairView, baseBuffer: number): number {
  const r = view.rules;
  const price = r.marketReferencePrice;
  const returnCost = minReturnCostLoadAware(view) ?? minReturnDays(view) ?? 0;
  const gross = Math.round(view.gemsKg * price);
  const upkeepAhead = r.upkeep.accruedCost + r.upkeep.marginalPerDay * Math.max(0, returnCost);
  const trade = r.tradeCost.enabled
    ? Math.round(r.tradeCost.commissionRate * gross) +
      Math.round(r.tradeCost.transportPerKg * view.gemsKg) +
      r.tradeCost.fixedAppraisalFee
    : 0;
  const late = lateSaleMultiplier(view, view.day + returnCost);
  const projected = view.cash + Math.round(gross * late) - upkeepAhead - trade - 2000;
  if (projected > 2000) return baseBuffer;
  if (projected > 900) return baseBuffer - 1;
  if (projected > 0) return baseBuffer - 2;
  return Math.max(1, baseBuffer - 3);
}

export function miningMarginalEcon(view: FairView, buffer: number): boolean {
  const r = view.rules;
  const baseReturn = minReturnCostLoadAware(view) ?? minReturnDays(view);
  if (baseReturn === null) return false;

  const loadBuffer = r.loadReturn.extraDaysPerDesertTile;
  const accidentDays = r.accidentRisk.enabled ? r.nextMiningAccidentChance * r.accidentRisk.extraDays : 0;
  const slack = view.daysRemaining - baseReturn - accidentDays - loadBuffer - buffer;
  if (slack <= 0) return false;
  if (view.stamina <= 1) return false;

  const price = view.rules.marketReferencePrice;
  const nextYield = r.nextMiningYield;
  if (price <= 0 || nextYield <= 0) return slack > 0;

  const finishDay = view.day + 1 + baseReturn;
  const lateMult = lateSaleMultiplier(view, finishDay);
  const tc = r.tradeCost;
  const commission = tc.enabled ? tc.commissionRate : 0;
  const transport = tc.enabled ? tc.transportPerKg : 0;

  // 跨过逾期截止日 → 全部存货打折：这是一次性的大损失，必须计入
  const grossNow = estGrossRevenue(view);
  const latePenalty = Math.max(
    0,
    Math.round(grossNow * (1 - lateSaleMultiplier(view, view.day + baseReturn))),
  );

  const marginalGain =
    nextYield * price * (1 - commission) * lateMult - transport * nextYield;
  const marginalCost = r.upkeep.marginalPerDay;

  return marginalGain - marginalCost - latePenalty > 0 && slack > 0;
}

/* ------------------------------------------------------------------ */
/* 4. EconMasterBot                                                     */
/* ------------------------------------------------------------------ */

export interface EconBotOptions {
  name: string;
  buffer?: number;
  target?: MineTarget;
  /** 是否理解 v0.3.0 经济机制（false = 同骨架盲对照组） */
  aware: boolean;
  /** 求援策略（用于支配策略检查） */
  rescue?: 'ev' | 'always' | 'never';
  /** 采矿策略（用于支配策略检查） */
  mining?: 'econ' | 'greedy' | 'cautious';
  cashReserve?: number;
  compasses?: number;
}

export function makeEconBot(opts: EconBotOptions): BotStrategy {
  const buffer = opts.buffer ?? 5;
  const target: MineTarget = opts.target ?? { kind: 'NEAREST' };
  const rescueMode = opts.rescue ?? 'ev';
  const miningMode = opts.mining ?? 'econ';
  const equip = (opts.compasses ?? 2) > 1 ? EQUIP_SCOUT : EQUIP_SAFE;

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

    /* --- 求援（§32 负债感知；盲组走 always，因为它看不到债务） --- */
    const r = econRescueDecision(view, {
      always: rescueMode === 'always' || !opts.aware,
      never: rescueMode === 'never',
    });
    if (r) return { type: 'ACTION', action: r };

    /* --- 采矿 / 丢货 / 移动 --- */
    if (view.phase === 'MINING') {
      let mine: boolean;
      if (miningMode === 'greedy') {
        const baseReturn = minReturnCostLoadAware(view) ?? minReturnDays(view);
        mine = baseReturn !== null && view.daysRemaining - baseReturn > 0 && view.stamina > 1;
      } else if (miningMode === 'cautious') {
        mine = miningMarginalEcon(view, buffer + 4);
      } else {
        mine = miningMarginalEcon(view, economicBuffer(view, buffer));
      }
      return mine
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

  return {
    name: opts.name,
    decide: decideInner,
    blindMove: (view) => {
      if (view.phase !== 'RETURN') return null;
      const d = decideInner(blindEconView(view), () => 0.5);
      return d.type === 'MOVE' ? d.toTileId : null;
    },
  };
}

/** 与 EconMasterBot 同骨架，但完全不知道 v0.3.0 经济机制（用于 H4 决策改变率） */
export function makeEconBlindBot(name: string, buffer = 5): BotStrategy {
  const inner = makeEconBot({ name, buffer, aware: false, compasses: 2 });
  return {
    name,
    decide: (view, rng) => inner.decide(blindEconView(view), rng),
    ...(inner.blindMove ? { blindMove: inner.blindMove } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 5. 对外导出（worker 按名字构造）                                       */
/* ------------------------------------------------------------------ */

export function econBot(name: string): BotStrategy | null {
  switch (name) {
    case 'EconMasterBot':
      return makeEconBot({ name, buffer: 5, aware: true, compasses: 2 });
    case 'EconMasterTightBot':
      return makeEconBot({ name, buffer: 3, aware: true, compasses: 2 });
    case 'EconBlindBot':
      return makeEconBlindBot(name, 5);
    /* --- 支配策略 / 极端策略梯度（§9/§14 检查用） --- */
    case 'EconRescueAlwaysBot':
      return makeEconBot({ name, buffer: 5, aware: true, rescue: 'always', compasses: 2 });
    case 'EconRescueNeverBot':
      return makeEconBot({ name, buffer: 5, aware: true, rescue: 'never', compasses: 2 });
    case 'EconGreedyMinerBot':
      return makeEconBot({ name, buffer: 2, aware: true, mining: 'greedy', compasses: 2 });
    case 'EconCautiousBot':
      return makeEconBot({ name, buffer: 7, aware: true, mining: 'cautious', compasses: 2 });
    case 'EconCheapBot':
      return makeEconBot({ name, buffer: 5, aware: true, compasses: 1, cashReserve: 0 });
    default:
      return null;
  }
}

export const ECON_BOT_NAMES = [
  'EconMasterBot',
  'EconMasterTightBot',
  'EconBlindBot',
  'EconRescueAlwaysBot',
  'EconRescueNeverBot',
  'EconGreedyMinerBot',
  'EconCautiousBot',
  'EconCheapBot',
] as const;
