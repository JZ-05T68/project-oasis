/**
 * Project Oasis 核心类型定义（v0.1.2 Random Expedition / v0.1.2b 真人试玩修正）。
 * 地图为 m×n 二维格子；城市固定左下角；两个矿区固定在最右列（合法行区间见 gameConfig.map）。
 */

export type TileId = string; // 格式 `${row}:${col}`

/** 帐篷稳定唯一标识（形如 tent-001） */
export type TentId = string;

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

/**
 * 帐篷（v0.1.2b）：每顶帐篷拥有稳定唯一 ID。
 *
 * UI 与引擎之间的每一次帐篷选择都必须传 `TentId`，绝不允许用 array index 绑定：
 * 帐篷会被消耗 / 报废 / 从列表移除，列表位置会变化，只有 ID 是稳定的。
 */
export interface TentItem {
  /** 稳定唯一标识（tent-001 / tent-002 …），一经发放永不改变 */
  id: TentId;
  /** 剩余沙漠耐久（新帐篷 = tentDesertCharges；归零整顶移除，不会出现 0） */
  charges: number;
}

/** 日志条目 */
export interface LogEntry {
  day: number;
  kind: 'info' | 'good' | 'bad' | 'event' | 'system';
  text: string;
}

/* ------------------------------------------------------------------ */
/* 即时反馈（v0.1.2b：关键资源变化必须在结算后立即显式告知玩家）              */
/* ------------------------------------------------------------------ */

/** 会被即时反馈追踪的资源键 */
export type ResourceKey =
  | 'day'
  | 'maxDays'
  | 'stamina'
  | 'cash'
  | 'gemsKg'
  | 'compass'
  | 'forecast'
  | 'tent';

/**
 * 一条资源变化（一律以「变化前 → 变化后」表达）。
 * 由引擎在结算时自动对比快照生成，UI 只需原样渲染，不再自己推算差值。
 */
export interface ResourceChange {
  key: ResourceKey;
  /** 展示名，例如「耐力」「Tent C」「最大旅程天数」 */
  label: string;
  /** 变化前的可读值，例如 "5/5"、"3/3"、"第 12 天" */
  before: string;
  /** 变化后的可读值，例如 "3/5"、"报废"、"第 13 天" */
  after: string;
  /** 变差 / 变好 / 无变化 */
  direction: 'up' | 'down' | 'flat';
}

/**
 * 一次事件结算的综合结果（统一 ResultModal 的数据源）。
 *
 * 关键设计：
 * - 引擎负责把一次结算里**所有**资源变化合并成一个 EventResult（不会为同一事件连弹三个弹窗）；
 * - 同一事件既写入 `pendingResults`（即时反馈）也写入 `log`（历史记录），两边同源，不会只留日志；
 * - 正常移动（没有任何资源变化）不产生 EventResult，因此不会变成「弹窗模拟器」。
 */
