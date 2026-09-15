/**
 * Project Oasis 全部可调数值配置。
 * 平衡调整只改这里（并同步 docs/GAME_DESIGN.md），不允许散落硬编码。
 */

/* ------------------------------------------------------------------ */
/* 候选机制开关（Autonomous Mechanism Evolution Lab）                    */
/* ------------------------------------------------------------------ */
/**
 * 设计约束：
 *  - **默认全部 enabled = false**，因此正式游戏行为与落盘前完全一致；
 *  - 只有 `OASIS_CONFIG_OVERRIDE` 把某个机制打开时，引擎才会走新分支；
 *  - 通过 Promotion Gate 的机制，把这里的默认值改成 true 即完成「正式落盘」，
 *    回滚只需改回 false。
 *
 * 显式声明接口（而不是直接写进 `as const` 字面量）的原因：
 * `as const` 会把 `false` 收窄成字面量类型 `false`，导致 `cfg.enabled` 的
 * 真值分支在 TS 里变成 never，无法编写实验分支。
 */
export interface DiminishingYieldConfig {
  enabled: boolean;
  /** tier = 分段常数产量；smooth = 每多挖一天按 decay 递减 */
  mode: 'tier' | 'smooth';
  /** tier 模式：各段产量（kg/天） */
  tierYields: number[];
  /** tier 模式：第 n 段从「第几个采矿日」开始（1-based，长度 = tierYields.length - 1） */
  tierStarts: number[];
  /** smooth 模式：第 1 天产量 */
  smoothBase: number;
  /** smooth 模式：每天乘以的衰减系数 */
  smoothDecay: number;
  /** smooth 模式：产量下限（kg/天，不再继续跌） */
  smoothFloor: number;
}

export interface AccidentRiskConfig {
  enabled: boolean;
  /** 第 n 个采矿日的事故概率 = min(cap, base + (n-1) × growth) */
  baseChance: number;
  growthPerDay: number;
  capChance: number;
  /** 事故损失：当日产量的损失比例（0~1） */
  yieldLossFraction: number;
  /** 事故损失：强制额外消耗的天数 */
  extraDays: number;
  /** 事故损失：已携带宝石的损失比例（0 = 只损当日产量） */
  cargoLossFraction: number;
}

export interface LoadReturnConfig {
  enabled: boolean;
  /** 触发返程负担的载重阈值（kg）：低于它完全不受影响 */
  thresholdKg: number;
  /** 超过阈值后，每多背 stepKg，穿越沙漠每格再 +1 天 */
  stepKg: number;
  /** 单格沙漠额外天数的上限（防止小地图被彻底压死） */
  maxExtraPerDesertTile: number;
  /** 是否允许玩家主动丢弃宝石减负 */
  allowDrop: boolean;
  /** 单次丢弃的 kg 粒度（UI 按钮与 Bot 动作共用） */
  dropStepKg: number;
  /**
   * 抵达矿区时的「勘察半径」（曼哈顿距离，0 = 关闭）。
   *
   * 存在的唯一理由：**返程路线选择在信息上是不成立的**——
   * 返程规定不得重走去程普通格，而这些格恰恰是玩家唯一探索过的格，
   * 于是返程每一步都必然踏进战争迷雾，任何"按地形选路"的机制都无法影响决策
   * （实测所有地形依赖型机制的 Δroute 恒为 0%）。
   * 勘察半径给玩家一小段**有信息**的返程起手空间，让路线取舍第一次成为可能。
   */
  surveyRadius: number;
}

export interface MineProductivityConfig {
  enabled: boolean;
  /** Mine A / Mine B 的产量倍率（属于矿本身，与玩家实际路线无关） */
  scaleA: number;
  scaleB: number;
  /** 公开时机：开局公开 / 到矿后才发现 */
  reveal: 'start' | 'arrival';
}

/* ------------------------------------------------------------------ */
/* v0.2.0 Outcome & Mechanism Expansion Lab —— 四个新机制族            */
/* ------------------------------------------------------------------ */

