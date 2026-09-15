/**
 * v0.3.0 Economic Independence Lab —— 候选机制注册表。
 *
 * 与 mechanism-lab/mechs.ts 同构：每个候选 = 一份 `OASIS_CONFIG_OVERRIDE` patch。
 * 机制代码已经在**正式引擎**里实现（src/game/rules/settlement.ts + outcome.ts），
 * 由 `mechanisms.*.enabled` 控制且默认关闭；实验时用 override 打开，
 * 落盘 = 把默认值改成 true，回滚 = 改回 false（实验与生产走同一份代码，不会漂移）。
 *
 * 赛前必写假设（§19）：每个候选都必须登记 nine 项字段，
 * 未登记的候选**禁止**进入 Simulation —— 这是防止"事后编故事"的硬门槛。
 */

export interface EconVariant {
  id: string;
  label: string;
  family: 'BASE' | 'A-rescue' | 'B-upkeep' | 'C-trade' | 'AI-latesale' | 'combo';
  patch: Record<string, unknown>;
  /** ① 玩家看到的规则（必须 1~3 句话说得清，§43 G15） */
  playerRule: string;
  /** ② 改变什么决策 */
  newDecision: string;
  /** ③ 为什么可能制造「成功但亏损」 */
  whyLoss: string;
  /** ④ 为什么不是单纯税收（§16/§45） */
  whyNotFlatTax: string;
  /** ⑤ 预期对 Completion 的影响 */
  expCompletion: string;
  /** ⑥ 预期对 Profitability 的影响 */
  expProfitability: string;
  /** ⑦ 可能的支配策略 */
  riskDominance: string;
  /** ⑧ 对应 MechanismAwareBot */
  bot: string;
  /** ⑨ 复杂度预算（§20：新增状态变量 ≤2、核心公式 ≤2、主动按钮 ≤1） */
  complexity: { stateVars: number; formulas: number; buttons: number };
}

