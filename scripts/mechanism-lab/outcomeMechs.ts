/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 候选机制注册表。
 *
 * 与 mechs.ts（v0.1.4）同构：每个候选 = 一份 `OASIS_CONFIG_OVERRIDE` patch。
 * 机制代码已在引擎里实现，默认关闭；本文件只负责"把开关拨到某个候选"。
 *
 * 编号（实验日志与报告必须引用同一编号）：
 *   BASE          当前正式版（loadReturn 已落盘 + tentPrice 625）
 *   E1  returnCone  抵达矿区揭示返程方向 3 个候选格
 *   E2  survey1     抵达矿区揭示周边 1 圈（v0.1.4 的 M13 档，作对照）
 *   E3  compass     消耗 1 指南针侦察前方
 *   F1  village-lite  村庄只提供「花钱恢复耐力」
 *   F2  village-full  村庄三服务（耐力 / 情报 / 卖货）
 *   G1  surge3      深层采矿 ×3 产量 +1 天
 *   G2  surge25     深层采矿 ×2.5 产量 +1 天（更温和）
 *   H1  rescue      求援 400 元换 5 天 + 3 耐力
 *   H2  rescue-soft 求援 300 元换 4 天 + 2 耐力（更便宜 → 更常被用）
 *   X1  E+G         返程情报 + 深层采矿
 *   X2  G+H         深层采矿 + 求援（收益 vs 保命）
 *   X3  F+G         村庄 + 深层采矿
 *   X4  E+G+H       三族组合
 */

import { merge } from './mechs';

export type OutcomeFamily = 'none' | 'E-intel' | 'F-village' | 'G-surge' | 'H-rescue' | 'X-combo';

export interface OutcomeVariant {
  id: string;
  label: string;
  family: OutcomeFamily;
  patch: Record<string, unknown>;
  problem: string;
  newDecision: string;
  /** 复杂度预算自述（§12 约束：≤1 状态变量、≤1 公式、≤1 按钮） */
  complexity: { stateVars: number; formulas: number; buttons: number };
  hypothesis: string;
}

/* ---------- 构造器 ---------- */

export function intelCone(k = 3): Record<string, unknown> {
  return { mechanisms: { returnIntel: { enabled: true, mode: 'returnCone', coneCandidates: k } } };
}
export function intelSurvey(): Record<string, unknown> {
  return { mechanisms: { returnIntel: { enabled: true, mode: 'survey1' } } };
}
export function intelCompass(radius = 1, cost = 1): Record<string, unknown> {
  return {
    mechanisms: {
      returnIntel: { enabled: true, mode: 'compass', scoutRadius: radius, compassCostPerScout: cost, allowScoutDuringReturn: true },
    },
  };
}
export function villageLite(): Record<string, unknown> {
  return {
    mechanisms: {
      villageService: {
        enabled: true, restCostPerStamina: 150, restMaxStamina: 2, restCostsDay: true,
        intelPrice: 120, intelTiles: 3, sellEnabled: false, sellPriceRatio: 0.6, sellStepKg: 4,
      },
    },
  };
}
export function villageFull(): Record<string, unknown> {
  return {
    mechanisms: {
      villageService: {
        enabled: true, restCostPerStamina: 150, restMaxStamina: 2, restCostsDay: true,
        intelPrice: 120, intelTiles: 3, sellEnabled: true, sellPriceRatio: 0.6, sellStepKg: 4,
      },
    },
  };
}
export function surge(mult: number, extraDays: number): Record<string, unknown> {
  return {
    mechanisms: {
      surgeMining: { enabled: true, oncePerRun: true, yieldMultiplier: mult, extraDays, staminaCost: 0, accidentChanceMultiplier: 1 },
    },
  };
}
export function rescue(cost: number, extraDays: number, staminaBack: number, margin = 2, maxUses = 1): Record<string, unknown> {
  return {
    mechanisms: {
      emergencyRescue: { enabled: true, cost, extraDays, staminaBack, triggerMarginDays: margin, maxUses, cargoDroppedKg: 0 },
    },
  };
}

