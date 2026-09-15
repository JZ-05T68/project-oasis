import type {
  ActionInfo,
  ForecastView,
  GameState,
  MineInfo,
  MineSlot,
  Phase,
  TentItem,
  TerrainType,
  TileId,
  WeatherType,
} from '../game/types';
import { gameConfig } from '../game/config/gameConfig';
import { getLegalMoves, getAvailableActions, getCurrentWeather, isTerrainKnown } from '../game';
import { gridNeighbors } from '../game/map/grid';

/**
 * FairView —— Bot 能看到的「玩家视角」信息。
 *
 * 结构性防作弊：Bot 只拿到本视图，拿不到原始 GameState，
 * 因此无法读取：未来天气表、遭遇预生成表、未抵达绿洲的干涸状态、RNG 内部状态。
 * 战争迷雾：未知地形显示为 null（道路拓扑/格子坐标按规则始终可见）。
 */

export interface FairTile {
  id: TileId;
  row: number;
  col: number;
  /** 已知地形；未知（战争迷雾）为 null */
  terrain: TerrainType | null;
  isCity: boolean;
  isMine: boolean;
  /** 仅矿区格：档位与公开固定收购价（开局即知） */
  mineSlot?: MineSlot;
  minePrice?: number;
}

export interface FairMap {
  rows: number;
  cols: number;
  cityId: TileId;
  tiles: Record<TileId, FairTile>;
  /** 两个矿区的完整公开情报（价格/坐标，开局即可见） */
  mines: MineInfo[];
  mineIds: TileId[];
  /** 四方向邻居（含边界裁剪） */
  neighbors(id: TileId): TileId[];
}

export interface FairView {
  seed: string;
  day: number;
  maxDays: number;
  daysRemaining: number;
  phase: Phase;
  position: TileId;
  cash: number;
  stamina: number;
  maxStamina: number;
  /** 帐篷列表（稳定 ID + 剩余耐久） */
  tents: TentItem[];
  compasses: number;
  gemsKg: number;
  forecastCharges: number;
  /** 天气预报包单价（元）——Bot 需要它来判断「值不值得买」，与真人看到的是同一个数 */
  forecastPackPrice: number;
  /** 每包发放的预报次数 */
  forecastChargesPerPack: number;
  /** 购买后自动使用的次数 */
  forecastAutoUseOnPurchase: number;
  /** 本局已购买的预报包数 */
  forecastPacks: number;
  /** 本局累计已花在天气预报上的现金 */
  forecastSpent: number;

  mineEntranceId: TileId | null;
  gemPrice: number | null;
  routeScore: number | null;

  visitedOutbound: TileId[];
  visitedReturn: TileId[];
  explored: TileId[];
  intelKnown: TileId[];
  oasisRestUsed: Record<TileId, boolean>;
  /** 亲自到过的绿洲的干涸状态（未到过的绿洲不含在内） */
  knownOasisDrought: Record<TileId, boolean>;

  map: FairMap;
  /** 当前格今天的天气（身临其境可知） */
  weatherToday: WeatherType;
  /** 最近一次天气预报（若有） */
  lastForecast: ForecastView | null;

  legalMoves: TileId[];
  availableActions: ActionInfo[];
  pendingEvent: GameState['pendingEvents'][0] | null;
}

function buildFairMap(state: GameState): FairMap {
  const tiles: Record<TileId, FairTile> = {};
  for (const id of Object.keys(state.map.tiles)) {
    const t = state.map.tiles[id];
    const known = isTerrainKnown(state, id);
    const isMine = t.terrain === 'MINE';
    const isCity = t.terrain === 'CITY';
    const mine = isMine ? state.map.mines.find((m) => m.tileId === id) : undefined;
    tiles[id] = {
      id,
      row: t.row,
      col: t.col,
      terrain: known ? t.terrain : null,
      isCity,
      isMine,
      mineSlot: isMine ? t.mineSlot : undefined,
      minePrice: mine?.gemPrice,
    };
  }
  return {
    rows: state.map.rows,
    cols: state.map.cols,
    cityId: state.map.cityId,
    tiles,
    mines: state.map.mines,
    mineIds: state.map.mines.map((m) => m.tileId),
    neighbors: (id: TileId) => gridNeighbors(state.map, id),
  };
}

export function buildFairView(state: GameState): FairView {
  const knownOasisDrought: Record<TileId, boolean> = {};
  for (const id of state.explored) {
    if (state.map.tiles[id]?.terrain === 'OASIS') {
      knownOasisDrought[id] = !!state.map.drought[id];
    }
  }
  return {
    seed: state.seed,
    day: state.daysUsed,
    maxDays: state.maxDays,
    daysRemaining: state.maxDays - state.daysUsed,
    phase: state.phase,
    position: state.position,
    cash: state.cash,
    stamina: state.stamina,
    maxStamina: gameConfig.maxStamina,
    tents: state.tents,
    compasses: state.compasses,
    gemsKg: state.gemsKg,
    forecastCharges: state.forecastCharges,
    forecastPackPrice: gameConfig.forecast.packPrice,
    forecastChargesPerPack: gameConfig.forecast.chargesPerPack,
    forecastAutoUseOnPurchase: gameConfig.forecast.autoUseOnPurchase,
    forecastPacks: state.stats.forecastPacks,
    forecastSpent: state.forecastSpent,
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
}
