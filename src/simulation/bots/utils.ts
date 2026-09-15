import type { EventChoice, TentId, TileId } from '../../game/types';
import type { BotDecision, BotRng } from './types';
import type { FairView } from '../fairView';
import { bfsDistMap, bfsPath, dijkstraPath, minReturnDays, returnForbidden, returnViaFilter, SAFE_WEIGHTS } from '../simGraph';
import { lowestDurabilityTentId } from '../../game/rules/equipment';
import { gameConfig } from '../../game/config/gameConfig';

/**
 * 公共策略件：移动规划、采矿决策、购买策略、事件应对（v0.1.2 格子地图版）。
 * 全部只使用 FairView 的玩家视角信息。
 */

/* ------------------------------------------------------------------ */
/* 移动规划                                                            */
/* ------------------------------------------------------------------ */

export type MineTarget =
  | { kind: 'NEAREST' }
  | { kind: 'SAFEST' }
  | { kind: 'FIXED'; slot: 'A' | 'B' };

/**
 * SHORTEST = 纯跳数最短（不看地形，不看预报）
 * SAFEST   = 按固定地形风险权重绕路（不看预报）
 * FORECAST = **在保持最短跳数的前提下**，用「已购买的次日预报」在多个等价下一步之间挑天气最好的那个；
 *            只有当下的天气预报显示「明显更糟 / 明显更好」时才允许付 1 天的绕路代价。
 *            没有有效预报时，它与 SHORTEST 完全等价 ——
 *            这样「买预报 / 不买预报」共用同一套基线，比较才成立。
 */
export type MovementStyle = 'SHORTEST' | 'SAFEST' | 'FORECAST';

/**
 * 绕路代价（以「天」为单位换算成预报严重度）：
 * 多走一天 ≈ 0.6 次天气暴露 ≈ 0.6 点耐力；躲避一次暴雨/沙尘暴 ≈ 1 点耐力或 1 顶帐篷。
 * 取 2 表示「为了避开一次恶劣天气，最多值得多走 1 天」；纯粹的高温（严重度 1）不值得绕。
 */
const FORECAST_DETOUR_COST = 2;

