/**
 * Project Oasis 核心类型定义（v0.1.2 Random Expedition）。
 * 地图为 m×n 二维格子；城市固定左下角；两个矿区固定在最右列。
 */

export type TileId = string; // 格式 `${row}:${col}`

export type MineSlot = 'A' | 'B';

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

/** 遭遇种类（开局按 Seed 预生成到每个普通格） */
export type EncounterKind = 'CARAVAN' | 'THIEF' | 'MARKET' | 'HERDSMAN';

/** 阶段 */
export type Phase = 'OUTBOUND' | 'MINING' | 'RETURN' | 'FINISHED';

/** 对局状态 */
export type GameStatus = 'ONGOING' | 'VICTORY' | 'DEFEAT';

/** 失败原因 */
export type DefeatReason =
  | 'TIMEOUT' // 超过 maxDays
  | 'STAMINA_EXHAUSTED' // 耐力归零
  | 'RETURN_ROUTE_SEVERED' // 返程不存在合法回城路径（FAILURE_NO_RETURN_PATH）
  | 'TRAPPED' // 去程被围死，无任何合法移动
  | 'NO_LEGAL_ROUTE' // （提前判负）已不存在任何合法完成路线
  | 'INSUFFICIENT_TIME'; // （提前判负）剩余时间已无法合法完成旅程

/** 格子 */
export interface GridTile {
  id: TileId;
  row: number;
  col: number;
  terrain: TerrainType;
  /** 仅矿区格：矿区档位 */
  mineSlot?: MineSlot;
}

/** 矿区信息（地图生成时客观评估，与玩家行为无关） */
export interface MineInfo {
  slot: MineSlot;
  tileId: TileId;
  row: number;
  col: number;
  /** 固定收购价（本局，进入即锁定到该矿区） */
  gemPrice: number;
  difficultyScore: number;
  /** 风险评级 1~5 */
  estimatedRisk: number;
  /** 评估明细（开发/调试/仿真用，不向玩家展示） */
  detail: {
    /** 最短合法往返方案总长度（去程+返程跳数） */
    roundTripLength: number;
    /** 该方案的客观风险和（价格基准） */
    roundTripRisk: number;
    jitter: number;
  };
}

/**
 * 二维格子地图（含预生成的天气/遭遇/绿洲状态/矿区价值）。
 * 同一 Seed 必然生成完全相同的地图。
 */
