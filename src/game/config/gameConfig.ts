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
  /**
   * v0.1.1 平衡调参（BALANCE_LOG #1）：
   * 基线（晴 0.42/0.28/0.30 沙、0.62/0.19/0.19 草）下 42 天预算过于宽裕，
   * 北矿胜率 97.4% 与南矿 100% 几乎无差而 EV 高 2.2 倍，装备购买 EV 为负。
   * 提高恶劣天气频率，让长路线真实消耗装备与耐力（草地仍是「低频但高代价」：约 1/3.6 格触发）。
   */
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

  /* ---------- 宝石定价（v0.1.1：按矿区入口固定） ---------- */
  /**
   * 三个矿区入口的固定收购价（元/kg）。
   * 价格只由玩家首次进入的矿区入口决定，进入即锁定；
   * 与去程地形、路线风险评分、实际受伤、天气、事件、路线长度一概无关。
   *
   * v0.1.1 平衡调参（BALANCE_LOG #2）：初始 100/180/280 在两轮 10k 仿真中
   * 形成北矿支配（EV 为南矿 2.0~2.2 倍而胜率仅差 3~11pp），价格扫描后调整为 100/160/240。
   */
  mineBasePrice: { SOUTH: 100, CENTRAL: 160, NORTH: 240 } as Record<string, number>,
  /**
   * 市场随机波动系数（0.95~1.05）。
   * v0.1.1 默认关闭：gemPrice = mineBasePrice。
   * 机制保留为未来实验功能，开启后成交价 = round(固定价 × marketFactor)。
   */
  marketEnabled: false,
  /** 市场波动系数范围（仅 marketEnabled = true 时使用） */
  marketFactorMin: 0.95,
  marketFactorMax: 1.05,

  /** 星级阈值（score ≥ 阈值升级）：★★ / ★★★ / ★★★★ / ★★★★★ */
  starThresholds: [12, 40, 85, 115],

  /* ---------- 日志 ---------- */
  logLimit: 120,
} as const;

export type GameConfig = typeof gameConfig;
