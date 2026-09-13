import { createNewGame, performMove, performAction, resolvePendingEvent, getLegalMoves } from '../src/game';
import {
  CreateGameOptions,
  EventChoice,
  GameAction,
  GameState,
  GameMap,
  TileId,
  TerrainType,
  WeatherType,
} from '../src/game/types';
import { bfsPath, gridNeighbors, isNormalTile } from '../src/game/map/grid';
import { WEATHER_TABLE_DAYS } from '../src/game/rules/weather';

/** 创建新游戏（默认固定 Seed） */
export function newGame(seed = 'test-seed', opts: CreateGameOptions = {}): GameState {
  return createNewGame(seed, opts);
}

/** 全图晴朗 + 无遭遇 + 无干涸的覆盖表 */
export function calmOverrides(map: GameMap): CreateGameOptions {
  const weather: Record<TileId, WeatherType[]> = {};
  const encounters: Record<TileId, GameState['map']['encounters'][TileId]> = {};
  const drought: Record<TileId, boolean> = {};
  for (const id of Object.keys(map.tiles)) {
    weather[id] = new Array(WEATHER_TABLE_DAYS).fill('SUNNY');
    encounters[id] = null;
    drought[id] = false;
  }
  return { weather, encounters, drought };
}

/** 覆盖某格子某天（1-based）的天气 */
export function withWeather(state: GameState, tileId: TileId, day: number, w: WeatherType): GameState {
  const s = structuredClone(state);
  s.map.weather[tileId][day - 1] = w;
  return s;
}

/** 直接修改状态（测试专用） */
export function mutate(state: GameState, fn: (s: GameState) => void): GameState {
  const s = structuredClone(state);
  fn(s);
  return s;
}

/** 找到所有指定地形的格子（按行优先排序） */
export function findTiles(state: GameState, terrain: TerrainType): TileId[] {
  return Object.values(state.map.tiles)
    .filter((t) => t.terrain === terrain)
    .map((t) => t.id);
}

/** 事件默认策略（与 Bot default 一致）：装备全用、早期追贼、八折 */
function defaultEventChoice(state: GameState): EventChoice | null {
  const ev = state.pendingEvents[0];
  if (!ev) return null;
  switch (ev.kind) {
    case 'SANDSTORM':
      return { kind: 'SANDSTORM', useTent: state.tents.length > 0, useCompass: state.compasses > 0 };
    case 'RAINSTORM':
      return { kind: 'RAINSTORM', useTent: state.tents.length > 0 };
    case 'CARAVAN':
      return state.cash >= 300 && state.tents.length === 0
        ? { kind: 'CARAVAN', action: 'BUY_TENT' }
        : { kind: 'CARAVAN', action: 'TAKE_INTEL' };
    case 'THIEF':
      return state.maxDays - state.daysUsed > 12 && ev.stolen > 0
        ? { kind: 'THIEF', action: 'CHASE' }
        : { kind: 'THIEF', action: 'GIVE_UP' };
    case 'MARKET':
      return { kind: 'MARKET', action: 'TAKE_DISCOUNT' };
    default:
      return null;
  }
}

/** 解决当前所有待决事件（按默认策略） */
export function resolveAll(state: GameState): GameState {
  let s = state;
  while (s.pendingEvents.length > 0 && s.status === 'ONGOING') {
    const ev = s.pendingEvents[0];
    const choice = defaultEventChoice(s);
    if (!choice) throw new Error(`未处理的事件: ${ev.kind}`);
    s = resolvePendingEvent(s, ev.id, choice);
  }
  return s;
}

/** 执行行动并解决后续事件 */
export function act(state: GameState, action: GameAction): GameState {
  let s = performAction(state, action);
  s = resolveAll(s);
  return s;
}

/** 沿给定路径移动（每步后解决事件） */
export function walk(state: GameState, path: TileId[]): GameState {
  let s = state;
  for (const step of path) {
    s = performMove(s, step);
    s = resolveAll(s);
  }
  return s;
}

/** BFS 计算从当前位置到目标的路径（去程规划：不路过另一个矿区） */
export function pathTo(state: GameState, target: TileId): TileId[] {
  const otherMines = state.map.mines.filter((m) => m.tileId !== target).map((m) => m.tileId);
  const path = bfsPath(state.map, state.position, target, [], (id) => !otherMines.includes(id));
  if (!path) throw new Error(`无法到达 ${target}`);
  return path.slice(1); // 不含当前位置
}

/** BFS 计算返程路径（避开烧掉的普通格；另一个矿区不可通行） */
export function returnPath(state: GameState, target: TileId): TileId[] {
  const forbidden = new Set([...state.visitedOutbound, ...state.visitedReturn].filter((id) => isNormalTile(state.map, id)));
  const otherMines = state.map.mines.filter((m) => m.tileId !== state.mineEntranceId).map((m) => m.tileId);
  const path = bfsPath(state.map, state.position, target, forbidden, (id) => !otherMines.includes(id));
  if (!path) throw new Error(`无合法返程路径到 ${target}`);
  return path.slice(1);
}

/** 走到目标（自动规划路径：OUTBOUND 用全图 BFS；RETURN 避开烧格） */
export function walkTo(state: GameState, target: TileId): GameState {
  const path = state.phase === 'RETURN' ? returnPath(state, target) : pathTo(state, target);
  return walk(state, path);
}

/** 获取指定矿区的 tileId */
export function mineTile(state: GameState, slot: 'A' | 'B'): TileId {
  return state.map.mines.find((m) => m.slot === slot)!.tileId;
}

/** 找到距当前位置最近的一个指定地形格子 */
export function nearestTileOf(state: GameState, terrain: TerrainType): TileId {
  const candidates = findTiles(state, terrain);
  if (candidates.length === 0) throw new Error(`地图上没有 ${terrain}`);
  let best: TileId = candidates[0];
  let bestLen = Infinity;
  for (const c of candidates) {
    const p = bfsPath(state.map, state.position, c);
    if (p && p.length < bestLen) {
      bestLen = p.length;
      best = c;
    }
  }
  return best;
}

export { getLegalMoves, gridNeighbors };
