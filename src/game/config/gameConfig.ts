/**
 * Project Oasis 全部可调数值配置。
 * 平衡调整只改这里（并同步 docs/GAME_DESIGN.md），不允许散落硬编码。
 */

export const gameConfig = {
  /* ---------- 时间 ---------- */
  maxDays: 42,

  /* ---------- 地图（v0.1.2 随机远征） ---------- */
  map: {
    /** 地图尺寸属于游戏基础规则（本轮固定 10×12，不可按局随机） */
    rows: 10,
    cols: 12,
    /** 两个矿区的最小行距 */
    mineMinRowGap: 4,
    /** 地图合法性重试上限（确定性重试 seed#mapRetryN） */
    maxRetries: 200,
  },

  /* ---------- 资源 ---------- */
  startCash: 2000,
  startStamina: 5,
  maxStamina: 5,
  /** 每挖 1 天获得宝石 kg */
  gemPerMiningDay: 2,

  /* ---------- 装备价格 ---------- */
  tentPrice: 400,
  tentDesertCharges: 3,
  compassPrice: 100,
  /** 商队二手帐篷价格与耐久 */
  caravanTentPrice: 300,
  caravanTentCharges: 3,
  /** 繁荣市集折扣价 */
  marketDiscountTentPrice: 320,
  marketDiscountCompassPrice: 80,
  /** 盗贼偷窃上限 */
  thiefStealMax: 300,
  /** 市集打工收益 */
  workPay: 500,

  /* ---------- 普通格地形概率（v0.1.2a：4:3:2:1，完全独立随机，与位置/路线无关） ---------- */
  terrainProbability: {
    GRASS: 0.4,
    DESERT: 0.3,
    VILLAGE: 0.2,
    OASIS: 0.1,
  } as Record<string, number>,

  /* ---------- 天气概率（按地形，未列出者视为晴） ---------- */
  weatherProbability: {
    DESERT: { SUNNY: 0.32, HEAT: 0.3, SANDSTORM: 0.38 },
    GRASS: { SUNNY: 0.44, RAINSTORM: 0.28, MUD: 0.28 },
    VILLAGE: { SUNNY: 0.7, CLOUDY: 0.3 },
    OASIS: { SUNNY: 0.7, CLOUDY: 0.3 },
    CITY: { SUNNY: 1 },
    MINE: { SUNNY: 1 },
  } as Record<string, Record<string, number>>,

  /* ---------- 天气效果 ---------- */
  heatStaminaCost: 1,
  sandstormStaminaCost: 1,
  rainstormStaminaCost: 1,

  /* ---------- 遭遇（v0.1.2a：按格预生成，基础概率 35%） ---------- */
  encounter: {
    /** 每个普通格存在遭遇的基础概率 */
    baseProbability: 0.35,
    /** 村庄遭遇中盗贼的比例（其余为繁荣市集） */
    villageThiefRatio: 0.5,
  },

  /** 绿洲干涸概率 */
  oasisDroughtChance: 0.2,

  /** 情报揭示：当前格曼哈顿距离 ≤N 的未知普通格 */
  intelRevealRadius: 2,

  /* ---------- 天气预报（v0.1.2：单日局部 + 可储存次数） ---------- */
  forecast: {
    /** 每包获得的次数 */
    chargesPerPack: 3,
    /** 购买后立即自动使用次数 */
    autoUseOnPurchase: 1,
    /** 邻域半径（8 邻域固定为 1 圈） */
    neighborhoodRadius: 1,
  },

  /* ---------- 矿区价值评估（v0.1.2a：价格基准 = 最短合法往返方案的客观危险程度） ---------- */
  mineValuation: {
    base: 10,
    scale: 2.0,
    clampMin: 80,
    clampMax: 320,
    /** 风险权重化下限（Dijkstra/SSP 权重用正值化风险） */
    riskFloor: 0.5,
    riskCeil: 10,
    /** 随机价值扰动（宝石质量/市场行情/矿脉差异） */
    jitterMin: 0.9,
    jitterMax: 1.1,
  },

  /** 星级阈值（score ≥ 阈值升级）：★★ / ★★★ / ★★★★ / ★★★★★ */
  starThresholds: [12, 40, 85, 115],

  /* ---------- 路线风险评分（仅供统计，不影响售价） ---------- */
  tileRisk: {
    DESERT: 4.5,
    GRASS: 7.0,
    VILLAGE: -3.5,
    OASIS: -2.5,
    CITY: 0,
    MINE: 0,
  } as Record<string, number>,

  /** 时间冗余：低于该天数开始惩罚 */
  slackComfortDays: 12,
  /** 每缺 1 天冗余的惩罚 */
  slackPenaltyPerDay: 1.5,

  /** 返程路径数量稀缺惩罚（1 / 2 / 3 / ≥4 条） */
  scarcityPenaltyByPathCount: [10, 6, 3, 0],
  /** 返程路径枚举上限（风险评分用） */
  returnPathSearchLimit: 8,

  /* ---------- 日志 ---------- */
  logLimit: 120,
} as const;

export type GameConfig = typeof gameConfig;