/**
 * Family E —— 返程有限情报（§10/§11）。
 *
 * 要解决的结构问题：返程规定不得重走去程普通格，而已探索格恰好只有去程走过的
 * 那一批 → 返程每一步都踏进迷雾 → 任何「按地形选路」的机制都拿不到信息。
 * 本轮**不**做全图揭露，只给一段刚好够做出第一次路线取舍的有限情报。
 *
 * mode：
 *   'none'      —— 关闭
 *   'survey1'   —— 抵达矿区时揭示矿区周围 1 格（上一轮 M13 的做法）
 *   'returnCone'—— 抵达矿区时揭示「返程方向」2~3 个候选格（朝城市方向的候选）
 *   'compass'   —— 消耗 1 个指南针可执行一次「侦察前方」（返程中主动使用）
 */
export interface ReturnIntelConfig {
  enabled: boolean;
  mode: 'survey1' | 'returnCone' | 'compass';
  /** returnCone：揭示朝城市方向的前 k 个候选格（2~3） */
  coneCandidates: number;
  /** compass：单次侦察揭示的前方曼哈顿半径 */
  scoutRadius: number;
  /** compass：每次侦察需要消耗的指南针数 */
  compassCostPerScout: number;
  /** 是否允许在返程途中再次侦察 */
  allowScoutDuringReturn: boolean;
}

/**
 * Family F —— 村庄服务（§12/§13）。
 *
 * 村庄从「随机遭遇点」升级为**安全与经济交换节点**：花钱/花时间换耐力、
 * 换情报、卖货减负。关键约束是**不能变成必停点**（>85% 遇村必停 = DOMINANT_VILLAGE_ACTION）。
 *
 * 单位定价刻意做成「比自己扛更贵」的补救手段，而不是免费午餐。
 */
export interface VillageServiceConfig {
  enabled: boolean;
  /** 花钱恢复 1 点耐力的单价（元） */
  restCostPerStamina: number;
  /** 单次最多恢复的耐力点数 */
  restMaxStamina: number;
  /** 是否消耗 1 天（若 false 则只花钱不花时间） */
  restCostsDay: boolean;
  /** 购买返程情报的价格（元） */
  intelPrice: number;
  /** 购买情报揭示的格数（返程方向候选） */
  intelTiles: number;
  /** 是否允许在村庄卖出宝石（减负换现金） */
  sellEnabled: boolean;
  /** 卖出价格 = 该矿宝石单价 × 该比例（刻意低于回城鉴定价） */
  sellPriceRatio: number;
  /** 单次卖出的 kg 粒度 */
  sellStepKg: number;
}

/**
 * Family G —— 矿区第二层决策（§14/§15）。
 *
 * 在既有负重机制之上加一层**一次性**的「深层采矿」机会：
 * 单次产量更高，但附带额外天数与非线性代价。
 * 必须一眼可理解——玩家不需要算期望值就能决定拿或不拿。
 */
export interface SurgeMiningConfig {
  enabled: boolean;
  /** 是否仅允许使用一次（一次性富矿机会） */
  oncePerRun: boolean;
  /** 深层采矿的产量倍率（相对当日正常产量） */
  yieldMultiplier: number;
  /** 深层采矿额外消耗的天数 */
  extraDays: number;
  /**
   * 非线性代价：深层采矿会让「当日」额外损失的最大耐力点数
   * （0 = 不碰耐力通道；刻意默认 0，避免与 §23 耐力锁定冲突）
   */
  staminaCost: number;
  /** 深层采矿后是否提高当日事故概率（倍率；1 = 不变） */
  accidentChanceMultiplier: number;
}

/**
 * Family H —— 应急补救（§16/§17）。
 *
 * 让「做错一次」不必然等于死亡：可以在困局中付出很大代价把远征救回来。
 * 目标是**提高 Completion 的同时降低 Profitability**，从而让「成功但亏损」
 * 这一档真实存在（§5 的 SURVIVED_UNPROFIT）。
 *
 * 触发条件刻意做得很窄：只在「剩余时间不足以完成返程」或「耐力见底」时可用。
 */
export interface EmergencyRescueConfig {
  enabled: boolean;
  /** 求援价格（元） */
  cost: number;
  /** 求援买回的额外天数 */
  extraDays: number;
  /** 求援恢复的耐力点数 */
  staminaBack: number;
  /** 触发门槛：剩余天数 − 返程期望天数 < triggerMarginDays 才可使用 */
  triggerMarginDays: number;
  /** 每局最多使用次数 */
  maxUses: number;
  /** 求援是否直接丢弃部分宝石（驮队被腾空换取速度） */
  cargoDroppedKg: number;
}