export interface EventResult {
  /** 结算时刻的天数（用于日志对齐） */
  day: number;
  title: string;
  /** 发生了什么（自然语言） */
  message: string;
  changes: ResourceChange[];
  kind: LogEntry['kind'];
  /**
   * 同一事件在右下角历史日志里的那条记录（与弹窗同源双写）。
   * 有了它就能机器校验「即时反馈 + 历史日志」两边都确实记录了。
   */
  history: { day: number; text: string; kind: LogEntry['kind'] };
  /** 该次结算导致对局结束时的结果；未结束为 null */
  outcome: GameStatus | null;
  /** outcome === 'DEFEAT' 时的明确失败原因 */
  defeatReason: DefeatReason | null;
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

/** 沙尘暴选择（使用帐篷时必须指明具体哪一顶——传稳定 ID，不传下标） */
export interface SandstormChoice {
  useTent: boolean;
  useCompass: boolean;
  /** useTent 时必填：帐篷稳定 ID（TentId） */
  tentId?: TentId;
}

/** 暴雨选择（使用帐篷时必须指明具体哪一顶；该帐篷整顶报废） */
export interface RainstormChoice {
  useTent: boolean;
  /** useTent 时必填：帐篷稳定 ID（TentId） */
  tentId?: TentId;
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
  /**
   * 相对玩家当前位置的行偏移（-1 / 0 / +1）。
   * UI 必须用 (dr, dc) 决定卡片在 3×3 局部格中的位置——
   * 不能用数组顺序：地图边缘裁剪掉越界格后，按顺序排列会让卡片"自动补位"，
   * 导致视觉方向与真实地图方向不一致（真人试玩已确认的问题）。
   */
  dr: number;
  /** 相对玩家当前位置的列偏移（-1 / 0 / +1） */
  dc: number;
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
  | 'DROP_GEMS'
  /* ---- v0.2.0 Outcome Lab ---- */
  /** 深层采矿：一次性富矿机会（Family G） */
  | 'SURGE_MINE'
  /** 侦察前方：消耗指南针换取返程情报（Family E compass 档） */
  | 'SCOUT'
  /** 村庄服务：花钱恢复耐力 / 买情报 / 卖货减负（Family F） */
  | 'VILLAGE_SERVICE'
  /** 应急补救：花钱求援（Family H） */
  | 'EMERGENCY_RESCUE'
  | 'WAIT';

export interface GameAction {
  type: GameActionType;
  /** BUY 时指定物品 */
  item?: 'tent' | 'compass';
  /**
   * WAIT / REST 在需要帐篷的地点（野外/矿区/绿洲）必须指明使用哪一顶。
   * v0.1.2b：传帐篷稳定 ID（TentId），不再使用 array index。
   */
  tentId?: TentId;
  /** DROP_GEMS：本次丢弃的宝石 kg（缺省 = 机制的 dropStepKg） */
  dropKg?: number;
  /** VILLAGE_SERVICE：服务类型 */
  service?: 'REST' | 'INTEL' | 'SELL';
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
  /* ---- v0.2.0 Outcome 结算拆分（§5/§46/§47） ---- */
  /**
   * 远征结果（生存维度）：
   *   'FAILED'            —— 未成功返回城市
   *   'SURVIVED'          —— 成功返城（不等于赚钱）
   */
  expeditionOutcome: 'FAILED' | 'SURVIVED';
  /**
   * 经济结果（独立于生存维度）：
   *   'PROFITABLE'  —— netProfit > 0
   *   'BREAK_EVEN'  —— netProfit === 0
   *   'UNPROFITABLE'—— netProfit < 0
   * 失败局的宝石无法出售，因此经济结果必然是 UNPROFITABLE。
   */
  economicOutcome: 'PROFITABLE' | 'BREAK_EVEN' | 'UNPROFITABLE';
  /** 初始资金（固定 2000；§39 盈利判定基准） */
  initialCash: number;
  /** 结算页副标题（§47 建议文案，集中在此便于 UI 与测试共用） */
  verdictHeadline: string;
  verdictDetail: string;
  /* ---- v0.2.0 新机制结算遥测 ---- */
  villageServiceSpent: number;
  villageServicesUsed: number;
  villageStaminaRecovered: number;
  surgeMiningUses: number;
  surgeMiningExtraKg: number;
  emergencyRescues: number;
  emergencyRescueCost: number;
  returnIntelTiles: number;
}

/* ------------------------------------------------------------------ */
/* 全局状态                                                             */
/* ------------------------------------------------------------------ */

export interface GameStats {
  /** 购买的天气预报包数量（现金计价：每包扣 forecast.packPrice 元，maxDays 不再变化） */
  forecastPacks: number;
  /** 累计「发放」的预报次数 = 购买包数 × chargesPerPack（专项遥测用） */
  forecastChargesGranted: number;
  /** 累计「消耗」的预报次数（含购买后自动使用的那次与手动使用） */
  forecastChargesUsed: number;
  /** 进入矿区当天的 daysUsed 快照（未进矿为 null） */
  outboundDays: number | null;
  miningDays: number;
  /** 开始返程时的 daysUsed 快照 */
  returnStartDay: number | null;
  /* ---- Autonomous Mechanism Evolution Lab 遥测（机制关闭时恒为 0） ---- */
  /** 主动丢弃的宝石总量（kg） */
  droppedKg: number;
  /** 采矿事故次数 */
  miningAccidents: number;
  /** 采矿事故累计损失的宝石（kg） */
  miningAccidentLostKg: number;
  /** 返程负重惩罚累计额外消耗的天数 */
  loadPenaltyDays: number;
  /* ---- v0.2.0 Outcome & Mechanism Expansion Lab 遥测（机制关闭时恒为 0） ---- */
  /** 村庄服务使用次数（恢复耐力 / 买情报 / 卖货等，按服务档位计次） */
  villageServicesUsed: number;
  /** 村庄服务累计花费（元） */
  villageServiceSpent: number;
  /** 村庄服务累计恢复的耐力点数 */
  villageStaminaRecovered: number;
  /** 在村庄花钱购买返程情报的次数 */
  villageIntelBought: number;
  /** 应变采矿（深层/激进）使用次数 */
  surgeMiningUses: number;
  /** 应变采矿累计额外获得的宝石（kg） */
  surgeMiningExtraKg: number;
  /** 应变采矿累计额外消耗的天数 */
  surgeMiningExtraDays: number;
  /** 紧急补给（花钱保命）使用次数 */
  emergencyRescues: number;
  /** 紧急补给累计花费（元） */
  emergencyRescueCost: number;
  /** 返程情报机制累计揭示的格数 */
  returnIntelTiles: number;
}

export interface GameState {
  seed: string;
  /** mulberry32 内部状态（uint32；v0.1.2 运行期不再消耗随机数，保留字段以防未来扩展） */
  rngState: number;

  map: GameMap;

  daysUsed: number;
  /** 最大旅程天数。现金计价后购买天气预报包不再改变它（见 forecast.maxDaysCost = 0） */
  maxDays: number;
  phase: Phase;
  status: GameStatus;
  defeatReason: DefeatReason | null;

  cash: number;
  stamina: number;
  gemsKg: number;

  /**
   * 帐篷列表：每项含稳定唯一 ID 与剩余沙漠耐久（新帐篷 charges = 3）。
   * 任何消耗都必须由调用方传 TentId 指定，引擎绝不按位置自动选择。
   */
  tents: TentItem[];
  /** 帐篷 ID 序号分配器（递增、不复用，保证 tent-001/tent-002… 唯一） */
  nextTentSerial: number;
  compasses: number;
  equipmentSpent: number;

  /** 剩余天气预报次数（购买 +chargesPerPack，使用 -1，不过期；可带入返程） */
  forecastCharges: number;
  /** 累计花在天气预报包上的现金（专项遥测：与帐篷/指南针支出分开统计） */
  forecastSpent: number;

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
  /**
   * 待展示的结算结果队列（统一 ResultModal）。
   * 与 `log` 同源双写：一次事件发生后既在这里排队弹窗，也已写入历史日志。
   */
  pendingResults: EventResult[];
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