export interface GameMap {
  rows: number;
  cols: number;
  cityId: TileId;
  tiles: Record<TileId, GridTile>;
  /** 两个矿区（slot A / B） */
  mines: MineInfo[];
  /** 每格预生成天气：weather[tileId][day-1] */
  weather: Record<TileId, WeatherType[]>;
  /** 每个普通格预生成的遭遇（null = 无）；城市/矿区不含 */
  encounters: Record<TileId, EncounterKind | null>;
  /** 绿洲干涸状态（仅绿洲格） */
  drought: Record<TileId, boolean>;
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
  | { id: string; kind: 'SANDSTORM'; tileId: TileId }
  | { id: string; kind: 'RAINSTORM'; tileId: TileId }
  | { id: string; kind: 'CARAVAN'; tileId: TileId }
  | { id: string; kind: 'THIEF'; tileId: TileId; stolen: number }
  | { id: string; kind: 'MARKET'; tileId: TileId };

/** 沙尘暴选择（使用帐篷时必须指明具体哪一顶） */
export interface SandstormChoice {
  useTent: boolean;
  useCompass: boolean;
  /** useTent 时必填：帐篷下标 */
  tentIndex?: number;
}

/** 暴雨选择（使用帐篷时必须指明具体哪一顶；该帐篷整顶报废） */
export interface RainstormChoice {
  useTent: boolean;
  /** useTent 时必填：帐篷下标 */
  tentIndex?: number;
}

/** 商队选择 */
export type CaravanChoice = 'BUY_TENT' | 'TAKE_INTEL';

/** 盗贼选择 */
export type ThiefChoice = 'GIVE_UP' | 'CHASE';

/** 市集选择 */
export type MarketChoice = 'TAKE_DISCOUNT' | 'WORK';

export type EventChoice =
  | ({ kind: 'SANDSTORM' } & SandstormChoice)
  | ({ kind: 'RAINSTORM' } & RainstormChoice)
  | { kind: 'CARAVAN'; action: CaravanChoice }
  | { kind: 'THIEF'; action: ThiefChoice }
  | { kind: 'MARKET'; action: MarketChoice };

/* ------------------------------------------------------------------ */
/* 天气预报视图（单日、当前格 + 8 邻域）                                  */
/* ------------------------------------------------------------------ */

export interface ForecastCell {
  tileId: TileId;
  row: number;
  col: number;
  /** 是否为玩家当前格 */
  isCurrent: boolean;
  /** 地形是否已揭示（未知格只显示坐标与天气，不揭示地形） */
  terrainKnown: boolean;
  /** 下一天天气（战争迷雾不隐藏天气本身） */
  weather: WeatherType;
}

export interface ForecastView {
  /** 预报的目标天（1-based 游戏日，即“明天”） */
  day: number;
  /** 当前格 + 8 邻域（地图边缘自动裁剪），最多 9 格 */
  cells: ForecastCell[];
}

/* ------------------------------------------------------------------ */
/* 行动                                                                */
/* ------------------------------------------------------------------ */

export type GameActionType =
  | 'MINE'
  | 'START_RETURN'
  | 'REST'
  | 'BUY'
  | 'BUY_FORECAST_PACK'
  | 'USE_FORECAST'
  | 'WAIT';

export interface GameAction {
  type: GameActionType;
  /** BUY 时指定物品 */
  item?: 'tent' | 'compass';
  /**
   * WAIT / REST 在需要帐篷的地点（野外/矿区/绿洲）必须指明使用哪一顶
   * （城市/村庄等待无需帐篷，可省略）
   */
  tentIndex?: number;
}

/** 提供给 UI 的行动描述 */
export interface ActionInfo {
  action: GameAction;
  label: string;
  hint?: string;
  price?: number;
  disabled?: boolean;
  disabledReason?: string;
  /** 该行动需要玩家选择具体帐篷（多顶时 UI 展开逐顶选择） */
  needsTent?: boolean;
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

export interface SettlementView {
  outcome: GameStatus;
  defeatReason: DefeatReason | null;
  seed: string;
  daysUsed: number;
  maxDays: number;
  outboundDays: number | null;
  miningDays: number;
  returnDays: number;
  forecastPacks: number;
  gemsKg: number;
  /** 进入矿区后锁定的成交单价（v0.1.2 动态评估价） */
  gemPrice: number | null;
  mineSlot: MineSlot | null;
  routeScore: number | null;
  stars: number | null;
  gemRevenue: number;
  equipmentSpent: number;
  cashRemaining: number;
  finalAssets: number;
  netProfit: number;
}

/* ------------------------------------------------------------------ */
/* 全局状态                                                             */
/* ------------------------------------------------------------------ */

export interface GameStats {
  /** 购买的天气预报包数量（每包 maxDays-1） */
  forecastPacks: number;
  /** 进入矿区当天的 daysUsed 快照（未进矿为 null） */
  outboundDays: number | null;
  miningDays: number;
  /** 开始返程时的 daysUsed 快照 */
  returnStartDay: number | null;
}

export interface GameState {
  seed: string;
  /** mulberry32 内部状态（uint32；v0.1.2 运行期不再消耗随机数，保留字段以防未来扩展） */
  rngState: number;

  map: GameMap;

  daysUsed: number;
  /** 最大旅程天数（购买天气预报包会永久 -1） */
  maxDays: number;
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

  /** 剩余天气预报次数（购买 +3，使用 -1，不过期） */
  forecastCharges: number;

  position: TileId;
  /** 锁定的矿区（进入矿区后设置） */
  mineEntranceId: TileId | null;

  /** 进矿时锁定的成交单价 */
  gemPrice: number | null;
  /** 路线风险评分（仅供统计，不影响售价） */
  routeScore: number | null;

  visitedOutbound: TileId[];
  visitedReturn: TileId[];

  /** 亲自探索过的格子（地形永久揭示） */
  explored: TileId[];
  /** 通过商队/牧民情报获知地形的格子 */
  intelKnown: TileId[];
  /** 已触发过遭遇的格子（每格每局最多一次） */
  triggeredEncounters: TileId[];

  /** 每个绿洲是否已休整过 */
  oasisRestUsed: Record<TileId, boolean>;

  /** 待处理事件队列（Modal） */
  pendingEvents: PendingEvent[];
  /** 最近一次天气预报视图（购买自动使用 / 手动使用时设置；天数推进后失效） */
  lastForecast: ForecastView | null;

  /** 市集八折是否对当前村庄访问生效 */
  visitDiscount: boolean;

  stats: GameStats;
  log: LogEntry[];
}

/** createNewGame 的可选注入（主要供测试使用） */
export interface CreateGameOptions {
  /** 覆盖指定格子的整列天气（索引 = day-1） */
  weather?: Record<TileId, WeatherType[]>;
  /** 覆盖指定格子的预生成遭遇 */
  encounters?: Record<TileId, EncounterKind | null>;
  /** 覆盖绿洲干涸状态 */
  drought?: Record<TileId, boolean>;
  /** 覆盖初始最大天数（默认取配置） */
  maxDays?: number;
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
