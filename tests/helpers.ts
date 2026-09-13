import { createNewGame, resolvePendingEvent, performMove, performAction } from '../src/game';
import {
  CreateGameOptions,
  GameAction,
  GameState,
  GameMap,
  MapNode,
  NodeId,
  TerrainType,
  WeatherType,
} from '../src/game/types';
import { buildMap, worldMap } from '../src/game/map/worldMap';
import { WEATHER_TABLE_DAYS } from '../src/game/rules/weather';

/** 创建新游戏（默认固定 Seed） */
export function newGame(seed = 'test-seed', opts: CreateGameOptions = {}): GameState {
  return createNewGame(seed, opts);
}

/** 用迷你地图创建新游戏，全部节点天气晴朗且无遭遇 */
export function newMiniGame(
  terrains: Record<string, TerrainType>,
  edges: Array<[string, string]>,
  seed = 'mini-seed',
): GameState {
  const ids = Object.keys(terrains);
  const nodes: MapNode[] = ids.map((id, i) => ({
    id,
    terrain: terrains[id],
    name: id,
    x: i % 6,
    y: Math.floor(i / 6),
  }));
  const map: GameMap = buildMap(nodes, edges);
  return newGame(seed, { map, ...calmOverrides(map) });
}

/** 全图晴朗 + 无遭遇的覆盖表 */
export function calmOverrides(map: GameMap): {
  weather: Record<NodeId, WeatherType[]>;
  encounters: Record<NodeId, number[]>;
} {
  const weather: Record<NodeId, WeatherType[]> = {};
  const encounters: Record<NodeId, number[]> = {};
  for (const id of Object.keys(map.nodes)) {
    weather[id] = new Array(WEATHER_TABLE_DAYS).fill('SUNNY');
    encounters[id] = new Array(WEATHER_TABLE_DAYS).fill(0.99);
  }
  return { weather, encounters };
}

/** 覆盖某节点某天（1-based）的天气 */
export function withWeather(state: GameState, nodeId: NodeId, day: number, w: WeatherType): GameState {
  const s = structuredClone(state);
  s.weather[nodeId][day - 1] = w;
  return s;
}

/** 覆盖某节点某天（1-based）的遭遇 roll（0.01 必触发，0.99 必不触发） */
export function withEncounterRoll(state: GameState, nodeId: NodeId, day: number, roll: number): GameState {
  const s = structuredClone(state);
  s.encounterRolls[nodeId][day - 1] = roll;
  return s;
}

/** 直接修改状态（测试专用） */
export function mutate(state: GameState, fn: (s: GameState) => void): GameState {
  const s = structuredClone(state);
  fn(s);
  return s;
}

/** 回答所有非天气预报事件之外的断言失败；对天气预报询问统一选择「不查看」 */
export function declineForecast(state: GameState): GameState {
  let s = state;
  while (s.pendingEvents.length > 0) {
    const ev = s.pendingEvents[0];
    if (ev.kind !== 'FORECAST_OFFER') {
      throw new Error(`期望只剩天气预报询问，实际还有: ${ev.kind}`);
    }
    s = resolvePendingEvent(s, ev.id, { kind: 'FORECAST_OFFER', accept: false });
  }
  return s;
}

/** 沿路径移动（自动拒绝天气预报询问） */
export function walk(state: GameState, path: NodeId[]): GameState {
  let s = state;
  for (const step of path) {
    s = performMove(s, step);
    s = declineForecast(s);
  }
  return s;
}

/** 执行行动（自动拒绝天气预报询问） */
export function act(state: GameState, action: GameAction): GameState {
  let s = performAction(state, action);
  s = declineForecast(s);
  return s;
}

/** 找到指定 kind 的待处理事件（断言存在且位于队首） */
export function expectPending(state: GameState): GameState['pendingEvents'][number] {
  const ev = state.pendingEvents[0];
  if (!ev) throw new Error('期望存在待处理事件，实际没有');
  return ev;
}

/** 全程脚本：南线往返（无事件、晴天），返回最终状态 */
export function runSouthLoop(seed = 'loop-seed'): GameState {
  let s = newGame(seed, calmOverrides(worldMap));
  s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
  s = act(s, { type: 'MINE' });
  s = act(s, { type: 'MINE' });
  s = performAction(s, { type: 'START_RETURN' });
  s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']);
  return s;
}
