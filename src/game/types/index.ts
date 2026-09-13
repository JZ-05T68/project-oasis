/**
 * Project Oasis 核心类型定义。
 * 该文件是引擎的事实契约：engine / rules / UI 全部依赖这里。
 */

export type NodeId = string;

/** 地形类型 */
export type TerrainType = 'CITY' | 'DESERT' | 'GRASS' | 'VILLAGE' | 'OASIS' | 'MINE';

/** 天气类型 */
export type WeatherType =
  | 'SUNNY'
  | 'CLOUDY'
  | 'HEAT'
  | 'SANDSTORM'
  | 'RAINSTORM'
  | 'MUD';

/** 阶段 */
export type Phase = 'OUTBOUND' | 'MINING' | 'RETURN' | 'FINISHED';

/** 对局状态 */
export type GameStatus = 'ONGOING' | 'VICTORY' | 'DEFEAT';

/** 失败原因 */
export type DefeatReason =
  | 'TIMEOUT' // 超过 42 天
  | 'STAMINA_EXHAUSTED' // 耐力归零
  | 'RETURN_ROUTE_SEVERED' // 返程不存在合法回城路径（含矿区入口被封）
  | 'TRAPPED'; // 去程被围死，无任何合法移动

/** 地图节点 */
export interface MapNode {
  id: NodeId;
  name: string;
  terrain: TerrainType;
  /** 渲染坐标（抽象网格，仅供 UI/SVG 使用） */
  x: number;
  y: number;
}

export type Edge = [NodeId, NodeId];

/** 地图（固定地图或测试用迷你地图） */
export interface GameMap {
  nodes: Record<NodeId, MapNode>;
  edges: Edge[];
  adjacency: Record<NodeId, NodeId[]>;
  cityId: NodeId;
  mineIds: NodeId[];
}

/** 日志条目 */
export interface LogEntry {
  day: number;
  kind: 'info' | 'good' | 'bad' | 'event' | 'system';
  text: string;
}

/* ------------------------------------------------------------------ */
/* 事件（Modal）                                                        */
/* ------------------------------------------------------------------ */

/** 待玩家决断的事件队列元素 */
export type PendingEvent =
  | { id: string; kind: 'SANDSTORM'; nodeId: NodeId }
  | { id: string; kind: 'RAINSTORM'; nodeId: NodeId }
  | { id: string; kind: 'CARAVAN'; nodeId: NodeId }
  | { id: string; kind: 'THIEF'; nodeId: NodeId; stolen: number }
  | { id: string; kind: 'MARKET'; nodeId: NodeId }
  | { id: string; kind: 'FORECAST_OFFER' };

/** 沙尘暴选择 */
export interface SandstormChoice {
  useTent: boolean;
  useCompass: boolean;
}

/** 暴雨选择 */
export interface RainstormChoice {
  useTent: boolean;
}

/** 商队选择 */
export type CaravanChoice = 'BUY_TENT' | 'TAKE_INTEL';

/** 盗贼选择 */
export type ThiefChoice = 'GIVE_UP' | 'CHASE';

/** 市集选择 */
export type MarketChoice = 'TAKE_DISCOUNT' | 'WORK';

/** 天气预报询问选择 */
export interface ForecastOfferChoice {
  accept: boolean;
}

export type EventChoice =
  | ({ kind: 'SANDSTORM' } & SandstormChoice)
  | ({ kind: 'RAINSTORM' } & RainstormChoice)
  | { kind: 'CARAVAN'; action: CaravanChoice }
  | { kind: 'THIEF'; action: ThiefChoice }
  | { kind: 'MARKET'; action: MarketChoice }
  | { kind: 'FORECAST_OFFER'; accept: boolean };

/* ------------------------------------------------------------------ */
/* 天气预报视图                                                         */
/* ------------------------------------------------------------------ */

export interface ForecastRow {
  nodeId: NodeId;
  /** 地形是否已知（未知则值为 UNKNOWN） */
  terrainKnown: boolean;
  /** 未来 3 天天气；terrainKnown=false 时为 ['UNKNOWN','UNKNOWN','UNKNOWN'] */
  values: Array<WeatherType | 'UNKNOWN'>;
}

export interface ForecastView {
  /** 预报覆盖的天序号（1-based 游戏日） */
  dayNumbers: number[];
  rows: ForecastRow[];
}

/* ------------------------------------------------------------------ */
/* 行动                                                                */
/* ------------------------------------------------------------------ */

