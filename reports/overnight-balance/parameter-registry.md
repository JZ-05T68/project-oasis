# Project Oasis — 过夜平衡实验 参数注册表

- 实验窗口：2026-09-14 22:00 ~ 2026-09-15 06:00 (UTC+8)
- 生成时间：2026-09-14 22:35
- 起始 HEAD：`f61f377b8bbf87a63b8dc0f92a3e4ccdd48ebd8f`
- 扫描范围：`src` / `tests` / `scripts` / `docs`
- 原则：**本轮不允许出现「改了一个 magic number 但报告里没有记录」**；所有参与自动调优的参数都在此表内，且全部集中在 `src/game/config/gameConfig.ts`。

## 0. 本轮新增的实验基础设施（不改玩法）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 配置覆盖入口 | `src/game/config/gameConfig.ts` `readOverride()` | 只在环境变量 `OASIS_CONFIG_OVERRIDE` 存在时 deep-merge 覆盖；浏览器/生产构建不受影响（无 `process` 时直接返回 null） |
| 实验驱动器 | `scripts/overnight/lab.ts` | workers 默认 4；每分片 120s 看门狗；全局 10min 无进展看门狗 |
| 多目标评分 | `scripts/overnight/score.ts` | Balance Score 公式（见下） |
| 仿真遥测扩展 | `src/simulation/runner.ts` / `metrics.ts` | 新增 `mineSlot / endStamina / endDaysRemaining / oasisVisits / villageVisits / weatherDamageHits / weatherDamageTotal / encounterCount / restCount / waitCount`（纯统计，不参与玩法判定） |
| 硬编码本金收敛 | `src/simulation/runner.ts` | `netProfit` 原写死 `-2000`，改为 `-gameConfig.startCash`（否则改初始资金后净收益全错） |
| UI 数值收敛 | `RulesContent.tsx` / `StartScreen.tsx` / `Settlement.tsx` | 「2000 元 / 42 天 / 8×9」改为读 `gameConfig`，避免改数值后 UI 文案变旧 |

### Balance Score 公式（公示，禁止不透明）

| 分量 | 权重 | 计算方式 |
| --- | --- | --- |
| `reasonableViability` | 30 | ReasonablePlayerBot 胜率在 70%~90% 内得 100；每偏离 1pp 扣 3；成功局 p10 资产 ≤ 本金再扣 25 |
| `strategyDiversity` | 20 | 6 个「合理策略 Bot」中 EV ≥ 最优 75% 的个数 × 20（满分需 5 个）；胜率极差 < 5pp 另扣 20 |
| `economicHealth` | 15 | 成功局中位资产 / 本金落在 1.6~3.2× 得 100，每低 0.1 扣 12、每高 0.1 扣 6；p10 < 1.05× 本金扣 20；WastefulBot EV 未明显低于 ReasonableBot EV 扣 30 |
| `resourceRelevance` | 15 | 帐篷/指南针/绿洲修整/遭遇/天气预报 五项使用率落在 5%~95% 内；每越界一项扣 20 |
| `failureDiversity` | 10 | 任一失败原因占比 > 70% 时扣 (占比-70)×2；> 85% 再扣 15 |
| `mineChoiceBalance` | 10 | 100 − \|Mine A 占比 − 50\| × 2 |
| `exploitPenalty` | 减法 | 退化 Bot（Wasteful/Cheap/Random）EV 排名第一 −20；任一关注 Bot 胜率 ≥ 99.5% −10；CheapBot 胜率高于 ReasonableBot −10 |

关注的 8 个 Bot：ReasonablePlayerBot / CautiousPlayerBot / ShortestPathBot / SafeBot / PreparedBot / GreedyMinerBot / WastefulBot / CheapBot。

## 1. 时间与资源

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `maxDays` | gameConfig.ts:8 | 42 | 38~46 | 总天数上限；天气预报以 maxDays 计价 | 是 |
| `startCash` | gameConfig.ts:34 | 2000 | 1400~2200 | 开局购买力、是否一开局什么都买得起 | 是 |
| `startStamina` | gameConfig.ts:35 | 5 | 4~5 | 起始耐力 | 是（须 ≤ maxStamina） |
| `maxStamina` | gameConfig.ts:36 | 5 | 4~7 | 耐力上限；绿洲修整收益上限 | 是 |
| `gemPerMiningDay` | gameConfig.ts:38 | 2 | 1~3 | 采矿收益速率 | 是 |

