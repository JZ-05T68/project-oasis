import type { EventChoice } from '../../game/types';
import type { BotDecision, BotRng } from './types';
import type { FairView } from '../fairView';
import { bfsPath, dijkstraPath, minReturnDays, returnForbidden, SAFE_WEIGHTS } from '../simGraph';
import { lowestDurabilityIndex } from '../../game/rules/equipment';

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

export type MovementStyle = 'SHORTEST' | 'SAFEST';

function mineTileOf(view: FairView, slot: 'A' | 'B'): string {
  return view.map.mines.find((m) => m.slot === slot)!.tileId;
}

function outboundPath(view: FairView, mineId: string, style: MovementStyle): string[] | null {
  const banned = new Set(view.visitedOutbound);
  banned.delete(view.map.cityId);
  // 不能把「另一个矿区」当普通道路穿过——进入即触发进矿
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

export function resolveTargetMine(view: FairView, target: MineTarget, style: MovementStyle): string | null {
  if (view.phase !== 'OUTBOUND') return view.mineEntranceId;
  if (target.kind === 'FIXED') {
    const id = mineTileOf(view, target.slot);
    return outboundPath(view, id, style) ? id : nearestMine(view, style);
  }
  if (target.kind === 'NEAREST') return nearestMine(view, style);
  return safestMine(view);
}

/** 移动代价：未知地形按中性风险，已知的按地形与预报修正 */
export function moveWeight(view: FairView, tileId: string): number {
  const node = view.map.tiles[tileId];
  let w = node.terrain ? (SAFE_WEIGHTS[node.terrain] ?? 1) : 2; // 未知 = 中性
  // ForecastBot：已购买的预报窗口内，坏天气邻格加罚
  if (view.lastForecast) {
    const f = view.lastForecast;
    if (f.day === view.day + 1) {
      const cell = f.cells.find((c) => c.tileId === tileId);
      if (cell && (cell.weather === 'SANDSTORM' || cell.weather === 'RAINSTORM' || cell.weather === 'MUD')) w += 6;
      else if (cell && cell.weather === 'HEAT') w += 3;
    }
  }
  return w;
}

/** 出发去程：走向目标矿区的下一步 */
export function planOutboundStep(view: FairView, target: MineTarget, style: MovementStyle, rng: BotRng): string {
  const mineId = resolveTargetMine(view, target, style);
  if (!mineId) return fallbackMove(view, rng);
  const path = outboundPath(view, mineId, style);
  if (!path) return fallbackMove(view, rng);
  const next = path[1];
  return view.legalMoves.includes(next) ? next : fallbackMove(view, rng);
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

export type EventPolicyKind = 'default' | 'cheap';

export function eventChoice(view: FairView, policy: EventPolicyKind): EventChoice | null {
  const ev = view.pendingEvent;
  if (!ev) return null;
  const tentIdx = view.tents.length > 0 ? lowestDurabilityIndex(view.tents) : undefined;
  switch (ev.kind) {
    case 'SANDSTORM':
      return policy === 'cheap'
        ? { kind: 'SANDSTORM', useTent: false, useCompass: false }
        : { kind: 'SANDSTORM', useTent: view.tents.length > 0, useCompass: view.compasses > 0, tentIndex: tentIdx };
    case 'RAINSTORM':
      return policy === 'cheap'
        ? { kind: 'RAINSTORM', useTent: false }
        : { kind: 'RAINSTORM', useTent: view.tents.length > 0, tentIndex: tentIdx };
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
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* 天气预报策略                                                        */
/* ------------------------------------------------------------------ */

export type ForecastPolicy = 'never' | 'heuristic';

/** 购买启发式：早期且无存量时购买储备；必须尊重引擎禁用标志（必败检查等） */
export function shouldBuyForecastPack(view: FairView): boolean {
  const info = view.availableActions.find((a) => a.action.type === 'BUY_FORECAST_PACK');
  if (!info || info.disabled) return false;
  if (view.forecastCharges > 0) return false;
  if (view.daysRemaining < 12) return false;
  return view.stamina <= 4 || plannedRouteHasKnownDesert(view);
}

/** 使用启发式：耐力偏低或邻格存在已知沙漠时查看 */
export function shouldUseForecast(view: FairView): boolean {
  if (view.forecastCharges <= 0) return false;
  if (view.stamina <= 2) return true;
  if (view.lastForecast && view.lastForecast.day === view.day + 1) return false;
  return plannedRouteHasKnownDesert(view);
}

function plannedRouteHasKnownDesert(view: FairView): boolean {
  return view.legalMoves.some((id) => view.map.tiles[id].terrain === 'DESERT');
}

/** 当前格明天是否有恶劣天气（需要已有当日预报） */
export function currentTileTomorrowSevere(view: FairView): boolean {
  if (!view.lastForecast || view.lastForecast.day !== view.day + 1) return false;
  const cell = view.lastForecast.cells.find((c) => c.isCurrent);
  return !!cell && (cell.weather === 'SANDSTORM' || cell.weather === 'RAINSTORM' || cell.weather === 'MUD');
}

/* ------------------------------------------------------------------ */
/* 休整                                                                */
/* ------------------------------------------------------------------ */

/** 修整决策：绿洲有水且允许修整（引擎的 disabled 标志已包含帐篷条件） */
export function wantsRest(view: FairView): boolean {
  const rest = view.availableActions.find((a) => a.action.type === 'REST');
  return !!rest && !rest.disabled && view.stamina < view.maxStamina;
}

/** 宿营/修整用帐篷下标（无帐篷返回 undefined） */
export function botTentIndex(view: FairView): number | undefined {
  return view.tents.length > 0 ? lowestDurabilityIndex(view.tents) : undefined;
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
  forecast: ForecastPolicy;
  rest: boolean;
  /** 停留策略：预报显示当前格明天恶劣且耐力低时等待 */
  wait: boolean;
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
    return { type: 'ACTION', action: { type: 'REST', tentIndex: botTentIndex(view) } };
  }
  // 5. 天气预报（购买/使用）与停留避灾
  if (cfg.forecast === 'heuristic') {
    if (shouldBuyForecastPack(view)) {
      return { type: 'ACTION', action: { type: 'BUY_FORECAST_PACK' } };
    }
    if (shouldUseForecast(view)) {
      return { type: 'ACTION', action: { type: 'USE_FORECAST' } };
    }
    if (cfg.wait && view.stamina <= 2 && currentTileTomorrowSevere(view)) {
      const waitInfo = view.availableActions.find((a) => a.action.type === 'WAIT');
      if (waitInfo && !waitInfo.disabled) {
        return { type: 'ACTION', action: { type: 'WAIT', tentIndex: botTentIndex(view) } };
      }
    }
  }
  // 6. 移动
  if (view.phase === 'OUTBOUND') {
    return { type: 'MOVE', toTileId: planOutboundStep(view, cfg.target, cfg.movement, rng) };
  }
  return { type: 'MOVE', toTileId: planReturnStep(view) };
}
