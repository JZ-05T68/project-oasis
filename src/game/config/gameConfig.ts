/**
 * Project Oasis 全部可调数值配置。
 * 平衡调整只改这里（并同步 docs/GAME_DESIGN.md），不允许散落硬编码。
 */

const baseConfig = {
  /* ---------- 时间 ---------- */
  maxDays: 42,

  /* ---------- 地图（v0.1.2b 真人试玩修正：8×9） ---------- */
  map: {
    /**
     * 地图尺寸属于游戏基础规则（本轮真人试玩测试尺寸 8×9 = 72 格，不可按局随机）。
     * 8×9 是 Human Playtest Fix Round 1 的测试尺寸，不代表永久最终值。
     */
    rows: 8,
    cols: 9,
    /**
     * 矿区禁止出现在地图最下方 N 行（城市固定左下角，避免矿区刷到右下导致远征过短）。
     * rows=8 时：矿区合法行 = 0 ~ 5，禁止行 = 6 / 7。
     */
    mineBottomForbiddenRows: 2,
    /**
     * 两个矿区的最小行距。
     * 8×9 下矿区合法行只有 0~5（6 行），沿用旧地图的 4 会让行 2/3 完全无法出现，
     * 因此按「最小必要调整」降为 3，仍保证两矿区有明显纵向差异。
     */
    mineMinRowGap: 3,
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
  /**
   * 帐篷单价。
   *
   * 过夜平衡实验（2026-09-14~15）结论：400 → **700**。
   * 理由（28k/21k 局仿真）：400 元时「多买帐篷」几乎没有代价——
   * WastefulBot（5 顶帐篷）仍有 97.5% 胜率、EV 排名接近合理玩家；
   * 700 元时过度囤积的 EV 明显低于合理配置（2162 vs 2526），
   * 同时合理玩家胜率从 91.35% 回到 77.33%（目标带 70~90% 中段），
   * 并出现了「轻装＝高 EV 低胜率 / 重装＝稳但收益低」的真实取舍。
   */
  tentPrice: 700,
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

  /* ---------- 天气效果（v0.1.2b：集中管理，真人试玩调参只改这里） ---------- */
  /**
   * 天气数值全部收进这里，禁止把数值散落在引擎/UI 里硬编码。
   * 后续真人试玩如果要调（例如把草地暴雨退回 -1 或再改其它值），只动这一块。
   */
  weather: {
    /** 沙漠高温（HEAT）：硬扛耐力损失 */
    heat: {
      staminaCost: 1,
    },
    /** 沙尘暴（SANDSTORM）：没有帐篷硬扛时的耐力损失 */
    sandstorm: {
      staminaCost: 1,
    },
    /** 草地暴雨（RAINSTORM） */
    grassRain: {
      /**
       * 不使用帐篷硬扛暴雨：耐力损失。
       *
       * Human Playtest Fix Round 1 暂定试玩值 = 2（原值 1）。
       * 这是「本轮试玩参数」，不代表最终永久数值：
       * 下一轮真人试玩可能保持 -2、改回 -1，或再作其他调整——改这个字段即可。
       */
      staminaLossWithoutTent: 2,
      /** 使用帐篷避雨：无论剩余耐久（3/3、2/3、1/3）整顶立即报废；耐力不减少 */
      destroysTentOnUse: true,
    },
  },

  /* ---------- 遭遇（v0.1.2a：按格预生成） ---------- */
  encounter: {
    /**
     * 每个普通格存在遭遇的基础概率。
     *
     * 过夜平衡实验（2026-09-14~15）结论：0.35 → **0.25**。
     * 理由：0.35 时「至少触发一次遭遇」的局占比达 96.8%（>95%，遭遇不再是意外而是必然）；
     * 降到 0.25 后触发率回到区间内，且对胜率/经济几乎无副作用
     * （本参数是本轮 8 个单变量里最敏感的一个，Δscore +3.38）。
     * 注意：0.20 / 0.25 / 0.28 / 0.30 四档在 score 上已进入平台期（±0.02），
     * 选 0.25 是为了留出余量，不取刚好贴线的 0.30。
     */
    baseProbability: 0.25,
    /** 村庄遭遇中盗贼的比例（其余为繁荣市集） */
    villageThiefRatio: 0.5,
  },

  /** 绿洲干涸概率 */
  oasisDroughtChance: 0.2,

  /** 情报揭示：当前格曼哈顿距离 ≤N 的未知普通格 */
  intelRevealRadius: 2,

  /* ---------- 天气预报（v0.1.2：单日局部 + 可储存次数） ---------- */
  forecast: {
    /**
     * 每包获得的次数（成本仍然是「最大旅程天数 −1」，机制不变）。
     *
     * 过夜平衡实验（2026-09-14~15）结论：3 → **5**。
     * 理由：3 次/包时天气预报是净负收益——ForecastBot 平均买 5.7 包，
     * EV 比同配置不买预报的对照 Bot 低约 1025 元；提到 5 次/包后差距收窄到 866 元（−16%）。
     * 这属于「已有数值」，不是机制改动：计价方式（1 maxDays/包）、只预报自然天气、单日局部都不变。
     */
    chargesPerPack: 5,
    /** 购买后立即自动使用次数 */
    autoUseOnPurchase: 1,
    /** 邻域半径（8 邻域固定为 1 圈） */
    neighborhoodRadius: 1,
  },

  /* ---------- 矿区价值评估（v0.1.2a：价格基准 = 最短合法往返方案的客观危险程度） ---------- */
  /**
   * v0.1.2b 经济重新标定（Human Playtest Fix Round 1）。
   *
   * 计价规则（拍板不变）：单价基数**只**由该矿区「最短合法往返方案」的客观危险程度决定，
   * 与玩家实际路线/受伤/装备消耗完全无关；叠加小幅 jitter 后夹在区间内，返城鉴定才公布。
   *
   * 为什么要重标定：8×9 新地图把客观难度分整体压缩了
   * （10×12 时为 ~120~230；现在往返 20~30 天 ⇒ 难度分 p10/中位/p90 = 16/40.5/63.5）。
   * 沿用旧的 base=10 / clampMin=80 会让 **39.5%** 的矿区被钉在价格下限 80 元/kg，
   * 平均单价只有 100 元/kg，合理成功远征因此经常无法覆盖装备支出。
   *
   * 标定做法（不是机械上调，也不是全局保底）：
   *  - 保留原有斜率 scale=2.0（每 1 点客观难度 = 2 元/kg），矿区之间的相对差异不变；
   *  - 把截距从 10 重新锚定到 140（= 新区间的下限），使难度分 0 兑 140 元/kg；
   *  - 下限 80 → 140，上限 320 **保持不变**（不因小地图抬高上限）。
   * 结果：难度 p10/中位/p90 → 172 / 221 / 267 元/kg，触底 1.75%、触顶 0.21%；
   * 3000 局标定中合理玩家成功局盈利占比 99.96%、p10 净收益 +2018 元，
   * 而「只挖 1 天」「不买装备」「乱囤装备」等玩法依旧会亏损。
   */
  mineValuation: {
    base: 140,
    scale: 2.0,
    clampMin: 140,
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

export type GameConfig = typeof baseConfig;

/* ------------------------------------------------------------------ */
/* 实验期配置覆盖（仅用于 Balance Simulation / 自动实验）                */
/* ------------------------------------------------------------------ */
/**
 * 设计目的：无人值守平衡实验需要在不改源码、不改机制的前提下批量试参数。
 * 覆盖只在环境变量 OASIS_CONFIG_OVERRIDE 存在时生效，生产/浏览器构建不受影响。
 *
 * 值可以是：
 *  - 一个 JSON 字符串（例如 {"startCash":1800}）
 *  - 一个 JSON 文件路径（以 .json 结尾）
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out as T;
}

function readOverride(): unknown {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const raw = g.process?.env?.OASIS_CONFIG_OVERRIDE;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const override = readOverride();

export const gameConfig: GameConfig = override
  ? deepMerge(baseConfig as unknown as Record<string, unknown>, override) as unknown as GameConfig
  : (baseConfig as unknown as GameConfig);

/**
 * 把一段覆盖 patch 合并到基线配置上，返回合并后的快照。
 * 供实验驱动把「本次实验真正生效的配置」写进报告（驱动器自身进程不设 env 覆盖）。
 */
export function mergeWithOverride(patch: unknown): GameConfig {
  return deepMerge(baseConfig as unknown as Record<string, unknown>, patch) as unknown as GameConfig;
}

/** 当前生效覆盖（实验日志用；无覆盖时为 null） */
export const activeConfigOverride: Record<string, unknown> | null =
  isPlainObject(override) ? override : null;

/** 原始基线配置（回滚/对比用） */
export const baselineConfig: GameConfig = baseConfig as unknown as GameConfig;