## 2. 装备与经济

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `tentPrice` | gameConfig.ts:41 | 400 | 300~800 | 帐篷成本；过低价会让「多买帐篷」无代价 | 是 |
| `tentDesertCharges` | gameConfig.ts:42 | 3 | 2~4 | 每顶帐篷耐久次数 | 是 |
| `compassPrice` | gameConfig.ts:43 | 100 | 80~200 | 指南针成本 | 是 |
| `caravanTentPrice` | gameConfig.ts:45 | 300 | 200~400 | 商队二手帐篷 | 是 |
| `caravanTentCharges` | gameConfig.ts:46 | 3 | 2~3 | 二手帐篷耐久 | 否（低频） |
| `marketDiscountTentPrice` | gameConfig.ts:48 | 320 | 250~400 | 繁荣市集折扣 | 否（低频） |
| `marketDiscountCompassPrice` | gameConfig.ts:49 | 80 | 60~120 | 繁荣市集折扣 | 否（低频） |
| `thiefStealMax` | gameConfig.ts:51 | 300 | 150~500 | 盗贼损失上限 | 是 |
| `workPay` | gameConfig.ts:53 | 500 | 300~800 | 市集打工收益（花 1 天） | 是 |

## 3. 地形与天气

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `terrainProbability.GRASS` | gameConfig.ts:57 | 0.40 | 调整后四者之和必须 = 1.0 | 地形构成 | 是 |
| `terrainProbability.DESERT` | gameConfig.ts:58 | 0.30 | 同上 | 地形构成 | 是 |
| `terrainProbability.VILLAGE` | gameConfig.ts:59 | 0.20 | 同上 | 村庄/遭遇密度 | 是 |
| `terrainProbability.OASIS` | gameConfig.ts:60 | 0.10 | 同上 | 绿洲恢复机会 | 是 |
| `weatherProbability.DESERT.*` | gameConfig.ts:65 | SUNNY .32 / HEAT .30 / SANDSTORM .38 | 三者之和 = 1.0 | 沙漠危险度 | 是 |
| `weatherProbability.GRASS.*` | gameConfig.ts:66 | SUNNY .44 / RAINSTORM .28 / MUD .28 | 之和 = 1.0 | 草地危险度 | 是 |
| `weather.heat.staminaCost` | gameConfig.ts:81 | 1 | 1~2 | 高温硬扛耐力损失 | 是 |
| `weather.sandstorm.staminaCost` | gameConfig.ts:85 | 1 | 1~2 | 沙尘暴无帐篷硬扛损失 | 是 |
| `weather.grassRain.staminaLossWithoutTent` | gameConfig.ts:96 | **2** | **1~3** | **草地暴雨无帐篷耐力损失（本轮重点观察项）** | **是（重点）** |
| `weather.grassRain.destroysTentOnUse` | gameConfig.ts:98 | true | — | 机制开关，本轮不改 | 否 |
| `oasisDroughtChance` | gameConfig.ts:111 | 0.20 | 0.1~0.35 | 绿洲干涸概率 | 是 |

## 4. 遭遇与情报

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `encounter.baseProbability` | gameConfig.ts:104 | 0.35 | 0.20~0.45 | 每普通格遭遇预生成概率 | 是 |
| `encounter.villageThiefRatio` | gameConfig.ts:106 | 0.50 | 0.3~0.7 | 村庄盗贼/市集比例 | 是 |
| `intelRevealRadius` | gameConfig.ts:114 | 2 | 1~3 | 情报揭示半径 | 否（可玩性＞平衡） |

## 5. 天气预报

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `forecast.chargesPerPack` | gameConfig.ts:118 | 3 | 3~6 | 一次购买获得次数（成本 = 1 maxDays/包） | 是 |
| `forecast.autoUseOnPurchase` | gameConfig.ts:121 | 1 | 1~2 | 购买后立即自动使用次数 | 否 |
| `forecast.neighborhoodRadius` | gameConfig.ts:122 | 1 | 1 | 机制范围（单日/局部），不改 | 否 |

## 6. 矿区价值与地形生成

