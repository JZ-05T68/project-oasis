import type {
  ActionInfo,
  ForecastView,
  GameState,
  MineSlot,
  NodeId,
  PendingEvent,
  Phase,
  TerrainType,
  WeatherType,
} from '../game/types';
import { gameConfig } from '../game/config/gameConfig';
import { getLegalMoves, getAvailableActions, getCurrentWeather, isTerrainKnown } from '../game';

/**
 * FairView —— Bot 能看到的「玩家视角」信息。
 *
 * 结构性防作弊：Bot 只拿到本视图，拿不到原始 GameState，
 * 因此无法读取：
 *  - 未来天气表（state.weather）
 *  - 未触发的事件 roll 表（state.encounterRolls）
 *  - 未抵达绿洲的干涸状态
 *  - RNG 内部状态
 * 战争迷雾：未知地形显示为 null（道路拓扑按规则始终完整可见）。
 */

export interface FairMapNode {
  id: NodeId;
  /** 已知地形；未知（战争迷雾）为 null */
  terrain: TerrainType | null;
  isCity: boolean;
  isMine: boolean;
  /** 仅矿区入口：矿区档位（公开信息，对应固定收购价） */
  mineSlot?: MineSlot;
  /** 矿区入口的公开固定收购价 */
  minePrice: number | null;
}

export interface FairMap {
  nodes: Record<NodeId, FairMapNode>;
  adjacency: Record<NodeId, NodeId[]>;
  edges: Array<[NodeId, NodeId]>;
  cityId: NodeId;
  mineIds: NodeId[];
}

export interface FairView {
  seed: string;
  day: number;
  maxDays: number;
  daysRemaining: number;
  phase: Phase;
  position: NodeId;
  cash: number;
  stamina: number;
  maxStamina: number;
  tents: number[];
  compasses: number;
  gemsKg: number;

  mineEntranceId: NodeId | null;
  gemPrice: number | null;
  routeScore: number | null;

  visitedOutbound: NodeId[];
  visitedReturn: NodeId[];
  explored: NodeId[];
  intelKnown: NodeId[];
  /** 亲自到过的绿洲的休整记录 */
  oasisRestUsed: Record<NodeId, boolean>;
  /** 亲自到过的绿洲的干涸状态（未到过的绿洲不含在内） */
  knownOasisDrought: Record<NodeId, boolean>;

  map: FairMap;
  /** 当前格今天的天气（身临其境可知） */
  weatherToday: WeatherType;
  /** 最近一次购买的天气预报（若有） */
  lastForecast: ForecastView | null;

  legalMoves: NodeId[];
  availableActions: ActionInfo[];
  /** 待决事件队首（若有） */
  pendingEvent: PendingEvent | null;
}

function buildFairMap(state: GameState): FairMap {
  const nodes: Record<NodeId, FairMapNode> = {};
  for (const id of Object.keys(state.map.nodes)) {
    const n = state.map.nodes[id];
    const known = isTerrainKnown(state, id);
    const isMine = n.terrain === 'MINE';
    const isCity = n.terrain === 'CITY';
    nodes[id] = {
      id,
      terrain: known ? n.terrain : null,
      isCity,
      isMine,
      mineSlot: isMine ? n.mineSlot : undefined,
      minePrice: isMine && n.mineSlot ? gameConfig.mineBasePrice[n.mineSlot] : null,
    };
  }
  return {
    nodes,
    adjacency: state.map.adjacency,
    edges: state.map.edges,
    cityId: state.map.cityId,
    mineIds: state.map.mineIds,
  };
}

export function buildFairView(state: GameState): FairView {
  const knownOasisDrought: Record<NodeId, boolean> = {};
  for (const id of state.explored) {
    if (state.map.nodes[id]?.terrain === 'OASIS') {
      knownOasisDrought[id] = !!state.oasisDrought[id];
    }
  }
  const view: FairView = {
    seed: state.seed,
    day: state.daysUsed,
    maxDays: gameConfig.maxDays,
    daysRemaining: gameConfig.maxDays - state.daysUsed,
    phase: state.phase,
    position: state.position,
    cash: state.cash,
    stamina: state.stamina,
    maxStamina: gameConfig.maxStamina,
    tents: state.tents,
    compasses: state.compasses,
    gemsKg: state.gemsKg,
    mineEntranceId: state.mineEntranceId,
    gemPrice: state.gemPrice,
    routeScore: state.routeScore,
    visitedOutbound: state.visitedOutbound,
    visitedReturn: state.visitedReturn,
    explored: state.explored,
    intelKnown: state.intelKnown,
    oasisRestUsed: state.oasisRestUsed,
    knownOasisDrought,
    map: buildFairMap(state),
    weatherToday: getCurrentWeather(state),
    lastForecast: state.lastForecast,
    legalMoves: getLegalMoves(state),
    availableActions: getAvailableActions(state),
    pendingEvent: state.pendingEvents[0] ?? null,
  };
  return view;
}
