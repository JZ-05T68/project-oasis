import type { EventChoice } from '../../game/types';
import type { BotDecision, BotRng } from './types';
import type { FairView, FairMap } from '../fairView';
import { bfsPath, dijkstraPath, minReturnDays, returnForbidden, SAFE_WEIGHTS } from '../simGraph';

/**
 * 公共策略件：移动规划、采矿决策、购买策略、事件应对。
 * 全部只使用 FairView 的玩家视角信息。
 */

/* ------------------------------------------------------------------ */
/* 移动规划                                                            */
/* ------------------------------------------------------------------ */

export type MineTarget =
  | { kind: 'NEAREST' }   // BFS 跳数最短的矿区
  | { kind: 'SAFEST' }    // 风险加权代价最低的矿区
  | { kind: 'FIXED'; mineId: string };

export type MovementStyle = 'SHORTEST' | 'SAFEST';

/** 出发去程：走向目标矿区的下一步（遵守去程规则与战争迷雾权重） */
export function planOutboundStep(view: FairView, target: MineTarget, style: MovementStyle, rng: BotRng): string {
  const mineId = resolveTargetMine(view, target, style);
  if (!mineId) return fallbackMove(view, rng);
  const path = outboundPath(view, mineId, style);
  if (!path) return fallbackMove(view, rng);
  const next = path[1];
  return view.legalMoves.includes(next) ? next : fallbackMove(view, rng);
}

export function resolveTargetMine(view: FairView, target: MineTarget, style: MovementStyle): string | null {
  if (view.phase !== 'OUTBOUND') return view.mineEntranceId;
  if (target.kind === 'FIXED') {
    const id = target.mineId;
    return pathExistsToMine(view, id, style) ? id : nearestMine(view, style);
  }
  if (target.kind === 'NEAREST') return nearestMine(view, style);
  return safestMine(view);
}

function pathExistsToMine(view: FairView, mineId: string, style: MovementStyle): boolean {
  return outboundPath(view, mineId, style) !== null;
}