export type GameActionType = 'MINE' | 'START_RETURN' | 'REST' | 'BUY';

export interface GameAction {
  type: GameActionType;
  /** BUY 时指定物品 */
  item?: 'tent' | 'compass';
}

/** 提供给 UI 的行动描述 */
export interface ActionInfo {
  action: GameAction;
  /** 展示名 */
  label: string;
  hint?: string;
  price?: number;
  disabled?: boolean;
  disabledReason?: string;
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

export interface SettlementView {
  outcome: GameStatus;
  defeatReason: DefeatReason | null;
  seed: string;
  daysUsed: number;
  outboundDays: number | null;
  miningDays: number;
  returnDays: number;
  forecastCount: number;
  gemsKg: number;
  /** 以下定价字段仅在进入过矿区后有值 */
  routeScore: number | null;
  stars: number | null;
  baseGemPrice: number | null;
  marketFactor: number | null;
  gemPrice: number | null;
  gemRevenue: number;
  equipmentSpent: number;
  cashRemaining: number;
  finalAssets: number;
  netProfit: number;
}

/* ------------------------------------------------------------------ */
/* 全局状态                                                             */
/* ------------------------------------------------------------------ */

/** 回合内标记，用于 20:00 天气预报询问的触发判定 */
export interface TurnFlags {
  /** 本回合因迷路/泥沼等额外损失了整天 */
  penaltyDay: boolean;
  /** 本回合消耗的是天气预报整天 */
  forecastDay: boolean;
}

export interface GameStats {
  forecastCount: number;
  /** 进入矿区当天的 daysUsed 快照（未进矿为 null） */
  outboundDays: number | null;
  miningDays: number;
  /** 开始返程时的 daysUsed 快照 */
  returnStartDay: number | null;
}

export interface GameState {
  seed: string;
  /** mulberry32 内部状态（uint32），仅市场系数等运行期随机使用 */
  rngState: number;

  map: GameMap;

  daysUsed: number;
  phase: Phase;
  status: GameStatus;
  defeatReason: DefeatReason | null;

  cash: number;
  stamina: number;
  gemsKg: number;

  /** 帐篷列表：每项为该帐篷剩余沙漠耐久（新帐篷为 3） */
  tents: number[];
  compasses: number;
  equipmentSpent: number;

  position: NodeId;
  /** 锁定的矿区入口（进入矿区后设置） */
  mineEntranceId: NodeId | null;

  /** 路线难度与定价（进入矿区后锁定） */
  routeScore: number | null;
  baseGemPrice: number | null;
  marketFactor: number | null;
  gemPrice: number | null;

  visitedOutbound: NodeId[];
  visitedReturn: NodeId[];

  /** 亲自探索过的节点（地形永久揭示） */
  explored: NodeId[];
  /** 通过商队/牧民情报获知地形的节点 */
  intelKnown: NodeId[];

  /** 每个绿洲是否已休整过 */
  oasisRestUsed: Record<NodeId, boolean>;
  /** 每个绿洲是否干涸（开局由 Seed 决定） */
  oasisDrought: Record<NodeId, boolean>;

  /** 预生成天气表：weather[nodeId][day-1] */
  weather: Record<NodeId, WeatherType[]>;
  /** 预生成遭遇 roll 表：encounterRolls[nodeId][day-1] ∈ [0,1) */
  encounterRolls: Record<NodeId, number[]>;

  /** 待处理事件队列（Modal） */
  pendingEvents: PendingEvent[];
  /** 最近一次购买的天预报视图（移动/消耗天后清除） */
  lastForecast: ForecastView | null;

  /** 市集八折是否对当前村庄访问生效 */
  visitDiscount: boolean;

  turnFlags: TurnFlags;
  stats: GameStats;
  log: LogEntry[];
}

/** createNewGame 的可选注入（主要供测试使用） */
export interface CreateGameOptions {
  /** 覆盖指定节点整列天气（索引 = day-1） */
  weather?: Record<NodeId, WeatherType[]>;
  /** 覆盖指定节点整列遭遇 roll（索引 = day-1） */
  encounters?: Record<NodeId, number[]>;
  /** 覆盖绿洲干涸状态 */
  drought?: Record<NodeId, boolean>;
  /** 使用自定义地图（测试用） */
  map?: GameMap;
}

/** 引擎错误 */
export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'GameError';
  }
}