export const OUTCOME_VARIANTS: OutcomeVariant[] = [
  {
    id: 'BASE',
    label: 'baseline（当前正式版：loadReturn 24/6/1 + tentPrice 625）',
    family: 'none',
    patch: {},
    problem: '对照组：无任何 v0.2.0 新机制。',
    newDecision: '无',
    complexity: { stateVars: 0, formulas: 0, buttons: 0 },
    hypothesis: '决策改变率 = 0%（定义上）。预期 Completion ≈ 75%、ProfitAmongCompleted ≈ 100%（§18 经济层未独立）。',
  },
  {
    id: 'E1',
    label: 'E1 returnCone：抵达矿区揭示返程方向 3 个候选格',
    family: 'E-intel',
    patch: intelCone(3),
    problem: '返程必经迷雾 → 「按地形选路」结构性不可达（v0.1.4 已证伪路线部分）。',
    newDecision: '返程起手第一步第一次有了地形信息 → 短沙路 vs 长草路成为真实取舍。',
    complexity: { stateVars: 0, formulas: 0, buttons: 0 },
    hypothesis: 'Δroute 应显著 > 0（v0.1.4 的 survey1 只到 6%）；因只给 3 格，预计不改变 Completion（信息≠收益）。',
  },
  {
    id: 'E2',
    label: 'E2 survey1：抵达矿区揭示周边 1 圈（v0.1.4 M13 档对照）',
    family: 'E-intel',
    patch: intelSurvey(),
    problem: '对照档：确认「锥形情报」是否优于「环形情报」。',
    newDecision: '同 E1，但信息覆盖矿区四周而非返程方向。',
    complexity: { stateVars: 0, formulas: 0, buttons: 0 },
    hypothesis: '环形情报里有一半格子与返程方向无关 → Δroute 应低于 E1。',
  },
  {
    id: 'E3',
    label: 'E3 compass：消耗 1 指南针侦察前方（主动购买信息）',
    family: 'E-intel',
    patch: intelCompass(1, 1),
    problem: '信息 vs 金钱取舍（§8 B）：能否让玩家主动为情报付费？',
    newDecision: '花 1 个指南针换前方 1 圈地形——同时削弱了沙尘暴的应对资源。',
    complexity: { stateVars: 0, formulas: 0, buttons: 1 },
    hypothesis: '指南针是沙尘暴保命道具 → 用它换情报有真实机会成本；预计使用率低但决策链干净。',
  },
  {
    id: 'F1',
    label: 'F1 village-lite：村庄只提供「花钱恢复耐力」',
    family: 'F-village',
    patch: villageLite(),
    problem: '村庄目前只是随机遭遇点，不是安全/经济交换节点。',
    newDecision: '金钱 vs 耐力（§8 A）：150 元 + 1 天换 1 耐力，值不值？',
    complexity: { stateVars: 0, formulas: 0, buttons: 1 },
    hypothesis: '单服务最不容易变成必停点；预计提高 Completion 并压低 EV（→ 制造「成功但亏损」）。',
  },
  {
    id: 'F2',
    label: 'F2 village-full：村庄三服务（耐力 / 情报 / 卖货）',
    family: 'F-village',
    patch: villageFull(),
    problem: '同时提供 安全↔经济 与 信息↔金钱 两种交换。',
    newDecision: '三选一 + 何时停靠。',
    complexity: { stateVars: 0, formulas: 0, buttons: 3 },
    hypothesis: '复杂度偏高（3 按钮）且易变成必停点；预计 villageVisitRate 会接近 90%（§13 警戒）。',
  },
  {
    id: 'G1',
    label: 'G1 surge3：深层采矿 ×3 产量，多耗 1 天',
    family: 'G-surge',
    patch: surge(3, 1),
    problem: '矿区缺少「一次性富矿机会」这类一眼可理解的第二层决策（§14 C3）。',
    newDecision: '拿还是不拿：一次 3 倍收成 vs 多留 1 天。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '冒烟测试显示使用率 98.7% → 几乎必拿，可能构成支配策略，需要检查是否真的"有时不该拿"。',
  },
  {
    id: 'G2',
    label: 'G2 surge2.5：深层采矿 ×2.5 产量，多耗 1 天',
    family: 'G-surge',
    patch: surge(2.5, 1),
    problem: 'G1 可能太强；需要更温和的档位作对照。',
    newDecision: '同 G1，但机会成本更高。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '降低倍率会让"时间紧时不拿"出现 → 使用率应低于 G1，决策真正分层。',
  },
  {
    id: 'H1',
    label: 'H1 rescue：求援 400 元 → +5 天 +3 耐力',
    family: 'H-rescue',
    patch: rescue(400, 5, 3, 2, 1),
    problem: '做错一次就只能等死 → 缺少「付出大代价把远征救回来」的机制（§16）。',
    newDecision: '绝境中花大钱买命：Completion ↑、Profitability ↓ → 制造「成功但亏损」结局。',
    complexity: { stateVars: 0, formulas: 0, buttons: 1 },
    hypothesis: '冒烟测试：36.7% 使用率、Completion 68.67%、EV 1647（低于基线 2145）→ 正是 §17 想要的形状。',
  },
  {
    id: 'H2',
    label: 'H2 rescue-soft：求援 300 元 → +4 天 +2 耐力',
    family: 'H-rescue',
    patch: rescue(300, 4, 2, 2, 1),
    problem: 'H1 的高价可能让"亏钱的胜利"太多（EV 掉得过头）。',
    newDecision: '同 H1，但价格更容易接受 → 使用率更高、单次代价更低。',
    complexity: { stateVars: 0, formulas: 0, buttons: 1 },
    hypothesis: '更便宜 → 使用率上升，但每次亏损更少 → EV 应高于 H1，Completion 可能更高。',
  },
  {
    id: 'X1',
    label: 'X1 = E1 + G1（返程情报 + 深层采矿）',
    family: 'X-combo',
    patch: merge(intelCone(3), surge(3, 1)),
    problem: '信息增益与矿区收益增益是否互补？',
    newDecision: '返程选路 + 深层采矿拿不拿。',
    complexity: { stateVars: 0, formulas: 1, buttons: 1 },
    hypothesis: '两个机制都提高收益但不改变经济结构 → 预计 Completion/Economic 结构不变，只是整体上移。',
  },
  {
    id: 'X2',
    label: 'X2 = G1 + H1（深层采矿 + 求援）',
    family: 'X-combo',
    patch: merge(surge(3, 1), rescue(400, 5, 3, 2, 1)),
    problem: '「贪心拿矿 → 陷入绝境 → 花钱保命」是否形成完整因果链（§8 D 现在收手 vs 继续冒险）？',
    newDecision: '拿矿的收益 + 拿矿的代价（可能要求援）+ 何时认赔。',
    complexity: { stateVars: 0, formulas: 1, buttons: 2 },
    hypothesis: '这是最有机会同时满足 Completion 68~72% 与 Profitability 42~48% 的组合：G 抬 Completion，H 同时抬 Completion、压 Profitability。',
  },
  {
    id: 'X3',
    label: 'X3 = F1 + G1（村庄恢复 + 深层采矿）',
    family: 'X-combo',
    patch: merge(villageLite(), surge(3, 1)),
    problem: '村庄把耐力换成现金支出 → 经济层被拉薄。',
    newDecision: '歇脚 vs 硬扛 + 拿不拿矿。',
    complexity: { stateVars: 0, formulas: 1, buttons: 2 },
    hypothesis: '预计 Completion 上升、Profitability 下降，是「成功但亏损」的另一条路径。',
  },
  {
    id: 'X4',
    label: 'X4 = E1 + G1 + H1（情报 + 采矿 + 求援）',
    family: 'X-combo',
    patch: merge(intelCone(3), surge(3, 1), rescue(400, 5, 3, 2, 1)),
    problem: '三族组合是否过强（§42 上限 2 机制）？',
    newDecision: '全部三类取舍同时存在。',
    complexity: { stateVars: 0, formulas: 1, buttons: 2 },
    hypothesis: '预计决策改变率最高，但复杂度超出 §42 上限，除非显著优于 X2 否则只作分析用。',
  },
];

