/**
 * Autonomous Mechanism Evolution Lab —— 候选机制注册表。
 *
 * 每个候选 = 一份 `OASIS_CONFIG_OVERRIDE` patch（深合并进 gameConfig）。
 * 机制代码已经在引擎里实现，但默认关闭；本文件只负责"把开关拨到某个候选"。
 *
 * 版本编号（实验日志与报告必须引用同一编号）：
 *   M01 diminishing-yield-v1   （分段：2.5 / 2.0 / 1.5）
 *   M02 diminishing-yield-v2   （平滑衰减 2.6 × 0.88^n）
 *   M03 accident-risk-v1       （温和：损失当日产量 50% + 1 天）
 *   M04 accident-risk-v2       （严酷：损失当日全部产量 + 1 天 + 15% 已携带宝石）
 *   M05 load-return-v1         （阈值 12kg，沙漠每格 +1 天，可丢货）
 *   M06 load-return-v2         （阈值 16kg，沙漠每格 +1 天，可丢货）
 *   M07 mine-productivity-v1   （A 1.3x / B 0.7x，开局公开）
 *   M08 dimyield-v1+accident-v1
 *   M09 accident-v2+load-return-v1
 *   M10 load-return-v1 + tentPrice 575   （机制 × 数值联动）
 */

export type MechanismFamily = 'none' | 'A-diminishing' | 'B-productivity' | 'C-accident' | 'D-loadreturn' | 'combo';

export interface MechanismVariant {
  id: string;
  label: string;
  family: MechanismFamily;
  /** 写入 OASIS_CONFIG_OVERRIDE 的 patch（会与 baseConfig 深合并） */
  patch: Record<string, unknown>;
  /** 该机制想解决什么问题 */
  problem: string;
  /** 玩家新增什么决策 */
  newDecision: string;
  /** 复杂度预算自述 */
  complexity: { stateVars: number; formulas: number; buttons: number };
  /** 预期（先写假设，再用数据打脸） */
  hypothesis: string;
}

function dim(tierYields: number[], tierStarts: number[]) {
  return {
    mechanisms: {
      diminishingYield: { enabled: true, mode: 'tier', tierYields, tierStarts },
    },
  };
}

function acc(o: {
  baseChance: number;
  growthPerDay: number;
  capChance: number;
  yieldLossFraction: number;
  extraDays: number;
  cargoLossFraction: number;
}) {
  return { mechanisms: { accidentRisk: { enabled: true, ...o } } };
}

function load(thresholdKg: number, stepKg = 4, maxExtraPerDesertTile = 2, dropStepKg = 4) {
  return {
    mechanisms: {
      loadReturn: { enabled: true, thresholdKg, stepKg, maxExtraPerDesertTile, allowDrop: true, dropStepKg },
    },
  };
}

function prod(scaleA: number, scaleB: number, reveal: 'start' | 'arrival' = 'start') {
  return { mechanisms: { mineProductivity: { enabled: true, scaleA, scaleB, reveal } } };
}

