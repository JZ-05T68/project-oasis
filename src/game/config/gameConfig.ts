/**
 * Project Oasis 全部可调数值配置。
 * 平衡调整只改这里（并同步 docs/GAME_DESIGN.md），不允许散落硬编码。
 */

export const gameConfig = {
  /* ---------- 时间 ---------- */
  maxDays: 42,

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

  /* ---------- 天气概率（按地形，未列出者视为晴） ---------- */
  weatherProbability: {
    DESERT: { SUNNY: 0.42, HEAT: 0.28, SANDSTORM: 0.3 },
    GRASS: { SUNNY: 0.62, RAINSTORM: 0.19, MUD: 0.19 },
    VILLAGE: { SUNNY: 0.7, CLOUDY: 0.3 },
    OASIS: { SUNNY: 0.7, CLOUDY: 0.3 },
    CITY: { SUNNY: 1 },
    MINE: { SUNNY: 1 },
  } as Record<string, Record<string, number>>,

  /* ---------- 天气效果 ---------- */
  heatStaminaCost: 1,
  sandstormStaminaCost: 1,
  rainstormStaminaCost: 1,

  /* ---------- 遭遇概率 ---------- */
  encounterProbability: {
    DESERT: { CARAVAN: 0.22 },
    VILLAGE: { THIEF: 0.3, MARKET: 0.25 },
    GRASS: { HERDSMAN: 0.25 },
    OASIS: {},
    CITY: {},
    MINE: {},
  } as Record<string, Record<string, number>>,

  /** 绿洲干涸概率 */
  oasisDroughtChance: 0.2,

  /** 情报揭示：当前节点路网距离 ≤N 的未知普通格 */
  intelRevealRadius: 3,

  /* ---------- 天气预报 ---------- */
  forecastLookaheadDays: 3,

  /* ---------- 路线难度评分 ---------- */
  /**
   * 地形风险系数：草地单格风险高于沙漠——
   * 暴雨整顶吃帐篷（400 元级损失）、泥沼吃时间，属于「高代价突发风险」；
   * 沙漠属于可用帐篷/指南针逐次抵挡的「持续型资源消耗风险」。
   */
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
  /** 返程路径枚举上限（达到即视为「很多」） */
  returnPathSearchLimit: 8,

  /* ---------- 宝石定价 ---------- */
  priceBase: 80,
  priceMultiplier: 1.9,
  priceMin: 80,
  priceMax: 320,
  /** 市场波动系数范围（Seed 决定，进入矿区时抽取） */
  marketFactorMin: 0.95,
  marketFactorMax: 1.05,

  /** 星级阈值（score ≥ 阈值升级）：★★ / ★★★ / ★★★★ / ★★★★★ */
  starThresholds: [12, 40, 85, 115],

  /* ---------- 日志 ---------- */
  logLimit: 120,
} as const;

export type GameConfig = typeof gameConfig;