export const OUTCOME_VARIANT_BY_ID: Record<string, OutcomeVariant> = Object.fromEntries(
  OUTCOME_VARIANTS.map((v) => [v.id, v]),
);

/**
 * 把 Phase B 参数网格点注册成"候选"，使它们能被 runOutcomeLab 的 `--variants` 直接驱动。
 * 这样参数搜索与锦标赛共用同一套分片/看门狗/配对比较装置，不需要第二套 runner。
 */
export function registerParamPoints(points: OutcomeParamPoint[]): void {
  for (const p of points) {
    if (OUTCOME_VARIANT_BY_ID[p.id]) continue;
    OUTCOME_VARIANT_BY_ID[p.id] = {
      id: p.id,
      label: `${p.id}（参数点，基于 ${p.base}）`,
      family: 'X-combo',
      patch: p.patch,
      problem: '',
      newDecision: '',
      complexity: { stateVars: 0, formulas: 0, buttons: 1 },
      hypothesis: p.note,
    };
  }
}

export function outcomeOverrideFor(variantId: string): string {
  const v = OUTCOME_VARIANT_BY_ID[variantId];
  if (!v) throw new Error(`未知候选: ${variantId}`);
  return JSON.stringify(v.patch);
}

/* ------------------------------------------------------------------ */
/* 参数搜索网格（Phase B）                                              */
/* ------------------------------------------------------------------ */

export interface OutcomeParamPoint {
  id: string;
  base: string;
  patch: Record<string, unknown>;
  note: string;
}