export function merge(...patches: Array<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of patches) {
    for (const [k, v] of Object.entries(p)) {
      const prev = out[k];
      if (prev && typeof prev === 'object' && v && typeof v === 'object') out[k] = { ...(prev as object), ...(v as object) };
      else out[k] = v;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 构造子                                                               */
/* ------------------------------------------------------------------ */

/** Family A1 —— 固定延期救援债务（求援当场不收钱） */
export function rescueDeferred(debt: number, immediate = 0) {
  return {
    mechanisms: {
      rescueSettlement: {
        enabled: true,
        immediateCost: immediate,
        deferredDebt: debt,
        revenueShare: 0,
        minFee: 0,
        debtCap: 0,
      },
    },
  };
}

/** Family A2 —— 按宝石收入比例抽成 */
export function rescueShare(share: number, immediate = 0, minFee = 0, debt = 0) {
  return {
    mechanisms: {
      rescueSettlement: {
        enabled: true,
        immediateCost: immediate,
        deferredDebt: debt,
        revenueShare: share,
        minFee,
        debtCap: 0,
      },
    },
  };
}

/** Family B1 —— 每天运营成本 */
export function upkeepPerDay(costPerDay: number) {
  return { mechanisms: { upkeep: { enabled: true, mode: 'perDay', costPerDay, overtimeCostPerDay: 0, freeDays: 0, onlyOnSuccess: true } } };
}

/** Family B2 —— 免费基础天数 + 超时运营费 */
export function upkeepOvertime(freeDays: number, rate: number) {
  return { mechanisms: { upkeep: { enabled: true, mode: 'overtime', freeDays, overtimeCostPerDay: rate, costPerDay: 0, onlyOnSuccess: true } } };
}

/** Family B3 —— 只按矿区驻扎天数收费 */
export function upkeepMining(costPerDay: number) {
  return { mechanisms: { upkeep: { enabled: true, mode: 'miningDay', costPerDay, overtimeCostPerDay: 0, freeDays: 0, onlyOnSuccess: true } } };
}

/** Family C —— 运输/佣金/鉴定费 */
export function tradeCost(o: { transportPerKg?: number; commissionRate?: number; fixedAppraisalFee?: number }) {
  return {
    mechanisms: {
      tradeCost: {
        enabled: true,
        transportPerKg: o.transportPerKg ?? 0,
        commissionRate: o.commissionRate ?? 0,
        fixedAppraisalFee: o.fixedAppraisalFee ?? 0,
      },
    },
  };
}

/** Family AI-2 —— 逾期折价（AI 自主提出候选） */
export function lateSale(graceDays: number, discount: number) {
  return { mechanisms: { lateSale: { enabled: true, graceDays, discount } } };
}

/* ------------------------------------------------------------------ */
/* Phase A —— 机制候选锦标赛                                            */
/* ------------------------------------------------------------------ */

const A1 = (debt: number): EconVariant => ({
  id: `A1-D${debt}`,
  label: `延期求援·固定债务 ${debt} 元（当场 0 元）`,
  family: 'A-rescue',
  patch: rescueDeferred(debt),
  playerRule: `走投无路时可以呼叫驼队求援，当场不收钱；安全回城后，结算时偿还 ${debt} 元。`,
  newDecision: '① 是否求援（货值够不够cover这笔债）；② 上游：挖多久 / 是否冒险拖延。',
  whyLoss: `债务在**结算时**扣，不受"手上最多 550 元现金"的可负担性悬崖限制 → 可以把数额做到 2000+ 量级，足以把成功局翻成亏损。`,
  whyNotFlatTax: '只对**求援过的局**收费；不求援的局一分不付。是否付费由玩家自己决定。',
  expCompletion: '略升（求援不再受现金限制，更多局被救回）。',
  expProfitability: `下降：求援局被扣 ${debt} 元，其中货值较小者直接转亏损。`,
  riskDominance: 'RESCUE_DOMINANCE：若所有人都在绝境求援（useRate>70%），说明它成了"默认续命按钮"。',
  bot: 'EconMasterBot（负债感知：只在 净收入 > 债务 时求援）',
  complexity: { stateVars: 1, formulas: 1, buttons: 0 },
});

const A2 = (pct: number): EconVariant => ({
  id: `A2-S${pct}`,
  label: `延期求援·宝石收入抽成 ${pct}%（当场 0 元）`,
  family: 'A-rescue',
  patch: rescueShare(pct / 100),
  playerRule: `走投无路时可以呼叫驼队求援，当场不收钱；安全回城后，他们分走宝石销售收入的 ${pct}%。`,
  newDecision: '① 是否求援；② 挖得越多，被分走的绝对额越大 → 贪心与求援形成联动。',
  whyLoss: '抽成与货值同向放大：越是"挖到很多矿才陷入绝境"的局，被分走的绝对额越大 → 高货值局也可能转亏。',
  whyNotFlatTax: '只对求援局收，且金额与货值挂钩，不是统一搬家。',
  expCompletion: '略升（同 A1）。',
  expProfitability: `下降幅度与救回局数×${pct}% 成正比；比固定债务更"累进"。`,
  riskDominance: '若 pct 太高，玩家宁可放弃求援 → 使用率崩塌，退化回基线。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 1, formulas: 1, buttons: 0 },
});

const B1 = (c: number): EconVariant => ({
  id: `B1-P${c}`,
  label: `运营成本·每天 ${c} 元`,
  family: 'B-upkeep',
  patch: upkeepPerDay(c),
  playerRule: `远征每进行 1 天，驮队与补给开销 ${c} 元，安全回城后一并结算。`,
  newDecision: '路线长短 / 是否绕路 / 是否原地等待 / 是否在绿洲休整 —— 每天都要付钱。',
  whyLoss: '拖得久的局（天气耽误、绕路、事故）被额外收费，而它们本来就是低利润局 → 最先转亏。',
  whyNotFlatTax: '费用与**实际耗时**成正比，而耗时是可控变量：走得快就少付。',
  expCompletion: '基本不变（只影响结算，不影响生存）。',
  expProfitability: '中等下降，且下降集中在慢局。',
  riskDominance: 'METRIC_ONLY_TAX：若 Δdecision≈0（Bot 完全不改变行为），说明它只是统一减钱。',
  bot: 'EconMasterBot（把 marginalPerDay 纳入采矿边际判断）',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

const B2 = (free: number, rate: number): EconVariant => ({
  id: `B2-F${free}R${rate}`,
  label: `运营成本·前 ${free} 天免费，之后每天 ${rate} 元`,
  family: 'B-upkeep',
  patch: upkeepOvertime(free, rate),
  playerRule: `远征前 ${free} 天的补给由商队承担；从第 ${free + 1} 天起，每天要付 ${rate} 元，回城结算。`,
  newDecision: '「还要不要多挖一天」第一次有了明确的每日价格；也逼迫权衡"绕远路更安全"是否划算。',
  whyLoss: '只有**超出免费期**的局才被收，正好是那些走得慢/挖太久/被天气拖住的局。',
  whyNotFlatTax: '干脆利落的局一分钱不付；阈值本身就制造了一个可选择的截止点。',
  expCompletion: '基本不变或略升（鼓励早回）。',
  expProfitability: '下降且集中在长局。',
  riskDominance: '若免费期太长 → 几乎无人触发 = 无效；太短 → 等价于 B1 统一税。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

const B3 = (c: number): EconVariant => ({
  id: `B3-M${c}`,
  label: `矿区驻扎费·每个采矿日 ${c} 元`,
  family: 'B-upkeep',
  patch: upkeepMining(c),
  playerRule: `在矿区每驻扎 1 天，要向矿主交 ${c} 元的场地与抽水费用，回城结算。`,
  newDecision: '采矿时长：挖到"每日产值 < 每日费用"就该收手（这是最纯粹的边际拐点）。',
  whyLoss: '挖太久的局被直接收费；而挖太久本来就是贪心局。',
  whyNotFlatTax: '只对采矿天数收费，与去程/返程效率无关 → 玩家可以通过"走得快"来抵消。',
  expCompletion: '可能略升（更早收手 = 更多时间余量）。',
  expProfitability: '下降，且直接改变采矿天数分布（可观测）。',
  riskDominance: '若 c 太高 → 所有人只挖 1~2 天（新的单一模板）。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

const C1 = (pct: number): EconVariant => ({
  id: `C1-K${pct}`,
  label: `宝石销售佣金 ${pct}%`,
  family: 'C-trade',
  patch: tradeCost({ commissionRate: pct / 100 }),
  playerRule: `回城鉴定后，城里的宝石行会抽走销售额的 ${pct}% 作为佣金。`,
  newDecision: '几乎没有 —— 它对所有成功局一视同仁。',
  whyLoss: '统一压低所有成功局的收入。',
  whyNotFlatTax: '**它就是统一税。** 本候选刻意作为 ECONOMIC_CONTROL：用来测出"经济规模需要多大改动"，默认不 Promotion（§16/§45）。',
  expCompletion: '不变。',
  expProfitability: '按 pct 线性下降。',
  riskDominance: 'METRIC_ONLY_TAX（必然）。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

const C3 = (perKg: number): EconVariant => ({
  id: `C3-T${perKg}`,
  label: `运输费 ${perKg} 元/kg`,
  family: 'C-trade',
  patch: tradeCost({ transportPerKg: perKg }),
  playerRule: `把宝石运回城要按重量付运费：每公斤 ${perKg} 元。`,
  newDecision: '是否丢货减负 / 是否为了减重而少挖 —— 与既有负重机制叠加。',
  whyLoss: '载货越重运费越高，挤压重载局的利润。',
  whyNotFlatTax: '费用与**自选择**的载货量挂钩，玩家可以用丢货/少挖来避税。',
  expCompletion: '可能略升（倾向早收手）。',
  expProfitability: '下降，且与丢货率联动。',
  riskDominance: '若 perKg > 单价 → 所有人把货丢光，机制崩塌。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

const L1 = (grace: number, pct: number): EconVariant => ({
  id: `L1-G${grace}D${pct}`,
  label: `逾期折价·超过第 ${42 - grace} 天回城，宝石打 ${100 - pct} 折`,
  family: 'AI-latesale',
  patch: lateSale(grace, pct / 100),
  playerRule: `城门集市只开到第 ${42 - grace} 天。之后回城的宝石只能折价卖给贩子（少卖 ${pct}%）。`,
  newDecision: '「赶在集市前回城」——采矿时长、是否绕路、是否原地等待全部重新定价。',
  whyLoss: '拖过截止日的局，全部货值一次性打折 → 产生"活着回来但贱卖了"的亏损。',
  whyNotFlatTax: '只有慢局被抽，快局一分不损；且玩家可以选择赶时间避开它。',
  expCompletion: '略升（鼓励早回）。',
  expProfitability: '下降，集中在慢局。',
  riskDominance: '若折价太狠 → 所有人疯狂赶路（new single template）；若太轻 → 无人触发。',
  bot: 'EconMasterBot（把跨线惩罚计入采矿边际判断）',
  complexity: { stateVars: 0, formulas: 1, buttons: 0 },
});

export const BASE: EconVariant = {
  id: 'BASE',
  label: '当前正式经济（v0.2.0 EH1：求援 400 元即时现金）',
  family: 'BASE',
  patch: {},
  playerRule: '返城后宝石按鉴定价卖出；求援当场付 400 元。',
  newDecision: '对照组：无新决策。',
  whyLoss: '不适用（基线）。',
  whyNotFlatTax: '不适用。',
  expCompletion: '≈69.98%（上一轮 5000 seeds 实测）。',
  expProfitability: '≈69.86%（上一轮 5000 seeds 实测）。',
  riskDominance: 'ProfitAmongCompleted ≈ 99.83% ⇒ 生还与赚钱高度绑定（本轮要解决的 P0）。',
  bot: 'EconMasterBot',
  complexity: { stateVars: 0, formulas: 0, buttons: 0 },
};

/**
 * 诊断对照：把上一轮落盘的 emergencyRescue 整个关掉。
 * 用途：量化「求援」对 Completion 的真实贡献（v0.3.0 修复 extraDays 语义后必须重测）。
 */
export const NORESCUE: EconVariant = {
  ...BASE,
  id: 'NORESCUE',
  label: '关闭紧急求援（诊断对照：量化求援对 Completion 的真实贡献）',
  patch: { mechanisms: { emergencyRescue: { enabled: false } } },
};

/** Phase A 锦标赛候选（16 个） */
export function phaseACandidates(): EconVariant[] {
  return [
    BASE,
    NORESCUE,
    A1(800), A1(1600), A1(2400),
    A2(30), A2(50),
    B1(40), B1(80),
    B2(20, 60), B2(25, 100),
    B3(200), B3(400),
    C1(20), C3(30),
    L1(8, 25), L1(12, 40),
  ];
}

/* ------------------------------------------------------------------ */
/* Phase B —— 参数网格                                                  */
/* ------------------------------------------------------------------ */

export interface ParamPoint {
  id: string;
  patch: Record<string, unknown>;
  note: string;
}

/** A1 固定债务网格（§8） */
export function debtGrid(): ParamPoint[] {
  return [800, 1200, 1600, 2000, 2400, 2800].map((d) => ({
    id: `A1-D${d}`,
    patch: rescueDeferred(d),
    note: `延期求援固定债务 ${d} 元`,
  }));
}

/** A2 抽成网格（§10） */
export function shareGrid(): ParamPoint[] {
  return [10, 20, 25, 30, 35, 40, 50, 60].map((p) => ({
    id: `A2-S${p}`,
    patch: rescueShare(p / 100),
    note: `延期求援抽成 ${p}%`,
  }));
}

/** A3 固定 + 比例混合 */
export function hybridGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const debt of [400, 800, 1200]) {
    for (const p of [15, 25, 35]) {
      out.push({
        id: `A3-D${debt}S${p}`,
        patch: rescueShare(p / 100, 0, 0, debt),
        note: `延期求援 ${debt} 元 + ${p}% 抽成`,
      });
    }
  }
  return out;
}

/**
 * B1 每日运营成本网格（§13 给出 20~100；本轮实测 80 才开始产生决策改变，
 * 因此向上扩展到 200，用于找"经济压力足够大但还没把人逼死"的区间）。
 */
export function perDayGrid(): ParamPoint[] {
  return [20, 30, 40, 50, 60, 80, 100, 120, 140, 160, 180, 200].map((c) => ({
    id: `B1-P${c}`,
    patch: upkeepPerDay(c),
    note: `每日运营成本 ${c} 元`,
  }));
}

/** B2 超时网格 */
export function overtimeGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const free of [14, 16, 18, 22, 26]) {
    for (const rate of [40, 70, 100, 140, 180]) {
      out.push({
        id: `B2-F${free}R${rate}`,
        patch: upkeepOvertime(free, rate),
        note: `前 ${free} 天免费，之后每天 ${rate} 元`,
      });
    }
  }
  return out;
}

/** B3 采矿日网格 */
export function miningDayGrid(): ParamPoint[] {
  return [100, 200, 250, 300, 350, 400, 450, 500].map((c) => ({
    id: `B3-M${c}`,
    patch: upkeepMining(c),
    note: `每个采矿日 ${c} 元`,
  }));
}

/** C 族网格（对照组） */
export function tradeGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const p of [5, 10, 15, 20, 25, 30]) out.push({ id: `C1-K${p}`, patch: tradeCost({ commissionRate: p / 100 }), note: `佣金 ${p}%` });
  for (const t of [10, 20, 30, 40]) out.push({ id: `C3-T${t}`, patch: tradeCost({ transportPerKg: t }), note: `运输 ${t} 元/kg` });
  return out;
}

/** AI-2 逾期折价网格 */
export function lateSaleGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  for (const g of [6, 8, 10, 12, 14, 16, 18]) {
    for (const d of [20, 30, 40, 50, 60]) {
      out.push({ id: `L1-G${g}D${d}`, patch: lateSale(g, d / 100), note: `截止第 ${42 - g} 天，折价 ${d}%` });
    }
  }
  return out;
}

/**
 * Phase B 组合网格（§46/§59：单个机制不够时，用**两个**机制各司其职）。
 *
 * 分工逻辑（这正是 §46 想要的三层结局）：
 *   - 运营成本 / 逾期折价：**制造利润压力** ⇒ Bot 为了翻本会挖更久 ⇒ 更容易陷入绝境；
 *   - 延期求援债务：让"叫救援"变成一次真正的经济抉择
 *     ⇒ 货值够 → 叫，回来但被抽走一大截（成功但亏损）
 *     ⇒ 货值不够 → 不叫，认赔失败（远征失败）
 *     ⇒ 规划得好、没陷入绝境 → 不用叫，回来且盈利
 */
/**
 * 装备定价网格（装备 = 「用钱换命」的定价，是本轮唯一不在 §23 禁用清单里的生存侧杠杆）。
 *
 * 为什么它能同时服务两个目标：
 *   - 生存侧：帐篷是唯一能挡沙暴/暴雨的东西 ⇒ 帐篷越贵，玩家买得越少 ⇒ 越容易死；
 *   - 经济侧：装备是最大的一笔现金支出 ⇒ 帐篷越贵，成功局的利润越薄。
 * 于是它天然把「生还」与「赚钱」往相反方向拉 —— 这正是 §29 要的解耦。
 *
 * 代价（必须如实写进报告）：上一轮 v0.1.4 把 tentPrice 定在 625 时有一条设计硬约束
 * 「3 顶买得起、4 顶买不起」⇒ 价格必须落在 (500, 666]。把价格抬到 700+ 会推翻它。
 */
export function tentGrid(): ParamPoint[] {
  return [700, 750, 800, 850, 900, 1000].map((p) => ({
    id: `T-${p}`,
    patch: { tentPrice: p },
    note: `帐篷单价 ${p} 元（基准 625）`,
  }));
}

/**
 * 装备定价 × 经济机制组合网格。
 * 两个机制各司其职：装备定价负责"生存侧"，运营成本负责"经济侧"。
 */
export function tentComboGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  const add = (id: string, parts: Array<Record<string, unknown>>, note: string) =>
    out.push({ id, patch: merge(...parts), note });
  for (const t of [700, 725, 750, 775, 800, 825]) {
    for (const per of [40, 50, 60, 65, 70, 75, 80, 90, 100]) {
      add(`XT${t}-P${per}`, [{ tentPrice: t }, upkeepPerDay(per)], `帐篷 ${t} 元 + 每日运营费 ${per} 元`);
    }
  }
  for (const t of [800, 850]) {
    add(`XT${t}-F22R180`, [{ tentPrice: t }, upkeepOvertime(22, 180)], `帐篷 ${t} 元 + 前 22 天免费后 180 元/天`);
    add(`XT${t}-L12D50`, [{ tentPrice: t }, lateSale(12, 0.5)], `帐篷 ${t} 元 + 第 30 天截止折价 50%`);
    add(`XT${t}-L14D40`, [{ tentPrice: t }, lateSale(14, 0.4)], `帐篷 ${t} 元 + 第 28 天截止折价 40%`);
  }
  /**
   * 装备定价 + 运营费 + **延期求援债务**：三件套。
   * 延期求援（当场 0 元）是必需的 —— 帐篷涨价后玩家手上根本没有 400 元现金，
   * 若求援仍是"当场付现金"，它会直接变成永远点不动的死机制（实测 T-800 起求援使用率 = 0%）。
   */
  for (const t of [800]) {
    for (const per of [50, 70, 90]) {
      for (const debt of [1200, 2000, 2800]) {
        add(`XT${t}-P${per}D${debt}`, [{ tentPrice: t }, upkeepPerDay(per), rescueDeferred(debt)],
          `帐篷 ${t} 元 + 每日 ${per} 元 + 延期求援债务 ${debt} 元`);
      }
    }
  }
  for (const t of [800]) {
    for (const debt of [1600, 2400]) {
      add(`XT${t}-F22R180D${debt}`, [{ tentPrice: t }, upkeepOvertime(22, 180), rescueDeferred(debt)],
        `帐篷 ${t} 元 + 前 22 天免费后 180 元/天 + 求援债务 ${debt} 元`);
    }
  }
  /**
   * 装备定价 + 运营费 + **按收入抽成**的延期求援。
   *
   * 为什么值得单独测：固定债务 D 的接受判据是 `p1(R − D) > p0·R` —— 与货值 R 强相关，
   * 于是只有"货特别多"的绝境才会叫救援（实测 D=2800 时使用率只有 4%）。
   * 抽成 s 的判据是 `p1(1 − s) > p0` —— **与货值无关**，
   * 因此更多不同处境的局会叫救援，而被抽成后仍可能亏损（因为抽成是累进的）。
   */
  for (const t of [800]) {
    for (const per of [60, 70, 80]) {
      for (const s of [30, 40, 50]) {
        add(`XT${t}-P${per}S${s}`, [{ tentPrice: t }, upkeepPerDay(per), rescueShare(s / 100)],
          `帐篷 ${t} 元 + 每日 ${per} 元 + 求援抽成 ${s}%`);
      }
    }
  }
  for (const t of [750, 850]) {
    for (const s of [40, 50]) {
      add(`XT${t}-P70S${s}`, [{ tentPrice: t }, upkeepPerDay(70), rescueShare(s / 100)],
        `帐篷 ${t} 元 + 每日 70 元 + 求援抽成 ${s}%`);
    }
  }
  /**
   * 超时运营费版（B2）替代每日费（B1）：只有**拖得久**的局才付运营费，
   * 干脆利落的局一分不付 —— 比 perDay 更不像"统一税"（§16），也更像一句人话
   * 「前 N 天商队包干，之后每天自己掏」。
   */
  for (const t of [800]) {
    for (const [free, rate] of [[20, 160], [22, 140], [22, 160], [24, 200], [18, 140]] as Array<[number, number]>) {
      add(`XT${t}-F${free}R${rate}D2800`, [{ tentPrice: t }, upkeepOvertime(free, rate), rescueDeferred(2800)],
        `帐篷 ${t} 元 + 前 ${free} 天免费后 ${rate} 元/天 + 求援债务 2800 元`);
    }
    for (const [free, rate] of [[22, 160]] as Array<[number, number]>) {
      add(`XT${t}-F${free}R${rate}D3600`, [{ tentPrice: t }, upkeepOvertime(free, rate), rescueDeferred(3600)],
        `帐篷 ${t} 元 + 前 ${free} 天免费后 ${rate} 元/天 + 求援债务 3600 元`);
    }
  }
  return out;
}

export function comboGrid(): ParamPoint[] {
  const out: ParamPoint[] = [];
  const add = (id: string, parts: Array<Record<string, unknown>>, note: string) =>
    out.push({ id, patch: merge(...parts), note });
  for (const per of [80, 100, 120]) {
    for (const debt of [1600, 2400]) {
      add(`X-P${per}D${debt}`, [upkeepPerDay(per), rescueDeferred(debt)], `每日 ${per} 元运营费 + 延期求援债务 ${debt} 元`);
    }
  }
  add('X-P100S30', [upkeepPerDay(100), rescueShare(0.3)], '每日 100 元运营费 + 求援抽成 30%');
  add('X-P120S40', [upkeepPerDay(120), rescueShare(0.4)], '每日 120 元运营费 + 求援抽成 40%');
  add('X-F16R180D2400', [upkeepOvertime(16, 180), rescueDeferred(2400)], '前 16 天免费后 180 元/天 + 求援债务 2400 元');
  add('X-L16D50D2400', [lateSale(16, 0.5), rescueDeferred(2400)], '第 26 天截止折价 50% + 求援债务 2400 元');
  add('X-P100D2400L14D40', [upkeepPerDay(100), rescueDeferred(2400), lateSale(14, 0.4)], '每日 100 元 + 求援债务 2400 + 第 28 天截止折价 40%');
  return out;
}

/* ------------------------------------------------------------------ */
/* 注册表（含 --grid 动态注册的参数点）                                   */
/* ------------------------------------------------------------------ */

let registry: EconVariant[] = phaseACandidates();
const byId = new Map<string, EconVariant>(registry.map((v) => [v.id, v]));

export function registerPoints(points: ParamPoint[]): void {
  for (const p of points) {
    if (byId.has(p.id)) continue;
    const v: EconVariant = {
      id: p.id,
      label: p.note,
      family: p.id.startsWith('A') ? 'A-rescue' : p.id.startsWith('B') ? 'B-upkeep' : p.id.startsWith('L') ? 'AI-latesale' : 'C-trade',
      patch: p.patch,
      playerRule: p.note,
      newDecision: '（参数搜索点，机制说明见同族 Phase A 候选）',
      whyLoss: '同上',
      whyNotFlatTax: '同上',
      expCompletion: '—',
      expProfitability: '—',
      riskDominance: '—',
      bot: 'EconMasterBot',
      complexity: { stateVars: 1, formulas: 1, buttons: 0 },
    };
    registry.push(v);
    byId.set(v.id, v);
  }
}

export function combo(id: string, label: string, parts: Array<Record<string, unknown>>, rule: string): EconVariant {
  const v: EconVariant = {
    id,
    label,
    family: 'combo',
    patch: merge(...parts),
    playerRule: rule,
    newDecision: '组合：见各组成部分',
    whyLoss: '组合：见各组成部分',
    whyNotFlatTax: '组合：见各组成部分',
    expCompletion: '—',
    expProfitability: '—',
    riskDominance: '叠加后可能出现新的支配策略，必须重跑支配检查',
    bot: 'EconMasterBot',
    complexity: { stateVars: 2, formulas: 2, buttons: 0 },
  };
  if (!byId.has(id)) { registry.push(v); byId.set(id, v); }
  return v;
}

export const ECON_VARIANT_BY_ID: Record<string, EconVariant> = new Proxy(
  {},
  {
    get: (_t, k: string) => byId.get(k),
    has: (_t, k: string) => byId.has(k),
    ownKeys: () => [...byId.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
) as Record<string, EconVariant>;

export function econVariants(): EconVariant[] {
  return registry;
}

export function overrideFor(id: string): string {
  const v = byId.get(id);
  if (!v) throw new Error(`未知候选: ${id}`);
  return JSON.stringify(v.patch);
}