export function merge(...patches: Array<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of patches) {
    for (const [k, v] of Object.entries(p)) {
      const prev = out[k];
      if (prev && typeof prev === 'object' && v && typeof v === 'object') {
        out[k] = { ...(prev as object), ...(v as object) };
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

export const VARIANTS: MechanismVariant[] = [
  {
    id: 'BASE',
    label: 'baseline（当前正式玩法，机制全关）',
    family: 'none',
    patch: {},
    problem: '对照组：无任何新机制。',
    newDecision: '无',
    complexity: { stateVars: 0, formulas: 0, buttons: 0 },
    hypothesis: '决策改变率 = 0%（定义上）。',
  },
  {
    id: 'M01',
    label: 'diminishing-yield-v1（2.5/2.0/1.5 分段）',
    family: 'A-diminishing',
    patch: dim([2.5, 2.0, 1.5], [4, 8]),
    problem: '采矿阶段缺少「再挖一天还值不值」的边际判断。',
    newDecision: '按产量递减曲线决定收手时机。',
    complexity: { stateVars: 0, formulas: 1, buttons: 0 },
    hypothesis: '预期决策改变率 ≈ 0%：任何 >0 的日产量仍代表正收益，提前返程没有收益 → 递减只改收益不改决策。',
  },
  {
    id: 'M02',
    label: 'diminishing-yield-v2（平滑 2.6×0.88^n）',
    family: 'A-diminishing',
    patch: {
      mechanisms: {
        diminishingYield: { enabled: true, mode: 'smooth', smoothBase: 2.6, smoothDecay: 0.88, smoothFloor: 1.1 },
      },
    },
    problem: '同上，但用平滑曲线代替台阶。',
    newDecision: '同上。',
    complexity: { stateVars: 0, formulas: 1, buttons: 0 },
    hypothesis: '同 M01：平滑与否不改变「正收益就挖」这一结构性事实 → 预期决策改变率 ≈ 0%。',
  },
  {
    id: 'M03',
    label: 'accident-risk-v1（温和：-50% 当日产量 +1 天）',
    family: 'C-accident',
    patch: acc({ baseChance: 0.05, growthPerDay: 0.025, capChance: 0.3, yieldLossFraction: 0.5, extraDays: 1, cargoLossFraction: 0 }),
    problem: '矿区停留没有代价，玩家无脑挖到最后一天。',
    newDecision: '权衡「再挖一天的期望产量」与「递增的事故概率」。',
    complexity: { stateVars: 0, formulas: 1, buttons: 0 },
    hypothesis: '事故让"多挖一天"的期望损失随停留天数上升 → 出现拐点；但损失只吃产量不吃货，预计决策改变率偏低（<15%）。',
  },
  {
    id: 'M04',
    label: 'accident-risk-v2（严酷：-100% 当日产量 +1 天 +15% 货损）',
    family: 'C-accident',
    patch: acc({ baseChance: 0.06, growthPerDay: 0.04, capChance: 0.4, yieldLossFraction: 1.0, extraDays: 1, cargoLossFraction: 0.15 }),
    problem: '同上，但要让边际风险真正压过边际收益。',
    newDecision: '在货物变重之后主动收手，避免"一次塌方吃掉半个月的矿"。',
    complexity: { stateVars: 0, formulas: 1, buttons: 0 },
    hypothesis: '事故损失随载货量放大 → 期待决策改变率 >25%，但需盯住 TIMEOUT 是否失控。',
  },
  {
    id: 'M05',
    label: 'load-return-v1（阈值 12kg，沙漠每格 +1 天，可丢货）',
    family: 'D-loadreturn',
    patch: load(20, 4, 2, 4),
    problem: '返程只是"沿还能走的格子回来"，没有任何策略选择。',
    newDecision: '① 是否丢弃宝石减负；② 是否为了避开沙漠而绕路；③ 采矿量越多，返程越贵。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '把"多挖一天"与"返程变贵"绑定 → 期待决策改变率 >15%，并产生可观测的 returnRouteDiversity。',
  },
  {
    id: 'M11',
    label: 'load-return-v3（阈值 24kg，每 6kg +1 天，上限 1 天/格：温和档）',
    family: 'D-loadreturn',
    patch: load(24, 6, 1, 4),
    problem: 'M05 可能过重（阈值 20 + 上限 2 天/格）→ 需要一个温和档做对照。',
    newDecision: '同 M05，但只有真的背很多时才付代价。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '更晚触发、更低上限 → 决策改变率应落在 15~40% 的甜区。',
  },
  {
    id: 'M12',
    label: 'load-return-v4（阈值 16kg，每 4kg +1 天，上限 2：激进档）',
    family: 'D-loadreturn',
    patch: load(16, 4, 2, 4),
    problem: '更早触发的档位，用于确认"越早触发越有决策、也越容易压死玩家"。',
    newDecision: '同 M05。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '触发更早 → 决策改变率更高，但胜率/耐力可能恶化。',
  },
  {
    id: 'M06',
    label: 'load-return-v2（阈值 16kg，去掉丢货按钮的"硬扛"档）',
    family: 'D-loadreturn',
    patch: { mechanisms: { loadReturn: { enabled: true, thresholdKg: 16, stepKg: 4, maxExtraPerDesertTile: 2, allowDrop: false, dropStepKg: 4 } } },
    problem: '确认「丢货按钮」到底有没有贡献，还是机制本身在起作用（单变量对照）。',
    newDecision: '只有"少挖 + 绕路"，没有任何补救手段。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '若去掉丢货后指标基本不变 → 丢货按钮是装饰，应删除以降低复杂度。',
  },
  {
    id: 'M13',
    label: 'load-return-v1 + 矿区勘察（抵达时揭示矿区周边 1 圈地形）',
    family: 'D-loadreturn',
    patch: merge(load(20, 4, 2, 4), { mechanisms: { loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, maxExtraPerDesertTile: 2, allowDrop: true, dropStepKg: 4, surveyRadius: 1 } } }),
    problem: '所有依赖地形的返程机制 Δroute 恒为 0%：返程必经全新格＝战争迷雾，玩家根本没法按地形选路。',
    newDecision: '返程起手的那几步第一次有了地形信息 → 可以在"短沙路"与"长草路"之间真正选。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '若 Δroute 仍为 0%，则证明"返程路线选择"在本游戏的迷雾 + 禁重复规则下结构性不可达，应如实报告而不是继续加机制。',
  },
  {
    id: 'M14',
    label: 'load-return-v3 + 矿区勘察（温和负重 24kg/上限1天 + 勘察半径1）',
    family: 'D-loadreturn',
    patch: merge(load(24, 6, 1, 4), { mechanisms: { loadReturn: { enabled: true, thresholdKg: 24, stepKg: 6, maxExtraPerDesertTile: 1, allowDrop: true, dropStepKg: 4, surveyRadius: 1 } } }),
    problem: 'Phase A 证明：M11（温和负重）决策改变率很好但 Δroute=0%；M13（勘察）Δroute=6% 但负重太重把 EV 压到 64%。',
    newDecision: '温和负重的采矿取舍 + 返程起手有信息可选的路线。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '温和负重 + 勘察应同时拿到 Δmine>40% 与 Δroute>3%，同时 EV 保持基线的 75% 以上。',
  },
  {
    id: 'M07',
    label: 'mine-productivity-v1（A 1.3x / B 0.7x）',
    family: 'B-productivity',
    patch: prod(1.3, 0.7, 'start'),
    problem: '两座矿区在收益上缺乏结构性差异。',
    newDecision: '在两矿之间做选择；但这是"去哪儿"的决策，不是"挖多久"的决策。',
    complexity: { stateVars: 0, formulas: 1, buttons: 0 },
    hypothesis: '产量倍率是全局缩放 → 预期采矿时长决策改变率 ≈ 0%；只有 MineABot/MineBBot 的 EV 差会放大。',
  },
  {
    id: 'M08',
    label: 'dimyield-v1 + accident-v1',
    family: 'combo',
    patch: merge(dim([2.5, 2.0, 1.5], [4, 8]), acc({ baseChance: 0.05, growthPerDay: 0.025, capChance: 0.3, yieldLossFraction: 0.5, extraDays: 1, cargoLossFraction: 0 })),
    problem: '单独递减无效，单独事故太弱 → 让边际收益与边际风险同时变化。',
    newDecision: '边际拐点：递减收益 vs 递增事故率。',
    complexity: { stateVars: 0, formulas: 2, buttons: 0 },
    hypothesis: '递减压低后期边际收益，事故抬高后期边际风险 → 两者相乘效应应大于任一单独机制。',
  },
  {
    id: 'M09',
    label: 'accident-v2 + load-return-v1',
    family: 'combo',
    patch: merge(
      acc({ baseChance: 0.06, growthPerDay: 0.04, capChance: 0.4, yieldLossFraction: 1.0, extraDays: 1, cargoLossFraction: 0.15 }),
      load(20, 4, 2, 4),
    ),
    problem: '同时解决 Goal A 与 Goal B：贪心挖矿既提高事故风险，又让返程变贵。',
    newDecision: '采矿时长 × 丢货 × 返程路线三处联动。',
    complexity: { stateVars: 0, formulas: 2, buttons: 1 },
    hypothesis: '两个机制都指向"别太贪" → 期待决策改变率最高，但要严查 stamina/timeout 是否失控以及是否形成"永远早退"的新支配策略。',
  },
  {
    id: 'M10',
    label: 'load-return-v1 + tentPrice 575',
    family: 'D-loadreturn',
    patch: merge(load(20, 4, 2, 4), { tentPrice: 575 }),
    problem: '机制 × 数值联动：返程变贵后，重装是否仍然值得？',
    newDecision: '同 M05，叠加帐篷预算权衡。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重机制放大"装备不足"的代价 → 575 元的帐篷可能从"偏贵"变成"更值"。',
  },

  {
    id: 'P-ACC-b030-g015',
    label: 'accident base=0.03 growth=0.015（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.03, growthPerDay: 0.015, capChance: 0.21, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.03 growth=0.015：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b030-g025',
    label: 'accident base=0.03 growth=0.025（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.03, growthPerDay: 0.025, capChance: 0.33000000000000007, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.03 growth=0.025：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b030-g040',
    label: 'accident base=0.03 growth=0.04（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.03, growthPerDay: 0.04, capChance: 0.5, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.03 growth=0.04：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b050-g015',
    label: 'accident base=0.05 growth=0.015（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.05, growthPerDay: 0.015, capChance: 0.22999999999999998, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.05 growth=0.015：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b050-g025',
    label: 'accident base=0.05 growth=0.025（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.05, growthPerDay: 0.025, capChance: 0.35000000000000003, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.05 growth=0.025：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b050-g040',
    label: 'accident base=0.05 growth=0.04（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.05, growthPerDay: 0.04, capChance: 0.5, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.05 growth=0.04：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b080-g015',
    label: 'accident base=0.08 growth=0.015（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.08, growthPerDay: 0.015, capChance: 0.26, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.08 growth=0.015：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b080-g025',
    label: 'accident base=0.08 growth=0.025（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.08, growthPerDay: 0.025, capChance: 0.38000000000000006, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.08 growth=0.025：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-ACC-b080-g040',
    label: 'accident base=0.08 growth=0.04（货损 5%、产量损失 75%）',
    family: 'P-param',
    patch: merge(acc({ baseChance: 0.08, growthPerDay: 0.04, capChance: 0.5, yieldLossFraction: 0.75, extraDays: 1, cargoLossFraction: 0.05 })),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '事故 base=0.08 growth=0.04：找决策改变率与 EV 的平衡点',
  },
  {
    id: 'P-LOAD-t16-s4-m1',
    label: 'load threshold=16 step=4 max=1',
    family: 'P-param',
    patch: load(16, 4, 1, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=16kg / 每 4kg +1 天 / 上限 1 天/格',
  },
  {
    id: 'P-LOAD-t20-s4-m1',
    label: 'load threshold=20 step=4 max=1',
    family: 'P-param',
    patch: load(20, 4, 1, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=20kg / 每 4kg +1 天 / 上限 1 天/格',
  },
  {
    id: 'P-LOAD-t24-s6-m1',
    label: 'load threshold=24 step=6 max=1',
    family: 'P-param',
    patch: load(24, 6, 1, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=24kg / 每 6kg +1 天 / 上限 1 天/格',
  },
  {
    id: 'P-LOAD-t20-s4-m2',
    label: 'load threshold=20 step=4 max=2',
    family: 'P-param',
    patch: load(20, 4, 2, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=20kg / 每 4kg +1 天 / 上限 2 天/格',
  },
  {
    id: 'P-LOAD-t24-s6-m2',
    label: 'load threshold=24 step=6 max=2',
    family: 'P-param',
    patch: load(24, 6, 2, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=24kg / 每 6kg +1 天 / 上限 2 天/格',
  },
  {
    id: 'P-LOAD-t28-s7-m2',
    label: 'load threshold=28 step=7 max=2',
    family: 'P-param',
    patch: load(28, 7, 2, 4),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '负重 threshold=28kg / 每 7kg +1 天 / 上限 2 天/格',
  },
  {
    id: 'P-M14',
    label: 'load 24/6/1 + survey1（组合）',
    family: 'P-param',
    patch: merge(load(24, 6, 1, 4), { mechanisms: { loadReturn: { enabled: true, thresholdKg: 24, stepKg: 6, maxExtraPerDesertTile: 1, allowDrop: true, dropStepKg: 4, surveyRadius: 1 } } }),
    problem: '参数搜索点。',
    newDecision: '同族机制。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '温和负重 + 勘察：目标 Δroute>3% 且 EV≥75% 基线',
  },
  {
    id: 'FINAL-load625',
    label: '最终候选：load-return 24/6/1 + tentPrice 625',
    family: 'D-loadreturn',
    patch: merge(load(24, 6, 1, 4), { tentPrice: 625 }),
    problem: '把机制与帐篷价格一起落盘的最终形态。',
    newDecision: '同 M11，外加 625 元帐篷带来的装备预算取舍。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: 'TentScore 68.21（合法档位第 2）、唯一同时满足两条 antiWasteful 判据、ReasonableMech 胜率 84.1% 落在健康带。',
  },
  {
    id: 'FINAL-load700',
    label: '对照：load-return 24/6/1 + tentPrice 700（保持现有帐篷价）',
    family: 'D-loadreturn',
    patch: load(24, 6, 1, 4),
    problem: '机制单独落盘、帐篷价维持 700 的对照。',
    newDecision: '同 M11。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '用于量化「帐篷 700→625」这 1 项数值变化的独立贡献。',
  },

];

export const VARIANT_BY_ID: Record<string, MechanismVariant> = Object.fromEntries(VARIANTS.map((v) => [v.id, v]));

/** 把候选 patch 序列化成环境变量值 */
export function overrideFor(variantId: string): string {
  const v = VARIANT_BY_ID[variantId];
  if (!v) throw new Error(`未知候选: ${variantId}`);
  return JSON.stringify(v.patch);
}

/* ------------------------------------------------------------------ */
/* 参数搜索网格（Phase B 用；一次只改 1 个机制 + ≤2 个数值）               */
/* ------------------------------------------------------------------ */

export interface ParamPoint {
  id: string;
  /** 基于哪个候选 */
  base: string;
  /** 只覆盖机制参数的 patch */
  patch: Record<string, unknown>;
  note: string;
}

/** 事故机制参数网格：起始概率 × 增长速度（其余固定） */
export function accidentGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const base of [0.03, 0.05, 0.08]) {
    for (const growth of [0.015, 0.025, 0.04]) {
      out.push({
        id: `ACC-b${base}-g${growth}`,
        base: 'M04',
        patch: { mechanisms: { accidentRisk: { enabled: true, baseChance: base, growthPerDay: growth } } },
        note: `事故 base=${base} growth=${growth}`,
      });
    }
  }
  return out;
}

/** 递减曲线参数网格：起始天数 × 末段产量 */
export function diminishingGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  const shapes: Array<[number[], number[]]> = [
    [[2.5, 2.0, 1.5], [4, 8]],
    [[2.5, 2.0, 1.5], [3, 6]],
    [[2.0, 2.0, 1.5], [5, 9]],
    [[2.5, 1.8, 1.0], [4, 8]],
  ];
  for (const [yields, starts] of shapes) {
    out.push({
      id: `DIM-${starts.join('-')}-y${yields.join('_')}`,
      base: 'M01',
      patch: { mechanisms: { diminishingYield: { enabled: true, mode: 'tier', tierYields: yields, tierStarts: starts } } },
      note: `递减 tierYields=[${yields}] tierStarts=[${starts}]`,
    });
  }
  return out;
}

/** 负重机制参数网格：阈值 × 沙漠额外天数 */
export function loadGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const th of [12, 16, 20, 24]) {
    for (const maxExtra of [1, 2, 3]) {
      out.push({
        id: `LOAD-t${th}-m${maxExtra}`,
        base: 'M05',
        patch: { mechanisms: { loadReturn: { enabled: true, thresholdKg: th, stepKg: 4, maxExtraPerDesertTile: maxExtra, allowDrop: true, dropStepKg: 4 } } },
        note: `负重阈值 ${th}kg，每多 4kg 沙漠每格 +1 天（上限 ${maxExtra} 天）`,
      });
    }
  }
  return out;
}