/** G（深层采矿）参数网格：倍率 × 额外天数 */
export function surgeGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const mult of [1.8, 2.2, 2.6, 3.0]) {
    for (const days of [1, 2]) {
      out.push({
        id: `SURGE-m${mult}-d${days}`,
        base: 'G1',
        patch: surge(mult, days),
        note: `深层采矿 ×${mult}，多耗 ${days} 天`,
      });
    }
  }
  return out;
}

/**
 * H（求援）参数网格：价格 × 买回天数。
 *
 * ★ 为什么网格要延伸到 2500 元？
 * Phase A 450-seed 配对基线实测：360 个成功返城局里利润最低的一局是 +850 元，
 * 「成功但亏损」= 0 局。要把「成功局盈利率」压到 §20 的 60~70% 健康带，
 * 需要让利润最低的 ~112 局变亏损，而第 112 低利润 = 2550 元。
 * 因此必须实测 2500 元级的高价档，验证「一次性大额支出」这条路径是否真的可行
 * （400 元的廉价档在结构上就翻不动几局）。
 */
export function rescueGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const cost of [250, 350, 450, 550, 900, 1400, 2000, 2600]) {
    for (const days of [4, 6]) {
      out.push({
        id: `RESCUE-c${cost}-d${days}`,
        base: 'H1',
        patch: rescue(cost, days, 3, 2, 1),
        note: `求援 ${cost} 元，+${days} 天 +3 耐力`,
      });
    }
  }
  return out;
}

/**
 * H2（求援网格 · 极限档）：只测试高价 + 更宽触发窗口。
 * triggerMarginDays 放宽到 4 ⇒ 更早触发 ⇒ 单局内更可能用上（但仍 maxUses=1）。
 */
export function rescueWideGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const cost of [1200, 1800, 2400]) {
    for (const margin of [2, 4, 6]) {
      out.push({
        id: `RESCUEWIDE-c${cost}-m${margin}`,
        base: 'H1',
        patch: rescue(cost, 6, 3, margin, 1),
        note: `求援 ${cost} 元，+6 天 +3 耐力，触发窗口 ${margin} 天`,
      });
    }
  }
  return out;
}

/** F（村庄恢复）参数网格：单价 × 是否消耗天数 */
export function villageGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const cost of [100, 150, 200, 250]) {
    for (const costsDay of [true, false]) {
      out.push({
        id: `VILLAGE-c${cost}-day${costsDay ? 1 : 0}`,
        base: 'F1',
        patch: {
          mechanisms: {
            villageService: {
              enabled: true, restCostPerStamina: cost, restMaxStamina: 2, restCostsDay: costsDay,
              intelPrice: 120, intelTiles: 3, sellEnabled: false, sellPriceRatio: 0.6, sellStepKg: 4,
            },
          },
        },
        note: `村庄恢复 ${cost} 元/耐力，${costsDay ? '消耗 1 天' : '不消耗天数'}`,
      });
    }
  }
  return out;
}

/** E（返程情报）参数网格：候选格数 */
export function intelGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const k of [1, 2, 3, 5]) {
    out.push({ id: `INTEL-k${k}`, base: 'E1', patch: intelCone(k), note: `揭示返程方向 ${k} 个候选格` });
  }
  return out;
}

/**
 * X2 组合网格（Phase C 首选）：深层采矿 ×2.6 + 求援（多档价格）。
 * Phase A 显示 X2 是 Completion 最接近 70% 且决策改变率 100% 的组合，
 * 但其 Profitability 仍与 Completion 锁死（pAc=100%）。
 * 本网格把求援价格拉到 1400~2600 元，验证「高价保命」能否同时压低盈利率。
 */
export function comboGrid(): OutcomeParamPoint[] {
  const out: OutcomeParamPoint[] = [];
  for (const cost of [900, 1400, 2000, 2600]) {
    out.push({
      id: `COMBO-s26-r${cost}`,
      base: 'X2',
      patch: merge(surge(2.6, 1), rescue(cost, 6, 3, 2, 1)),
      note: `深层采矿 ×2.6 + 求援 ${cost} 元（+6 天 +3 耐力）`,
    });
  }
  return out;
}

/**
 * EH1 = E1 + H1（返程情报 + 400 元求援）—— Phase A 未测过、预期最优的落盘组合。
 * 理由：H1 是唯一把 Completion 压进 68~72% 的机制；E1 是零经济扰动、
 * 决策改变率 88% 的纯信息机制（无支配惩罚）。两者正交：E 管「怎么走」，H 管「要不要认赔」。
 */
export function ehCombo(): OutcomeParamPoint {
  return {
    id: 'EH1',
    base: 'X2',
    patch: merge(intelCone(3), rescue(400, 5, 3, 2, 1)),
    note: '返程情报（3 候选格）+ 求援 400 元（+5 天 +3 耐力）',
  };
}