/* ------------------------------------------------------------------ */
/* v0.3.0 Economic Independence Lab —— 经济结算机制族                   */
/* ------------------------------------------------------------------ */

/**
 * Family A —— 延期结算的紧急求援（本轮 P0）。
 *
 * 上一轮已证明的结构性死结：成功局返城时手里现金中位数只有 ~250 元、
 * 上限 ~550 元，而要把「成功但亏损」做出来需要 ~2550 元量级的经济影响。
 * 因此**即时现金支付这条路在结构上走不通**（再怎么搜 400/450/500/550 都一样）。
 *
 * 延期支付绕开可负担性悬崖：求援当场不收钱，返城结算时从宝石收入里扣。
 * 玩家规则一句话：「驼队可以把你救回去，但报酬等到回城结账时再算。」
 */
export interface RescueSettlementConfig {
  enabled: boolean;
  /** 求援当时的即时现金支出（0 = 完全延期，不再有可负担性悬崖） */
  immediateCost: number;
  /** 返城结算时一次性偿还的固定债务（元） */
  deferredDebt: number;
  /** 返城结算时按宝石销售收入抽成的比例（0~1） */
  revenueShare: number;
  /** 抽成保底：fee = max(minFee, deferredDebt + share × gemRevenue) */
  minFee: number;
  /**
   * 债务上限（0 = 不设上限）。
   * 用于防止「求援后倒欠一大笔」这种玩家无法预期的极端结果。
   */
  debtCap: number;
}

/**
 * Family B —— 远征运营成本（Settlement Upkeep）。
 *
 * 「远征越久，驮队、补给、人员的开销越高，返城时一并结算。」
 * 三种形态：
 *   perDay     —— 每一天都收
 *   overtime   —— 前 freeDays 天免费，之后每天收（优先：更容易产生"拖太久不划算"）
 *   miningDay  —— 只按在矿区驻扎的天数收（直接制造采矿时长取舍）
 */
export interface UpkeepConfig {
  enabled: boolean;
  mode: 'perDay' | 'overtime' | 'miningDay';
  /** perDay / miningDay：每天（或每个采矿日）的开销（元） */
  costPerDay: number;
  /** overtime：免费基础天数 */
  freeDays: number;
  /** overtime：超出免费天数后每天的开销（元） */
  overtimeCostPerDay: number;
  /**
   * 是否只在成功返城后结算。
   * 默认 true：失败局本来就没有宝石收入，再叠加运营费只会让失败更惨，
   * 而本轮的目标是**解耦生存与赚钱**，不是让失败更痛。
   */
  onlyOnSuccess: boolean;
}

/** Family C —— 运输 / 鉴定 / 佣金（本轮定位为 ECONOMIC_CONTROL 对照组） */
export interface TradeCostConfig {
  enabled: boolean;
  /** 按宝石总重量收取的运输费（元/kg）——会制造「是否丢货减负」的取舍 */
  transportPerKg: number;
  /** 宝石销售佣金比例（0~1） */
  commissionRate: number;
  /** 固定鉴定费（元） */
  fixedAppraisalFee: number;
}

/**
 * Family AI-2 —— 逾期折价（AI 自主提出候选）。
 *
 * 「商队只在城门集市收货；超过第 N 天才回城的宝石只能折价卖给贩子。」
 * 它不是统一税：只有**拖得久**的局才被抽，因此直接制造
 * 「再挖一天 vs 赶上集市」的时间取舍，而不动那些干脆利落的局。
 */
export interface LateSaleConfig {
  enabled: boolean;
  /** 从第几天开始算逾期（相对 maxDays 的倒计时：maxDays - graceDays） */
  graceDays: number;
  /** 逾期后的折价率（0.25 = 只卖到原价的 75%） */
  discount: number;
}

export interface MechanismConfig {
  diminishingYield: DiminishingYieldConfig;
  accidentRisk: AccidentRiskConfig;
  loadReturn: LoadReturnConfig;
  mineProductivity: MineProductivityConfig;
  returnIntel: ReturnIntelConfig;
  villageService: VillageServiceConfig;
  surgeMining: SurgeMiningConfig;
  emergencyRescue: EmergencyRescueConfig;
  /* ---- v0.3.0 Economic Independence Lab（默认全关） ---- */
  rescueSettlement: RescueSettlementConfig;
  upkeep: UpkeepConfig;
  tradeCost: TradeCostConfig;
  lateSale: LateSaleConfig;
}