| 参数 | 代码位置 | 22:00 初值 | 允许实验范围 | 影响机制 | 本轮参与自动调优 |
| --- | --- | --- | --- | --- | --- |
| `mineValuation.base` | gameConfig.ts:147 | 140 | 100~180 | 单价截距（难度分 0 对应元/kg） | 是（须 ≥ clampMin） |
| `mineValuation.scale` | gameConfig.ts:148 | 2.0 | 1.5~2.5 | 每 1 点客观难度 = N 元/kg | 是 |
| `mineValuation.clampMin` | gameConfig.ts:149 | 140 | 100~160 | 单价下限（须 ≤ base） | 是 |
| `mineValuation.clampMax` | gameConfig.ts:150 | 320 | 260~380 | 单价上限 | 是 |
| `mineValuation.riskFloor` / `riskCeil` | gameConfig.ts:152-153 | 0.5 / 10 | 不动 | 权重化边界 | 否 |
| `mineValuation.jitterMin` / `jitterMax` | gameConfig.ts:155-156 | 0.9 / 1.1 | 0.85~1.15 | 品质扰动 | 是 |
| `map.mineBottomForbiddenRows` | gameConfig.ts:22 | 2 | 1~3 | 矿区禁止行（城市仍在左下） | 是 |
| `map.mineMinRowGap` | gameConfig.ts:28 | 3 | 2~4 | 两矿最小行距 | 是 |
| `map.rows` / `map.cols` | gameConfig.ts:16-17 | 8 / 9 | **不动** | 本轮真人试玩测试尺寸，属规则级 | 否 |
| `map.maxRetries` | gameConfig.ts:30 | 200 | 不动 | 生成重试 | 否 |

## 7. 结算与路线评分（仅显示/统计）

| 参数 | 代码位置 | 22:00 初值 | 本轮参与 |
| --- | --- | --- | --- |
| `starThresholds` | gameConfig.ts:160 | [12, 40, 85, 115] | 否（星级展示） |
| `tileRisk.*` | gameConfig.ts:163-170 | DESERT 4.5 / GRASS 7.0 / VILLAGE −3.5 / OASIS −2.5 | 否（仅供统计，不影响售价） |
| `slackComfortDays` / `slackPenaltyPerDay` | gameConfig.ts:173-175 | 12 / 1.5 | 否 |
| `scarcityPenaltyByPathCount` | gameConfig.ts:178 | [10, 6, 3, 0] | 否 |
| `returnPathSearchLimit` | gameConfig.ts:180 | 8 | 否 |
| `logLimit` | gameConfig.ts:183 | 120 | 否 |

## 8. 已发现但仍硬编码（本轮**未**参与自动调优，列入 Next Stage）

这些数值在 `src/game/engine/engine.ts` 中以字面量出现（多数为 1），本轮**不新增机制、不新增参数**，只记录：

| 数值 | 位置 | 值 | 说明 |
| --- | --- | --- | --- |
| 泥沼额外天数 | engine.ts:488 `addDays(s, 1)` | +1 天 | 任务书允许调「泥沼天数」，但当前未集中到 gameConfig |
| 追贼额外天数 | engine.ts:1121 `addDays(s, 1)` | +1 天 | 同上 |
| 绿洲修整天数成本 | engine.ts:810 `addDays(s, 1)` | +1 天 | 同上 |
| 绿洲修整耐力恢复 | engine.ts:813 `stamina + 1` | +1 | 任务书允许调「绿洲恢复量」，当前未集中 |
| 停留（WAIT）天数 | engine.ts:923 `addDays(s, 1)` | +1 天 | 同上 |
| 市集打工天数 | engine.ts:1094 `addDays(s, 1)` | +1 天 | 同上 |

> 本轮不做这些集中化，理由：它们各自只出现一次（不算「散落硬编码」），改动会触及引擎主流程，风险高于收益。建议下一阶段先补回归测试再集中。

## 9. 本轮**禁止**触碰（机制级）

- 地图 8×9、城市左下、双矿最右列、四方向移动、去返程普通格不可重复
- 帐篷逐顶耐久管理、玩家自行选择具体帐篷、草地暴雨「用帐篷则整顶报废」
- 天气预报「单日 / 局部 / 可储存 / 只预报自然天气」
- 宝石价格「成功返城后才公布」「只按客观最短合法往返方案计价」
- 耐力归零失败、后台提前判负
- 不新增/删除任何机制、地形、装备、Encounter 类型、天气类型
