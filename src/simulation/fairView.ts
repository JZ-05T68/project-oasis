import type {
  ActionInfo,
  ForecastView,
  GameState,
  MineSlot,
  Phase,
  TentItem,
  TerrainType,
  TileId,
  WeatherType,
} from '../game/types';
import { gameConfig } from '../game/config/gameConfig';
import { accidentChanceForMiningDay, desertExtraDaysForLoad, isOverloaded, yieldForMiningDay } from '../game/rules/mining';
import { expectedReturnDays, rescueImmediateCost } from '../game/rules/outcome';
import { getLegalMoves, getAvailableActions, getCurrentWeather, isTerrainKnown } from '../game';
import { gridNeighbors } from '../game/map/grid';

/**
 * FairView —— Bot 能看到的「玩家视角」信息。
 *
 * 结构性防作弊：Bot 只拿到本视图，拿不到原始 GameState，
 * 因此无法读取：未来天气表、遭遇预生成表、未抵达绿洲的干涸状态、RNG 内部状态。
 * 战争迷雾：未知地形显示为 null（道路拓扑/格子坐标按规则始终可见）。
 */

/** 玩家视角的矿区公开信息（不含返城鉴定才揭晓的单价与随机扰动） */
export interface PublicMineInfo {
  tileId: TileId;
  slot: MineSlot;
  /** 客观难度分：由「最短合法往返方案」决定，玩家站在地图前可以自己估出来 */
  difficultyScore: number;
}

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
  /**
   * 玩家视角的矿区信息（v0.3.0 起**只含公开部分**）。
   * 真实单价 `gemPrice` 与随机扰动 `detail.jitter` 不在这里 —— 见下方 buildFairMap 说明。
   */
  mines: PublicMineInfo[];
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

  /**
   * 机制公开参数（Bot 与真人看到的是同一份规则说明，不含任何隐藏信息）。
   * 定义见 gameConfig.mechanisms —— 默认全部 enabled = false。
   */
  rules: {
    /** 下一个采矿日的产量（kg）——「边际收益」的公开来源 */
    nextMiningYield: number;
    /** 下一个采矿日发生事故的概率（0 = 机制关闭） */
    nextMiningAccidentChance: number;
    /** 本局已经挖了多少天（1-based 的下一天 = miningDays + 1） */
    miningDays: number;
    diminishingYield: { enabled: boolean; mode: 'tier' | 'smooth' };
    mineProductivity: { enabled: boolean; reveal: 'start' | 'arrival' };
    accidentRisk: {
      enabled: boolean;
      /** 事故会吃掉当日产量的这个比例 */
      yieldLossFraction: number;
      /** 事故会额外消耗的天数 */
      extraDays: number;
      /** 事故会吃掉已携带宝石的这个比例 */
      cargoLossFraction: number;
    };
    loadReturn: {
      enabled: boolean;
      thresholdKg: number;
      stepKg: number;
      maxExtraPerDesertTile: number;
      allowDrop: boolean;
      dropStepKg: number;
      /** 当前载重下，穿越 1 格沙漠的额外天数（0 = 不受影响） */
      extraDaysPerDesertTile: number;
      /** 当前是否已经超过载重阈值 */
      overloaded: boolean;
      /** 抵达矿区时的勘察半径（0 = 关闭） */
      surveyRadius: number;
    };
    /* ---- v0.2.0 Outcome Lab：四个新机制族的公开规则 ---- */
    returnIntel: {
      enabled: boolean;
      mode: 'survey1' | 'returnCone' | 'compass';
      coneCandidates: number;
      scoutRadius: number;
      compassCostPerScout: number;
    };
    villageService: {
      enabled: boolean;
      restCostPerStamina: number;
      intelPrice: number;
      intelTiles: number;
      sellEnabled: boolean;
      sellPriceRatio: number;
      sellStepKg: number;
    };
    surgeMining: {
      enabled: boolean;
      oncePerRun: boolean;
      yieldMultiplier: number;
      extraDays: number;
      /** 本局是否已经用掉这次机会 */
      used: boolean;
    };
    emergencyRescue: {
      enabled: boolean;
      cost: number;
      extraDays: number;
      staminaBack: number;
      triggerMarginDays: number;
      used: number;
      maxUses: number;
      /** 基于公开信息的返程天数估计 */
      expectedReturnDays: number;
    };
    /* ---- v0.3.0 Economic Independence Lab：经济结算机制的公开规则 ---- */
    /** Family A 延期求援：当场付多少 + 回城结账付多少 */
    rescueSettlement: {
      enabled: boolean;
      immediateCost: number;
      deferredDebt: number;
      revenueShare: number;
      minFee: number;
      debtCap: number;
    };
    /** Family B 远征运营成本 */
    upkeep: {
      enabled: boolean;
      mode: 'perDay' | 'overtime' | 'miningDay';
      costPerDay: number;
      freeDays: number;
      overtimeCostPerDay: number;
      /** 按「当前已用天数」计的累计运营成本（Bot 与真人都能自己算出来的公开量） */
      accruedCost: number;
      /** 再多花 1 天的边际运营成本（overtime 模式下未超期时为 0） */
      marginalPerDay: number;
    };
    /** Family C 运输 / 佣金 / 鉴定费 */
    tradeCost: {
      enabled: boolean;
      transportPerKg: number;
      commissionRate: number;
      fixedAppraisalFee: number;
    };
    /** Family AI-2 逾期折价 */
    lateSale: {
      enabled: boolean;
      /** 第几天开始算逾期（daysUsed > deadlineDay 即折价） */
      deadlineDay: number;
      discount: number;
    };
    /**
     * 城里的**行情参考价**（元/kg）。
     *
     * v0.3.0 新增：既然规则规定「精确单价返城鉴定才公布」，玩家就不可能精确计算货值；
     * 但要做任何经济决策（本轮尤其是"这批货值不值这笔救援债"），
     * 玩家至少需要一个大致行情 —— 这就是城里打听得到的均价（取公开价格区间的中点）。
     * 它**不是**任何矿区的真实单价，真实单价在区间内上下浮动约 ±40%，
     * 这个不确定性被刻意保留：正因为估不准，"赌一把叫了救援结果鉴定价很低"才会
     * 真实地产生"活着回来却亏了"的结局。
     */
    marketReferencePrice: number;
    /** 当前是否位于村庄（村庄服务可用） */
    villageHere: boolean;
  };

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