const baseMechanisms: MechanismConfig = {
  /**
   * Candidate Family A — 采矿边际收益递减。
   * 目的：让「再挖一天」的边际收益随停留天数下降。
   *
   * 注意（结构性预判，实验会验证）：在本游戏里"多挖一天"唯一的代价是时间，
   * 而提前返程不产生任何收益，因此**单纯的递减产量预计不会改变任何决策**
   * （任何 y > 0 都仍然值得挖）。递减只有在与"停留代价递增"（accidentRisk /
   * loadReturn）叠加时才会真正把边际分析推向拐点。
   */
  diminishingYield: {
    enabled: false,
    mode: 'tier',
    tierYields: [2.5, 2.0, 1.5],
    tierStarts: [4, 8],
    smoothBase: 2.6,
    smoothDecay: 0.88,
    smoothFloor: 1.1,
  },

  /**
   * Candidate Family C — 随采矿时间上升的独立风险。
   * 目的：给"再挖一天"加上递增的期望损失，使 继续挖 / 现在返程 出现真实拐点。
   * 事故后果刻意**不**走耐力通道（不 −stamina、不直接死亡），而是
   * 「损失部分当日产量 + 强制多留 N 天」；daysUsed 的损失会直接吃掉返程时间余量，
   * 因此它惩罚的是"贪心"而不是"耐力管理"。
   */
  accidentRisk: {
    enabled: false,
    baseChance: 0.05,
    growthPerDay: 0.025,
    capChance: 0.3,
    yieldLossFraction: 0.5,
    extraDays: 1,
    cargoLossFraction: 0,
  },

  /**
   * Candidate Family D（重设计）— 返程负担。
   *
   * 与上一轮被否决的「携带 ≥Xkg，每 5 步 −1 耐力」不同：
   * 旧模型只是"纯加伤害"，不改变任何决策。
   * 新模型改为**改变移动代价结构与路线优劣**：
   *   载重 ≥ 阈值时，返程每进入 1 格沙漠多耗 1 天
   *   → 沙漠不再是最快的路，玩家/ Bot 必须在「短沙路」与「长草路」之间做真实取舍；
   *   → 并且可以主动丢弃宝石减负，形成一个 1 按钮的显式决策。
   */
  loadReturn: {
    /**
     * v0.1.4 正式落盘（Autonomous Mechanism Evolution Lab，Promotion Gate 9/9 通过）。
     *
     * 25,000 局大样本配对结果（相对落盘前基线）：
     *   采矿决策改变率 81.84%（一级指标）；最热采矿模板仅占 46.3%、采矿天数取值 13 种
     *   → 没有支配策略；合理玩家胜率 83.92%（65~90% 健康带内）；
     *   STAMINA_EXHAUSTED 15.28%（不升反降，说明没有把问题推给耐力）；
     *   TIMEOUT 0.08%；EV 保持基线的 89.9%；主动丢货率 38.96%。
     *
     * 参数是被搜索出来的，不是人工指定：Phase A（13 候选 × 20 Bot × 500 局）
     * → Phase B（13 个参数点 × 10 Bot × 800 局）→ Phase C（6 候选 × 10 Bot × 2500 局）。
     * 阈值 24 / 步长 6 / 上限 1 是在「决策改变率 ≥ 15% 且 EV 不低于基线 70%」约束下
     * 同时保住策略多样性的最优点（阈值 28 会让决策改变率掉到 55%，
     * 阈值 16~20 会把 EV 压到 62~69%）。
     */
    enabled: true,
    thresholdKg: 24,
    stepKg: 6,
    maxExtraPerDesertTile: 1,
    allowDrop: true,
    dropStepKg: 4,
    surveyRadius: 0,
  },

  /**
   * Candidate Family B — 矿区生产力差异。
   *
   * 硬性约束（用户指定）：该属性必须属于**矿本身**，不受玩家实际路线影响，
   * 因此它只和 slot（A/B）绑定，与 gemPrice / 「危险路线刷价」原则完全解耦。
   *
   * 结构性预判（实验会验证）：产量倍率是**全局缩放**，任何 >0 的倍率都仍然满足
   * 「多挖一天 = 多一份正收益」，因此预计**不会**改变任何采矿**时长**决策；
   * 它只会改变收益水平与两矿的相对吸引力（即采矿**地点**决策）。
   */
  mineProductivity: {
    enabled: false,
    scaleA: 1.3,
    scaleB: 0.7,
    reveal: 'start',
  },

  /* ---------- v0.2.0 Outcome Lab ---------- */

  /**
   * Family E —— 返程有限情报（v0.2.0 正式落盘，机制 #1）。
   * Phase A：Δdecision 88%、Completion/EV 零扰动（信息≠收益，§8 B）；
   * Phase C（EH1 × 5000 seeds）：Completion 69.98% 命中目标带中心。
   * 落盘参数 = E1 档：returnCone 模式、揭示返程方向 3 个候选格。
   */
  returnIntel: {
    enabled: true,
    mode: 'returnCone',
    coneCandidates: 3,
    scoutRadius: 1,
    compassCostPerScout: 1,
    allowScoutDuringReturn: true,
  },

  /**
   * Family F —— 村庄服务。
   * 定价原则：比自己硬扛更贵，因此它是「补救手段」而不是「必经之路」。
   */
  villageService: {
    enabled: false,
    restCostPerStamina: 150,
    restMaxStamina: 2,
    restCostsDay: true,
    intelPrice: 120,
    intelTiles: 3,
    sellEnabled: true,
    sellPriceRatio: 0.6,
    sellStepKg: 4,
  },

  /**
   * Family G —— 矿区第二层决策（深层采矿）。
   * 默认不碰耐力通道，避免与 §23「机制不得靠提高耐力伤害压胜率」冲突。
   */
  surgeMining: {
    enabled: false,
    oncePerRun: true,
    yieldMultiplier: 3,
    extraDays: 1,
    staminaCost: 0,
    accidentChanceMultiplier: 1,
  },

  /**
   * Family H —— 应急补救（求援）（v0.2.0 正式落盘，机制 #2）。
   * 只在「时间不够」或「耐力见底」时出现，价格刻意高昂
   * → 提高 Completion、压低 Profitability，制造「成功但亏损」结局。
   * Phase A：H1 档 Completion 71.56%（基线 80.00）、EV 1833（基线 2367 的 77%）；
   * Phase C（EH1 × 5000 seeds）：Completion 69.98%。
   * 落盘参数 = H1 档：400 元 / +5 天 / +3 耐力 / 提前 2 天可呼 / 每局 1 次。
   */
  emergencyRescue: {
    enabled: true,
    cost: 400,
    extraDays: 5,
    staminaBack: 3,
    triggerMarginDays: 2,
    maxUses: 1,
    cargoDroppedKg: 0,
  },

  /* ---------- v0.3.0 Economic Independence Lab ---------- */

  /**
   * Family A —— 延期求援。
   * 默认全关（deferredDebt = 0 / revenueShare = 0），因此开启 emergencyRescue 的
   * 现有正式行为完全不变：仍然当场付 400 元。
   * 打开本机制时才改为「当场付 immediateCost（可 0）+ 返城结算时付债务/抽成」。
   */
  /**
   * Family A —— 延期求援（v0.3.0 正式落盘，机制 #1）。
   *
   * 为什么必须改：上一轮「当场付 400 元」撞上**可负担性悬崖**——
   * 成功返城局手上现金中位数只有约 250 元、上限约 550 元，而要把
   * 「成功但亏损」做出来需要 2500 元量级的经济影响。再怎么搜 400/450/500/550 都一样。
   * 延期支付绕开这道悬崖：求援当场不收钱，回城结算时从宝石收入里扣。
   *
   * 落盘参数来源（不是人工指定）：Phase A（16 候选 ×1000）× Phase B（90 参数点 ×800）
   * → Phase C（3 决赛候选 ×25,000 validation）→ Phase D（50,000 holdout）。
   * 债务 2800 元是「既让求援成为一个真实选择（货值不够就该认赔），
   * 又不把它变成常规续命按钮」的取值：债务 1200/2000 时求援使用率 46%/29%，
   * 会把完成率顶到 81~83%（超出 §22 硬约束）；2800 时使用率回落到 2~3%，完成率稳在 69.5%。
   */
  rescueSettlement: {
    enabled: true,
    immediateCost: 0,
    deferredDebt: 2800,
    revenueShare: 0,
    minFee: 0,
    debtCap: 0,
  },

  /**
   * Family B —— 远征运营成本（v0.3.0 正式落盘，机制 #2）。
   *
   * 形态选择依据：perDay（每天都收）在评价函数里被判为**准统一税**——
   * 它对所有成功局一视同仁地搬走利润；overtime（前 22 天免费，之后每天 160 元）
   * 只罚**拖得久**的局，干脆利落的局一分不付，因此既过了 §16 反统一税门禁，
   * 也更像一句人话：「前 22 天商队包干，之后每天自己掏」。
   *
   * 落盘参数：freeDays 22 / overtimeCostPerDay 160。
   */
  upkeep: {
    enabled: true,
    mode: 'overtime',
    costPerDay: 0,
    freeDays: 22,
    overtimeCostPerDay: 160,
    onlyOnSuccess: true,
  },

  /** Family C —— 运输 / 佣金。默认关闭（本轮主要作为 ECONOMIC_CONTROL 对照）。 */
  tradeCost: {
    enabled: false,
    transportPerKg: 0,
    commissionRate: 0,
    fixedAppraisalFee: 0,
  },

  /** Family AI-2 —— 逾期折价。默认关闭。 */
  lateSale: {
    enabled: false,
    graceDays: 8,
    discount: 0,
  },
};