function outboundPath(view: FairView, mineId: string, style: MovementStyle): string[] | null {
  const banned = new Set(view.visitedOutbound);
  banned.delete(view.map.cityId);
  // 不能把「其他矿区入口」当普通道路穿过——进入即触发进矿
  const otherMines = view.map.mineIds.filter((m) => m !== mineId);
  const filter = (id: string) => !otherMines.includes(id);
  if (style === 'SAFEST') {
    const r = dijkstraPath(view.map, view.position, mineId, (id) => moveWeight(view, id), banned, filter);
    return r ? r.path : bfsPath(view.map, view.position, mineId, banned, filter);
  }
  return bfsPath(view.map, view.position, mineId, banned, filter);
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

/** 移动代价：未知地形按中性风险，已知的按地形与预报修正 */
export function moveWeight(view: FairView, nodeId: string): number {
  const node = view.map.nodes[nodeId];
  let w = node.terrain ? (SAFE_WEIGHTS[node.terrain] ?? 1) : 2; // 未知 = 中性
  // ForecastBot：已购买的预报窗口内，坏天气节点加罚
  if (view.lastForecast) {
    const f = view.lastForecast;
    const offset = f.dayNumbers.indexOf(view.day + 1);
    if (offset >= 0) {
      const row = f.rows.find((r) => r.nodeId === nodeId);
      const wPrev = row && row.terrainKnown ? row.values[offset] : null;
      if (wPrev === 'SANDSTORM' || wPrev === 'RAINSTORM' || wPrev === 'MUD') w += 6;
      else if (wPrev === 'HEAT') w += 3;
    }
  }
  return w;
}

/** 返程：最短合法路线的下一步 */
export function planReturnStep(view: FairView): string {
  const path = bfsPath(view.map, view.position, view.map.cityId, returnForbidden(view));
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
  if (minRet === null) return false; // 已无归途，再挖也无意义（引擎会判负）
  return view.daysRemaining > minRet + buffer;
}

/* ------------------------------------------------------------------ */
/* 购买策略                                                            */
/* ------------------------------------------------------------------ */

export interface EquipmentPolicy {
  /** 希望持有的帐篷数与指南针数 */
  wantTents: number;
  wantCompasses: number;
  /** 买完后保留的现金底线 */
  cashReserve: number;
}

/** 在城市/村庄按政策购买（不耗时间），一次买一件；返回 null 表示不买 */
export function plannedPurchase(view: FairView, policy: EquipmentPolicy): { action: { type: 'BUY'; item: 'tent' | 'compass' } } | null {
  const shop = view.availableActions.find((a) => a.action.type === 'BUY');
  if (!shop) return null;
  const atVillage = view.map.nodes[view.position].terrain === 'VILLAGE';
  const discount = atVillage && view.availableActions.some((a) => a.hint?.includes('八折'));
  const tentInfo = view.availableActions.find((a) => a.action.item === 'tent');
  const compassInfo = view.availableActions.find((a) => a.action.item === 'compass');
  if (!tentInfo || !compassInfo) return null;
  const tentPrice = tentInfo.price ?? 400;
  const compassPrice = compassInfo.price ?? 100;

  if (view.tents.length < policy.wantTents && view.cash - tentPrice >= policy.cashReserve && !tentInfo.disabled) {
    return { action: { type: 'BUY', item: 'tent' } };
  }
  if (view.compasses < policy.wantCompasses && view.cash - compassPrice >= policy.cashReserve && !compassInfo.disabled) {
    return { action: { type: 'BUY', item: 'compass' } };
  }
  void discount;
  return null;
}

/* ------------------------------------------------------------------ */
/* 事件应对                                                            */
/* ------------------------------------------------------------------ */

export type EventPolicyKind = 'default' | 'cheap';

export function eventChoice(view: FairView, policy: EventPolicyKind, acceptForecast: boolean, rng: BotRng): EventChoice | null {
  void rng;
  const ev = view.pendingEvent;
  if (!ev) return null;
  switch (ev.kind) {
    case 'SANDSTORM':
      return policy === 'cheap'
        ? { kind: 'SANDSTORM', useTent: false, useCompass: false }
        : { kind: 'SANDSTORM', useTent: view.tents.length > 0, useCompass: view.compasses > 0 };
    case 'RAINSTORM':
      return policy === 'cheap'
        ? { kind: 'RAINSTORM', useTent: false }
        : { kind: 'RAINSTORM', useTent: view.tents.length > 0 };
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
      return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
    case 'FORECAST_OFFER':
      return { kind: 'FORECAST_OFFER', accept: acceptForecast && shouldForecastNow(view) };
    default:
      return null;
  }
}

/** 天气预报启发式：即将进入已知沙漠 / 耐力偏低 / 无帐篷时才值得花一天 */
export function shouldForecastNow(view: FairView): boolean {
  if (view.daysRemaining < 8) return false;
  if (view.stamina <= 3 || view.tents.length === 0) return true;
  // 未来 3 步计划路径上有已知沙漠
  const path = view.phase === 'OUTBOUND' ? outboundPathAhead(view, 3) : returnPathAhead(view, 3);
  return path.some((id) => view.map.nodes[id]?.terrain === 'DESERT');
}

function outboundPathAhead(view: FairView, steps: number): string[] {
  const target = view.map.mineIds
    .map((m) => ({ m, p: bfsPathFrom(view, m) }))
    .filter((x) => x.p)
    .sort((a, b) => a.p!.length - b.p!.length)[0];
  return target?.p?.slice(1, 1 + steps) ?? [];
}

function bfsPathFrom(view: FairView, mineId: string): string[] | null {
  const banned = new Set(view.visitedOutbound);
  banned.delete(view.map.cityId);
  const otherMines = view.map.mineIds.filter((x) => x !== mineId);
  return bfsPath(view.map, view.position, mineId, banned, (id) => !otherMines.includes(id));
}

function returnPathAhead(view: FairView, steps: number): string[] {
  const path = bfsPath(view.map, view.position, view.map.cityId, returnForbidden(view));
  return path?.slice(1, 1 + steps) ?? [];
}

/** 天气预报是否显示某节点在未来 3 天内有坏天气 */
export function forecastShowsBadWeather(view: FairView, nodeId: string): boolean {
  if (!view.lastForecast) return false;
  const row = view.lastForecast.rows.find((r) => r.nodeId === nodeId);
  if (!row || !row.terrainKnown) return false;
  return row.values.some((w) => w === 'SANDSTORM' || w === 'RAINSTORM' || w === 'MUD' || w === 'HEAT');
}

/** 让 bot 处理绿洲休整机会 */
export function wantsRest(view: FairView): boolean {
  const rest = view.availableActions.find((a) => a.action.type === 'REST');
  return !!rest && !rest.disabled && view.stamina < view.maxStamina;
}

/** 通用决策骨架（供多数 Bot 复用） */
export interface BaseBotConfig {
  name: string;
  target: MineTarget;
  movement: MovementStyle;
  equipment: EquipmentPolicy;
  miningBuffer: number;
  eventPolicy: EventPolicyKind;
  forecast: 'never' | 'heuristic';
  /** 休整策略：耐力不满就休整 */
  rest: boolean;
}

export function baseBotDecide(view: FairView, cfg: BaseBotConfig, rng: BotRng): BotDecision {
  // 1. 事件优先
  if (view.pendingEvent) {
    const acceptForecast = cfg.forecast === 'heuristic';
    const choice = eventChoice(view, cfg.eventPolicy, acceptForecast, rng);
    if (choice) return { type: 'EVENT', choice };
  }
  // 2. 采矿阶段
  if (view.phase === 'MINING') {
    return shouldKeepMining(view, cfg.miningBuffer)
      ? { type: 'ACTION', action: { type: 'MINE' } }
      : { type: 'ACTION', action: { type: 'START_RETURN' } };
  }
  // 3. 购买（城市/村庄，不耗时间）
  const purchase = plannedPurchase(view, cfg.equipment);
  if (purchase) return { type: 'ACTION', action: purchase.action };
  // 4. 绿洲休整
  if (cfg.rest && wantsRest(view)) {
    return { type: 'ACTION', action: { type: 'REST' } };
  }
  // 5. 移动
  if (view.phase === 'OUTBOUND') {
    return { type: 'MOVE', toNodeId: planOutboundStep(view, cfg.target, cfg.movement, rng) };
  }
  return { type: 'MOVE', toNodeId: planReturnStep(view) };
}

export function mapOf(view: FairView): FairMap {
  return view.map;
}