/** 预报严重度：SANDSTORM/RAINSTORM 一整格代价，MUD 损失一天，HEAT 只掉 1 点耐力 */
export function forecastSeverity(view: FairView, tileId: TileId): number {
  const f = view.lastForecast;
  if (!f || f.day !== view.day + 1) return 0;
  const cell = f.cells.find((c) => c.tileId === tileId);
  if (!cell) return 0;
  switch (cell.weather) {
    case 'SANDSTORM':
    case 'RAINSTORM':
      return 3;
    case 'MUD':
      return 2;
    case 'HEAT':
      return 1;
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ */
/* 移动规划实现                                                        */
/* ------------------------------------------------------------------ */

function mineTileOf(view: FairView, slot: 'A' | 'B'): string {
  return view.map.mines.find((m) => m.slot === slot)!.tileId;
}

function outboundConstraints(view: FairView, mineId: string) {
  const banned = new Set<string>(view.visitedOutbound);
  banned.delete(view.map.cityId);
  // 关键：当前所在格必须从禁行集合里去掉，否则距离场算不到自己，
  // forecastStyleStep 会直接放弃、每天都退回纯 BFS（预报永远不会改变路线）。
  banned.delete(view.position);
  const otherMines = view.map.mineIds.filter((m) => m !== mineId);
  return { banned, filter: (id: string) => !otherMines.includes(id) };
}

function outboundPath(view: FairView, mineId: string, style: MovementStyle): string[] | null {
  const { banned, filter } = outboundConstraints(view, mineId);
  if (style === 'SAFEST') {
    const r = dijkstraPath(view.map, view.position, mineId, (id) => moveWeight(view, id), banned, filter);
    if (r) return r.path;
  }
  return bfsPath(view.map, view.position, mineId, banned, filter);
}

/**
 * FORECAST 风格的下一步：
 *  1. 先算出「到目标的最短跳数距离场」；
 *  2. 候选 = 所有合法移动中，走完后到目标距离 ≤ 最优距离 + 1 的格子；
 *  3. 打分 = 多走的天数 × FORECAST_DETOUR_COST + 该格明天的预报严重度；
 *  4. 取分数最低者（同分按 tileId 稳定排序，保证可复现）。
 * 没有有效预报时所有严重度都是 0 → 等价于「严格最短路」，与 SHORTEST 行为一致。
 */
function forecastStyleStep(
  view: FairView,
  target: TileId,
  forbidden: Iterable<string>,
  filter: (id: string) => boolean,
): TileId | null {
  const banned = new Set(forbidden);
  banned.delete(view.position); // 见 outboundConstraints 的说明
  banned.delete(target);
  const dist = bfsDistMap(view.map, target, banned, filter);
  if (!dist) return null;
  const here = dist.get(view.position);
  if (here === undefined) return null;
  let best = Infinity;
  const scored: Array<{ id: TileId; score: number; extra: number }> = [];
  for (const id of view.legalMoves) {
    const d = dist.get(id);
    if (d === undefined) continue;
    const extra = d - here + 1; // 走完这一步后的剩余距离相对最优多走几天
    if (extra < best) best = extra;
    scored.push({ id, score: extra, extra });
  }
  if (scored.length === 0) return null;
  // 只保留「最多多走 1 天」的候选，避免为了躲天气绕远路
  const pool = scored
    .filter((s) => s.score <= best + 1)
    .map((s) => ({ id: s.id, extra: s.score, total: s.score * FORECAST_DETOUR_COST + forecastSeverity(view, s.id) }))
    .sort((a, b) => a.total - b.total || a.extra - b.extra || a.id.localeCompare(b.id));
  return pool[0]?.id ?? null;
}


function nearestMine(view: FairView, style: MovementStyle): string | null {
  let best: { id: string; len: number } | null = null;
  for (const m of view.map.mineIds) {
    const p = outboundPath(view, m, style);
    if (!p) continue;
    if (!best || p.length < best.len) best = { id: m, len: p.length };
  }
  return best?.id ?? null;
}

function safestMine(view: FairView): string | null {
  let best: { id: string; cost: number } | null = null;
  for (const m of view.map.mineIds) {
    const otherMines = view.map.mineIds.filter((x) => x !== m);
    const filter = (id: string) => !otherMines.includes(id);
    const banned = new Set(view.visitedOutbound);
    banned.delete(view.map.cityId);
    const r = dijkstraPath(view.map, view.position, m, (id) => moveWeight(view, id), banned, filter);
    if (!r) continue;
    if (!best || r.cost < best.cost) best = { id: m, cost: r.cost };
  }
  return best?.id ?? nearestMine(view, 'SHORTEST');
}

export function resolveTargetMine(view: FairView, target: MineTarget, style: MovementStyle): string | null {
  if (view.phase !== 'OUTBOUND') return view.mineEntranceId;
  if (target.kind === 'FIXED') {
    const id = mineTileOf(view, target.slot);
    return outboundPath(view, id, style) ? id : nearestMine(view, style);
  }
  if (target.kind === 'NEAREST') return nearestMine(view, style);
  return safestMine(view);
}

/** 移动代价：只在 SAFEST 风格下使用（固定地形风险权重，与预报无关） */
export function moveWeight(view: FairView, tileId: string): number {
  const node = view.map.tiles[tileId];
  return node.terrain ? (SAFE_WEIGHTS[node.terrain] ?? 1) : 2; // 未知 = 中性
}

/** 出发去程：走向目标矿区的下一步 */
export function planOutboundStep(view: FairView, target: MineTarget, style: MovementStyle, rng: BotRng): string {
  const mineId = resolveTargetMine(view, target, style);
  if (!mineId) return fallbackMove(view, rng);
  if (style === 'FORECAST') {
    const { banned, filter } = outboundConstraints(view, mineId);
    const pick = forecastStyleStep(view, mineId, banned, filter);
    if (pick) return pick;
  }
  const path = outboundPath(view, mineId, style);
  if (!path) return fallbackMove(view, rng);
  const next = path[1];
  return view.legalMoves.includes(next) ? next : fallbackMove(view, rng);
}

/** 返程：最短合法路线的下一步（当前矿区可穿透，其它矿区禁行）
 *  FORECAST 风格下：无有效预报时严格等价于 SHORTEST；有预报时在等价/多 1 天的候选里挑天气最好的。 */
export function planReturnStep(view: FairView, style: MovementStyle = 'SHORTEST'): string {
  const forbidden = returnForbidden(view);
  const via = returnViaFilter(view);
  if (style === 'FORECAST') {
    const pick = forecastStyleStep(view, view.map.cityId, forbidden, via);
    if (pick) return pick;
  }  const path = bfsPath(view.map, view.position, view.map.cityId, forbidden, via);
  if (!path) return fallbackMove(view, rngUnused);
  const next = path[1];
  return view.legalMoves.includes(next) ? next : fallbackMove(view, rngUnused);
}

const rngUnused: BotRng = () => 0;

function fallbackMove(view: FairView, rng: BotRng): string {
  if (view.legalMoves.length === 0) {
    throw new Error(`无合法移动（position=${view.position}, day=${view.day}）`);
  }
  return pickFrom(view.legalMoves, rng);
}

export function pickFrom<T>(xs: T[], rng: BotRng): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

/* ------------------------------------------------------------------ */
/* 采矿决策                                                            */
/* ------------------------------------------------------------------ */

/** 采矿策略：剩余天数 > 最短返程 + buffer 时继续挖 */
export function shouldKeepMining(view: FairView, buffer: number): boolean {
  const minRet = minReturnDays(view);
  if (minRet === null) return false;
  return view.daysRemaining > minRet + buffer;
}

/* ------------------------------------------------------------------ */
/* 购买策略                                                            */
/* ------------------------------------------------------------------ */

export interface EquipmentPolicy {
  wantTents: number;
  wantCompasses: number;
  cashReserve: number;
}

/** 在城市/村庄按政策购买（不耗时间）；返回 null 表示不买 */
export function plannedPurchase(
  view: FairView,
  policy: EquipmentPolicy,
): { action: { type: 'BUY'; item: 'tent' | 'compass' } } | null {
  const tentInfo = view.availableActions.find((a) => a.action.item === 'tent');
  const compassInfo = view.availableActions.find((a) => a.action.item === 'compass');
  if (!tentInfo || !compassInfo) return null;
  if (view.tents.length < policy.wantTents && view.cash - (tentInfo.price ?? 400) >= policy.cashReserve && !tentInfo.disabled) {
    return { action: { type: 'BUY', item: 'tent' } };
  }
  if (view.compasses < policy.wantCompasses && view.cash - (compassInfo.price ?? 100) >= policy.cashReserve && !compassInfo.disabled) {
    return { action: { type: 'BUY', item: 'compass' } };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 事件应对                                                            */
/* ------------------------------------------------------------------ */

export type EventPolicyKind = 'default' | 'cheap' | 'work';

/**
 * 市集二选一（八折 vs 打工）的决策。
 *
 * 背景：旧 Bot 无条件选「八折」，导致 `workPay` 这个参数在仿真里
 * **从未被真正使用过**（打工局占比恒为 0%），二次数值扫描因此无效。
 * 这个分支只在 policy === 'work' 时启用，专供「村庄打工」专项扫描，
 * 不影响 Forecast 实验用的 5 个对照 Bot（它们的 policy 仍是 'default'）。
 *
 * 规则（玩家视角、可解释）：
 *  1. 还缺帐篷/指南针且现金够买 → 先拿八折（不花时间，立刻省下折扣差额）；
 *  2. 时间不够返程 → 不打工；
 *  3. 打工日收益 ≥ 挖矿日收益先验（2kg × 公开区间中值 230 元/kg = 460 元/天）、
 *     且现金偏紧时 → 打工；
 *  4. 否则拿八折。
 */
export function marketChoice(view: FairView): { kind: 'MARKET'; action: 'TAKE_DISCOUNT' | 'WORK' } {
  const needTent = view.tents.length < 2;
  const needCompass = view.compasses < 1;
  const tentPrice = gameConfig.tentPrice;
  const compassPrice = gameConfig.compassPrice;
  const discountValue =
    (needTent && view.cash >= gameConfig.marketDiscountTentPrice ? tentPrice - gameConfig.marketDiscountTentPrice : 0) +
    (needCompass && view.cash >= gameConfig.marketDiscountCompassPrice ? compassPrice - gameConfig.marketDiscountCompassPrice : 0);
  const minRet = minReturnDays(view) ?? 99;
  const timeSlack = view.daysRemaining - minRet;
  const miningDayValue = 2 * 230; // 2kg/天 × 公开定价区间中值
  const workPay = gameConfig.workPay;
  if (discountValue >= 100) return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
  if (timeSlack <= 3) return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
  if (workPay >= miningDayValue && view.cash < 1200) return { kind: 'MARKET', action: 'WORK' };
  return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
}

export function eventChoice(view: FairView, policy: EventPolicyKind): EventChoice | null {
  const ev = view.pendingEvent;
  if (!ev) return null;
  const tentId = botTentId(view);
  switch (ev.kind) {
    case 'SANDSTORM':
      return policy === 'cheap'
        ? { kind: 'SANDSTORM', useTent: false, useCompass: false }
        : { kind: 'SANDSTORM', useTent: view.tents.length > 0, useCompass: view.compasses > 0, tentId };
    case 'RAINSTORM':
      return policy === 'cheap'
        ? { kind: 'RAINSTORM', useTent: false }
        : { kind: 'RAINSTORM', useTent: view.tents.length > 0, tentId };
    case 'CARAVAN':
      if (policy !== 'cheap' && view.cash >= 300 && view.tents.length === 0) {
        return { kind: 'CARAVAN', action: 'BUY_TENT' };
      }
      return { kind: 'CARAVAN', action: 'TAKE_INTEL' };
    case 'THIEF':
      if (policy !== 'cheap' && ev.stolen > 0 && view.daysRemaining > 12) {
        return { kind: 'THIEF', action: 'CHASE' };
      }
      return { kind: 'THIEF', action: 'GIVE_UP' };
    case 'MARKET':
      return policy === 'work' ? marketChoice(view) : { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 天气预报策略（v0.1.3 现金计价）                                       */
/* ------------------------------------------------------------------ */

/**
 * 策略梯度：
 * - never    ：永远不买（NoForecastBot）
 * - light    ：只在特定高风险条件下买 1 包（LightForecastBot）
 * - adaptive ：按「耐力缺口 / 帐篷 / 已知风险 / 阶段 / 剩余现金」综合打分（AdaptiveForecastBot）
 * - heavy    ：明显偏爱预报，只要现金允许且未达上限就买（HeavyForecastBot）
 * - abuser   ：尽可能频繁购买，只看现金（ForecastAbuserBot）
 */
export type ForecastPolicy = 'never' | 'light' | 'adaptive' | 'heavy' | 'abuser';

export interface ForecastPolicyConfig {
  policy: ForecastPolicy;
  /** 本局最多购买包数（abuser = Infinity） */
  maxPacks: number;
  /** Adaptive 档的购买门槛（默认 4）：调低=更容易买，调高=更吝啬 */
  adaptiveThreshold?: number;
}

/** 预报窗口是否对本回合有效（锚定「明天」） */
export function forecastActive(view: FairView): boolean {
  return !!view.lastForecast && view.lastForecast.day === view.day + 1;
}

/** 明天本格是否有恶劣自然天气（需已有有效预报） */
export function currentTileTomorrowSevere(view: FairView): boolean {
  if (!forecastActive(view)) return false;
  const cell = view.lastForecast!.cells.find((c) => c.isCurrent);
  return !!cell && isSevereWeather(cell.weather);
}

export function isSevereWeather(w: string): boolean {
  return w === 'SANDSTORM' || w === 'RAINSTORM' || w === 'MUD';
}

/** 可合法走到的邻格中，明天有恶劣天气的格子 */
export function severeLegalMoves(view: FairView): TileId[] {
  if (!forecastActive(view)) return [];
  return view.legalMoves.filter((id) => {
    const cell = view.lastForecast!.cells.find((c) => c.tileId === id);
    return !!cell && isSevereWeather(cell.weather);
  });
}

/* ------------------------------------------------------------------ */
/* 预报的价值模型（全部从游戏自身的经济/实测数据推导，不为了让购买率好看而调） */
/* ------------------------------------------------------------------ */

/**
 * 1 点「伤害」值多少现金 —— 由游戏自身定价推导：
 *  - 指南针 100 元/次，作用 ≈ 避免 1 次迷路（1 天）+ 硬扛沙尘暴；
 *  - 帐篷 700 元 / 3 点沙漠耐久 ≈ 233 元/点；
 * 取两者中位量级 150 元/点。
 */
const CASH_PER_DAMAGE_POINT = 150;
/** 每一次预报「平均能避免的伤害点数」（实测下界，来自 ForecastAbuserBot 的避免量遥测） */
const DAMAGE_AVOIDED_PER_CHARGE = 0.35;

/** 还剩多少次「会用到预报的移动」——买太晚等于白买 */
export function remainingTravelMoves(view: FairView): number {
  if (view.phase === 'MINING') return 0;
  if (view.phase === 'RETURN') return Math.max(0, view.daysRemaining - 1);
  // 去程：还要走到矿区，再走回城市
  const m = minReturnDays(view);
  if (m === null) return Math.max(0, view.daysRemaining - 1);
  const toMine = Math.max(1, Math.floor(view.daysRemaining / 2));
  return Math.max(0, Math.min(view.daysRemaining - 1, toMine + m));
}

/** 情境风险倍率：耐力越缺 / 越没有帐篷，预报越值钱 */
export function forecastRiskFactor(view: FairView): number {
  const staminaDeficit = (view.maxStamina - view.stamina) / Math.max(1, view.maxStamina);
  let f = 1 + 0.6 * staminaDeficit;
  if (view.tents.length === 0) f += 0.5;
  if (view.gemsKg >= 6) f += 0.2;
  if (view.phase === 'RETURN') f += 0.2;
  return Math.min(2, Math.max(0.6, f));
}

/** 一包预报的期望收益（元） */
export function forecastPackValue(view: FairView): number {
  const usable = Math.min(view.forecastChargesPerPack, remainingTravelMoves(view));
  return usable * DAMAGE_AVOIDED_PER_CHARGE * forecastRiskFactor(view) * CASH_PER_DAMAGE_POINT;
}

/**
 * 是否购买预报包（必须尊重引擎的 disabled 标志 = 资金不足）。
 * 决策依据是「期望收益 vs 价格」，价格由实验配置注入，Bot 侧不做任何针对价格的拟合。
 */
export function shouldBuyForecastPack(view: FairView, cfg: ForecastPolicyConfig): boolean {
  if (cfg.policy === 'never') return false;
  if (view.phase === 'MINING') return false;
  if (view.forecastCharges > 0) return false;
  const price = view.forecastPackPrice;
  if (view.cash < price) return false;
  const info = view.availableActions.find((a) => a.action.type === 'BUY_FORECAST_PACK');
  if (!info || info.disabled) return false;
  if (view.forecastPacks >= cfg.maxPacks) return false;
  // 至少要剩得下「不需要预报也能撑住」的现金底裤（指南针价）
  const reserve = view.phase === 'RETURN' ? 0 : 100;

  switch (cfg.policy) {
    case 'light': {
      // 只在真的快撑不住、而且还有路要走的时候买 1 包
      if (view.stamina > 2) return false;
      if (view.daysRemaining < 6) return false;
      if (remainingTravelMoves(view) < 2) return false;
      return view.cash - price >= reserve;
    }
    case 'adaptive': {
      if (remainingTravelMoves(view) < 2) return false;
      if (view.daysRemaining < 5) return false;
      if (view.cash - price < reserve) return false;
      return forecastPackValue(view) > price;
    }
    case 'heavy': {
      // 明显偏爱预报：只要不把现金压到危险线以下就买
      if (view.forecastCharges > 2) return false;
      if (remainingTravelMoves(view) < 3) return false;
      return view.cash - price >= 200;
    }
    case 'abuser': {
      // 只要买得起就买（用于检测低价/小包是否形成预报滥用）
      return view.cash >= price;
    }
    default:
      return false;
  }
}

/**
 * 是否手动使用已储存的预报。
 * 「使用」本身免费（不耗天数、不耗耐力），所以在有效窗口内应当尽量用满：
 * 只有真正用了，才可能出现「看了预报改路线」的有效决策。
 */
export function shouldUseForecast(view: FairView, cfg: ForecastPolicyConfig): boolean {
  if (cfg.policy === 'never') return false;
  if (view.forecastCharges <= 0) return false;
  if (forecastActive(view)) return false; // 本回合已经有有效预报了
  if (view.phase === 'MINING') return false;
  if (view.legalMoves.length === 0) return false;
  switch (cfg.policy) {
    case 'light':
      return view.stamina <= 3;
    case 'adaptive':
    case 'heavy':
    case 'abuser':
      return true;
    default:
      return false;
  }
}

/** 兼容旧 API（仅文档引用） */
export function plannedRouteHasKnownDesert(view: FairView): boolean {
  return view.legalMoves.some((id) => view.map.tiles[id].terrain === 'DESERT');
}

/* ------------------------------------------------------------------ */
/* 休整                                                                */
/* ------------------------------------------------------------------ */

/** 修整决策：绿洲有水且允许修整（引擎的 disabled 标志已包含帐篷条件） */
export function wantsRest(view: FairView): boolean {
  const rest = view.availableActions.find((a) => a.action.type === 'REST');
  return !!rest && !rest.disabled && view.stamina < view.maxStamina;
}

/** 宿营/修整用帐篷稳定 ID（无帐篷返回 undefined） */
export function botTentId(view: FairView): TentId | undefined {
  return lowestDurabilityTentId(view.tents);
}

/* ------------------------------------------------------------------ */
/* 通用决策骨架                                                        */
/* ------------------------------------------------------------------ */

export interface BaseBotConfig {
  name: string;
  target: MineTarget;
  movement: MovementStyle;
  equipment: EquipmentPolicy;
  miningBuffer: number;
  eventPolicy: EventPolicyKind;
  /** 预报策略档位 */
  forecast: ForecastPolicy;
  /** 本局最多买几包预报（abuser = Infinity） */
  forecastMaxPacks: number;
  /**
   * Adaptive 策略的购买门槛（默认 4）。调低 = 更容易买，调高 = 更吝啬。
   * 用于在同一档策略内做小范围行为敏感性对照。
   */
  adaptiveThreshold?: number;
  rest: boolean;
  /** 停留策略：预报显示当前格明天恶劣且耐力低时等待 */
  wait: boolean;
}

/** 预报策略配置（从 BaseBotConfig 派生） */
function fcCfg(cfg: BaseBotConfig): ForecastPolicyConfig {
  return {
    policy: cfg.forecast,
    maxPacks: cfg.forecastMaxPacks,
    adaptiveThreshold: cfg.adaptiveThreshold,
  };
}

export function baseBotDecide(view: FairView, cfg: BaseBotConfig, rng: BotRng): BotDecision {
  // 1. 事件优先
  if (view.pendingEvent) {
    const choice = eventChoice(view, cfg.eventPolicy);
    if (choice) return { type: 'EVENT', choice };
  }
  // 2. 采矿阶段
  if (view.phase === 'MINING') {
    return shouldKeepMining(view, cfg.miningBuffer)
      ? { type: 'ACTION', action: { type: 'MINE' } }
      : { type: 'ACTION', action: { type: 'START_RETURN' } };
  }
  // 3. 购买装备（城市/村庄，不耗时间）
  const purchase = plannedPurchase(view, cfg.equipment);
  if (purchase) return { type: 'ACTION', action: purchase.action };
  // 4. 绿洲修整（需帐篷时自动带上选择）
  if (cfg.rest && wantsRest(view)) {
    return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
  }
  // 5. 天气预报（购买 / 使用）
  //
  // 注：这里**不做**「因预报显示明天恶劣而原地停留」。
  // 原因（白盒核对结论）：WAIT 会 addDays(1) 后在**当前格**照常结算 day+1 的天气
  // （engine.ts 的 WAIT 分支 → resolveTileWeather(s, s.position, s.daysUsed, false)），
  // 所以停留并不能躲开预报要警告的那场天气，只会额外付出 1 天 + 1 点帐篷耐久。
  // 保留这个"看着合理其实有害"的行为会人为把预报 Bot 压低，属于 Bot 缺陷而不是机制结论。
  // 因此预报在本实验里只通过「路线选择」影响决策 —— 那是它真实能换到东西的地方。
  if (cfg.forecast !== 'never') {
    if (shouldBuyForecastPack(view, fcCfg(cfg))) {
      return { type: 'ACTION', action: { type: 'BUY_FORECAST_PACK' } };
    }
    if (shouldUseForecast(view, fcCfg(cfg))) {
      return { type: 'ACTION', action: { type: 'USE_FORECAST' } };
    }
  }
  // 6. 移动
  if (view.phase === 'OUTBOUND') {
    return { type: 'MOVE', toTileId: planOutboundStep(view, cfg.target, cfg.movement, rng) };
  }
  return { type: 'MOVE', toTileId: planReturnStep(view, cfg.movement) };
}

/* ------------------------------------------------------------------ */
/* 遥测：决策是否真的被预报改变（供 runner 使用，不参与决策）             */
/* ------------------------------------------------------------------ */

/**
 * 「如果没有预报，这一回合会走哪一格」。
 *
 * 做法：把 view.lastForecast 置空后重放同一个决策骨架。
 * 由于预报只通过两项影响决策——(a) 路线权重、(b) 当前格恶劣时等待——
 * 其余分支（事件/采矿/买装备/修整）与预报无关，因此这个对照是精确的：
 *  - 返回值 !== 实际移动目标  → Decision-Useful Forecast（预报确实改变了行动）
 *  - 返回值 === 实际移动目标  → Informational Only（看了但没改计划）
 *  - 返回 null（该回合本身就不做移动决策）→ 不计入
 */
export function blindNextTile(view: FairView, cfg: BaseBotConfig): TileId | null {
  const blind: FairView = { ...view, lastForecast: null };
  if (blind.pendingEvent) return null;
  if (blind.phase === 'MINING') return null;
  if (plannedPurchase(blind, cfg.equipment)) return null;
  if (cfg.rest && wantsRest(blind)) return null;
  const fixedRng: BotRng = () => 0.5;
  if (blind.phase === 'OUTBOUND') {
    return planOutboundStep(blind, cfg.target, cfg.movement, fixedRng);
  }
  return planReturnStep(blind, cfg.movement);
}