const baseConfig = {
  mechanisms: baseMechanisms,
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
   * 过夜平衡实验（2026-09-14~15）：400 → 700。
   *
   * **Autonomous Mechanism Evolution Lab（2026-09-15）修正：700 → 625。**
   * 理由（8 档 × 8000 局专项扫描，500/525/550/575/600/625/650/700，全部在
   * 新机制「负重返程」生效的前提下跑，见 docs/GAME_DESIGN.md §15.1）：
   *  - 设计硬约束是「3 顶买得起、4 顶买不起」→ 价格必须落在 (500, 666]；
   *    700 元下 3×700 = 2100 > 2000，「3 顶帐篷」这个设计档位实际上已经不存在。
   *  - 625 是**唯一**同时满足两条 antiWasteful 判据的合法档位：
   *    WastefulBot EV 1924 < 合理玩家 2241（不被乱囤装备占优），
   *    且 WastefulBot 胜率 72.13% < 合理玩家 72.63%（不稳定占优）。
   *    650 虽然 TentScore 更高，但 WastefulBot 胜率反超合理玩家；575/600 则相反地
   *    让 WastefulBot 的 EV 反超。
   *  - 625 下 3 顶帐篷花掉 1875 元，只剩 125 元 —— 正好满足
   *    「买 3 顶以后几乎没有资源购买其他装备」的设计意图。
   *
   * **v0.3.0 修正：625 → 800（Economic Independence Lab）。**
   *
   * 为什么必须动：修正上一轮 `emergencyRescue.extraDays` 的反向语义 Bug 之后，
   * 合理玩家代理的完成率从记录的 69.98% 回升到 82.63%（关闭求援也有 77.27%），
   * 也就是说上一轮的 70% 有相当部分来自那个会害死玩家的 Bug。要守住 §22 的
   * 68~72% 硬约束，必须在**不碰 §23 禁用清单**（天气伤害/耐力/maxDays/事故率）的前提下
   * 找一个生存侧杠杆——装备定价是唯一符合的：
   *   帐篷涨价 ⇒ 途中买不起商队/市集的补充帐篷 ⇒ 天气来袭没有帐篷 ⇒ 耐力死亡。
   *
   * 实测（econ-train，800 seeds）：625→82.63% / 700→79.25% / 750→72.0% /
   * 800→69.38% / 850→69.75% / 900→69.38% / 1000→68.25%。取 800。
   *
   * ⚠️ 代价（必须知道）：这会推翻上面那条「3 顶买得起、4 顶买不起」的设计约束
   * （该约束要求价格落在 (500, 666]）。800 元下只能买 2 顶。
   * 这是本轮为了同时满足 §22（完成率）与 §2（盈利率）所做的**显式取舍**，
   * 上一轮的 625 是在"完成率被 Bug 压低"的错误前提下标定的，需要重新标定。
   */
  tentPrice: 800,
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

  /* ---------- 天气预报（v0.1.3：现金计价） ---------- */
  /**
   * v0.1.3 机制改动：废除旧机制「购买天气预报包 → maxDays -1」，
   * 改为**现金计价**：购买时 `cash -= packPrice`，最大旅程天数完全不受影响。
   *
   * 保持不变的部分（本轮禁止修改）：
   *  - 每次预报只预测**下一天**；
   *  - 只显示玩家当前格 + 周围 8 邻域（角落 4 / 边缘 6 / 内部 9 格）；
   *  - 只能预测自然天气，不预测盗贼/商队/市集/牧民等 Encounter；
   *  - 未使用次数可储存、不过期、可带入返程；
   *  - 使用预报本身不消耗天数、不消耗耐力；
   *  - 不永久揭开未知地形（战争迷雾不受影响）。
   */
  forecast: {
    /**
     * 每包现金价格（元）。现金计价后这是唯一的购买成本。
     *
     * 2026-09-15 Forecast Economy Autonomous Lab 结论（54 组网格 + 6 组邻域 + 4 组大样本，约 15 万局）：**300**。
     *
     * 关键发现：真正决定优劣的是**单位价格（元/次）**，不是标价本身。
     * 同为 100 元/次时（3000 局大样本）：
     *   200/2 → Score 89.27、购买率 49.10%、使用率 97.09%；
     *   300/3 → Score **90.29**、购买率 45.97%、使用率 94.32%；
     *   400/4 → Score 70.89、购买率 41.40%、使用率 91.34%。
     * 而 112.5 元/次（225/2、325/3、450/4）购买率直接掉到 **0%** —— 等价于天气预报不存在。
     * 87.5~91.7 元/次一带购买率 57~68%（偏「必买」），可见健康带很窄。
     *
     * 300/3 的完整画像：Adaptive 购买率 45.97%（健康带 20~70% 正中）、有效预报率 19.5%、
     * 每 100 元换来 0.60 点伤害减少、胜率 80.03%（NoForecast 78.90%，**+1.13pp**）、
     * EV 2605.37（NoForecast 2622.65，**−0.7%**）。
     * 也就是「用一点点期望收益换取更高的存活率」——这正是「有时值得买、有时不值得买」的目标形态。
     * 滥用被惩罚：ForecastAbuserBot EV 2083.67，远低于对照组。
     */
    packPrice: 300,
    /**
     * 每包获得的预报次数。
     *
     * 实验结论：**3**。固定「100 元/次」比较包大小（3000 局）：
     *   2 次 → Score 89.27；3 次 → Score 90.29；4 次 → Score 70.89（单次占用现金变大，购买率掉到 41.4%）；5 次 → Score 74.40。
     * 所有套餐使用率都 >90%，所以不存在「套餐太大用不掉」的问题；
     * 2~3 次等价，4 次起变差。3 次同时与「先买 2 顶帐篷 + 1 指南针后剩 500 元」的
     * 开局现金结构最契合（恰好买得起 1 包）。
     */
    chargesPerPack: 3,
    /**
     * 购买后立即自动使用次数。
     *
     * A/B 实测（300/3，各 3000 局）：
     *   auto=1 → Score 90.29、ΔEV −0.7%、有效预报率 19.50%、套餐使用率 94.32%；
     *   auto=0 → Score 90.10、ΔEV +0.4%、有效预报率 18.92%、套餐使用率 87.67%。
     * 差异在噪声量级，且官方评价函数（Forecast Score）上 auto=1 略优，
     * 也没有出现「明显造成浪费」的证据，因此**保留默认值 1**。
     */
    autoUseOnPurchase: 1,
    /** 邻域半径（8 邻域固定为 1 圈） */
    neighborhoodRadius: 1,
    /**
     * 旧机制遗留字段：每包消耗的最大旅程天数。
     * 现金计价机制正式落地后恒为 0；保留字段是为了让测试/报告可以显式断言
     * 「购买预报不再改变 maxDays」，而不是靠删除代码来"证明"。
     */
    maxDaysCost: 0,
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