/**
 * v0.3.0 运营成本：按「当前已用天数」计的累计成本。
 * 与结算函数 `operatingCost()` 共用同一份公式，只是这里用当前 daysUsed（中途视角）。
 */
function accruedUpkeep(state: GameState): number {
  const cfg = gameConfig.mechanisms.upkeep;
  if (!cfg.enabled) return 0;
  if (cfg.mode === 'perDay') return Math.round(state.daysUsed * cfg.costPerDay);
  if (cfg.mode === 'miningDay') return Math.round(state.stats.miningDays * cfg.costPerDay);
  return Math.round(Math.max(0, state.daysUsed - cfg.freeDays) * cfg.overtimeCostPerDay);
}

/** 再多花 1 天的边际运营成本（overtime 模式下尚未超期时为 0） */
function marginalUpkeepPerDay(state: GameState): number {
  const cfg = gameConfig.mechanisms.upkeep;
  if (!cfg.enabled) return 0;
  if (cfg.mode === 'perDay') return cfg.costPerDay;
  if (cfg.mode === 'miningDay') return state.phase === 'MINING' ? cfg.costPerDay : 0;
  return state.daysUsed + 1 > cfg.freeDays ? cfg.overtimeCostPerDay : 0;
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
      /**
       * v0.3.0 装置修复（§34 H10）：**不再暴露 `minePrice`**。
       * 规则页 §十一 明确写着「游戏全程不显示矿区精确单价，返城后才鉴定」，
       * 但这里原先把**所有矿区**（包括从未去过的那座）的真实单价都放进了 FairView，
       * 于是此前所有 Bot 都在"全知价格"下做决策 —— 这是一个真实的隐藏价格泄漏，
       * 会让任何依赖"货值判断"的经济机制（本轮的延期求援正是如此）结论失真。
       */
      minePrice: undefined,
    };
    void mine;
  }
  return {
    rows: state.map.rows,
    cols: state.map.cols,
    cityId: state.map.cityId,
    tiles,
    /**
     * 公开矿区信息只保留"玩家站在地图前就能看到的"部分：位置、槽位与客观难度分。
     * `gemPrice` / `detail.jitter` 属于返城鉴定才揭晓的信息，一律不进 FairView。
     */
    mines: state.map.mines.map((m) => ({
      tileId: m.tileId,
      slot: m.slot,
      difficultyScore: m.difficultyScore,
    })),
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
    rules: {
      nextMiningYield: yieldForMiningDay(
        state.stats.miningDays + 1,
        state.mineEntranceId ? state.map.tiles[state.mineEntranceId]?.mineSlot : undefined,
      ),
      nextMiningAccidentChance: accidentChanceForMiningDay(state.stats.miningDays + 1),
      miningDays: state.stats.miningDays,
      diminishingYield: {
        enabled: gameConfig.mechanisms.diminishingYield.enabled,
        mode: gameConfig.mechanisms.diminishingYield.mode,
      },
      mineProductivity: {
        enabled: gameConfig.mechanisms.mineProductivity.enabled,
        reveal: gameConfig.mechanisms.mineProductivity.reveal,
      },
      accidentRisk: {
        enabled: gameConfig.mechanisms.accidentRisk.enabled,
        yieldLossFraction: gameConfig.mechanisms.accidentRisk.yieldLossFraction,
        extraDays: gameConfig.mechanisms.accidentRisk.extraDays,
        cargoLossFraction: gameConfig.mechanisms.accidentRisk.cargoLossFraction,
      },
      loadReturn: {
        enabled: gameConfig.mechanisms.loadReturn.enabled,
        thresholdKg: gameConfig.mechanisms.loadReturn.thresholdKg,
        stepKg: gameConfig.mechanisms.loadReturn.stepKg,
        maxExtraPerDesertTile: gameConfig.mechanisms.loadReturn.maxExtraPerDesertTile,
        allowDrop: gameConfig.mechanisms.loadReturn.allowDrop,
        dropStepKg: gameConfig.mechanisms.loadReturn.dropStepKg,
        extraDaysPerDesertTile: desertExtraDaysForLoad(state.gemsKg),
        overloaded: isOverloaded(state.gemsKg),
        surveyRadius: gameConfig.mechanisms.loadReturn.surveyRadius,
      },
      /* ---- v0.2.0 Outcome Lab：四个新机制族的公开规则 ---- */
      returnIntel: {
        enabled: gameConfig.mechanisms.returnIntel.enabled,
        mode: gameConfig.mechanisms.returnIntel.mode,
        coneCandidates: gameConfig.mechanisms.returnIntel.coneCandidates,
        scoutRadius: gameConfig.mechanisms.returnIntel.scoutRadius,
        compassCostPerScout: gameConfig.mechanisms.returnIntel.compassCostPerScout,
      },
      villageService: {
        enabled: gameConfig.mechanisms.villageService.enabled,
        restCostPerStamina: gameConfig.mechanisms.villageService.restCostPerStamina,
        intelPrice: gameConfig.mechanisms.villageService.intelPrice,
        intelTiles: gameConfig.mechanisms.villageService.intelTiles,
        sellEnabled: gameConfig.mechanisms.villageService.sellEnabled,
        sellPriceRatio: gameConfig.mechanisms.villageService.sellPriceRatio,
        sellStepKg: gameConfig.mechanisms.villageService.sellStepKg,
      },
      surgeMining: {
        enabled: gameConfig.mechanisms.surgeMining.enabled,
        oncePerRun: gameConfig.mechanisms.surgeMining.oncePerRun,
        yieldMultiplier: gameConfig.mechanisms.surgeMining.yieldMultiplier,
        extraDays: gameConfig.mechanisms.surgeMining.extraDays,
        used: state.stats.surgeMiningUses > 0,
      },
      emergencyRescue: {
        enabled: gameConfig.mechanisms.emergencyRescue.enabled,
        /** v0.3.0：延期求援开启时，这里的 cost = 当场应付现金（可为 0） */
        cost: rescueImmediateCost(),
        extraDays: gameConfig.mechanisms.emergencyRescue.extraDays,
        staminaBack: gameConfig.mechanisms.emergencyRescue.staminaBack,
        triggerMarginDays: gameConfig.mechanisms.emergencyRescue.triggerMarginDays,
        used: state.stats.emergencyRescues,
        maxUses: gameConfig.mechanisms.emergencyRescue.maxUses,
        /** 基于公开信息的返程天数估计（Bot 与真人用同一个数） */
        expectedReturnDays: expectedReturnDays(state),
      },
      rescueSettlement: {
        enabled: gameConfig.mechanisms.rescueSettlement.enabled,
        immediateCost: gameConfig.mechanisms.rescueSettlement.enabled
          ? Math.round(gameConfig.mechanisms.rescueSettlement.immediateCost)
          : 0,
        deferredDebt: Math.round(gameConfig.mechanisms.rescueSettlement.deferredDebt),
        revenueShare: gameConfig.mechanisms.rescueSettlement.revenueShare,
        minFee: Math.round(gameConfig.mechanisms.rescueSettlement.minFee),
        debtCap: Math.round(gameConfig.mechanisms.rescueSettlement.debtCap),
      },
      upkeep: {
        enabled: gameConfig.mechanisms.upkeep.enabled,
        mode: gameConfig.mechanisms.upkeep.mode,
        costPerDay: gameConfig.mechanisms.upkeep.costPerDay,
        freeDays: gameConfig.mechanisms.upkeep.freeDays,
        overtimeCostPerDay: gameConfig.mechanisms.upkeep.overtimeCostPerDay,
        accruedCost: accruedUpkeep(state),
        marginalPerDay: marginalUpkeepPerDay(state),
      },
      tradeCost: {
        enabled: gameConfig.mechanisms.tradeCost.enabled,
        transportPerKg: gameConfig.mechanisms.tradeCost.transportPerKg,
        commissionRate: gameConfig.mechanisms.tradeCost.commissionRate,
        fixedAppraisalFee: Math.round(gameConfig.mechanisms.tradeCost.fixedAppraisalFee),
      },
      lateSale: {
        enabled: gameConfig.mechanisms.lateSale.enabled,
        deadlineDay: state.maxDays - gameConfig.mechanisms.lateSale.graceDays,
        discount: gameConfig.mechanisms.lateSale.discount,
      },
      marketReferencePrice: Math.round(
        (gameConfig.mineValuation.clampMin + gameConfig.mineValuation.clampMax) / 2,
      ),
      /** 村庄服务当前是否可用（由引擎的 ActionInfo 驱动，Bot 不必自己推断） */
      villageHere: state.map.tiles[state.position]?.terrain === 'VILLAGE',
    },
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
