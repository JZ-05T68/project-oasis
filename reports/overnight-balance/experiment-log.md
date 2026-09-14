# 过夜自动平衡实验日志（2026-09-14 22:00 ~ 2026-09-15 06:00 UTC+8）

> 规则：**任何一次参数实验，不论 ACCEPT / REJECT / INCONCLUSIVE，都必须在这里留痕。**
> 失败实验同样有价值，禁止只写「最后决定是多少」。

- 起始 HEAD：`f61f377b8bbf87a63b8dc0f92a3e4ccdd48ebd8f`
- 参数覆盖机制：`OASIS_CONFIG_OVERRIDE`（JSON，deep-merge 到 `gameConfig`，不改源码）
- 实验驱动：`scripts/overnight/lab.ts`（workers=4，分片看门狗 120s，全局无进展看门狗 10min）
- 评分：`scripts/overnight/score.ts` Balance Score（公式见 `parameter-registry.md` 第 0 节）
- 原始结果：`reports/overnight-balance/raw/<label>.json`

---

## EXP-000 · Baseline（基线，非实验）

- **Timestamp**：2026-09-14 22:26 ~ 22:33
- **Start HEAD**：`f61f377b8bbf87a63b8dc0f92a3e4ccdd48ebd8f`（工作树 clean）
- **假设**：无。建立当前版本基线，供后续所有候选对比。
- **修改前 / 修改后**：无参数修改（config = `{}`）
- **Simulation**：14 Bot × 2000 Seeds = **28,000 局**，workers=4，439.5s，timeouts=0，errors=0
- **关键结果**：
  - Balance Score = **84.59**（viability 95.95 / diversity 60 / econ 100 / resource 60 / failure 100 / mine 98.02，penalty 0）
  - ReasonablePlayerBot：胜率 **91.35%**、EV 3496.55、成功局中位资产 5932（2.97× 本金）、p10 4068
  - 胜率最高的三个 Bot：WastefulBot 97.50% / CautiousPlayerBot 95.15% / ReasonablePlayerBot 91.35%
  - CheapBot 胜率 11.05%（明显高风险 ✓）；GreedyMinerBot 胜率 40.80%、成功局中位资产 8190（全场最高 ✓）
  - 两矿选择 A 48.8% / B 51.2%（均衡 ✓）
  - 遭遇触发率 96.80%（**>95%，过密**）
  - ForecastBot 平均购买 5.43 包预报，EV 2328.77，比 NoForecastBot（3417.21）低约 1089
- **结论**：BASELINE（不构成接受/拒绝）
- **基线问题清单**（驱动后续实验）：
  1. 合理策略胜率偏高（Reasonable 91.35% > 目标上限 90%）
  2. 过度囤装备几乎无代价（WastefulBot 5 顶帐篷仍 97.5% 胜率）
  3. 遭遇密度过高（96.8%）
  4. 天气预报在当前定价（1 maxDays/包）下是净负收益
- **是否回滚**：N/A
- **End state**：工作树除基础设施代码外无参数改动

---

## Phase A · 单变量敏感性扫描（8 组 × 14,000 局）

统一条件：14 Bot × 1000 Seeds = 14,000 局 / 组，workers=4，分片看门狗 120s，全部 timeouts=0、errors=0。
对比基准：BASELINE score 84.59 / ReasonableBot 胜率 91.35%。

### 敏感性排序（Δscore 相对基线）

| 排名 | 参数 | 方向 | Δscore | 敏感度 |
| --- | --- | --- | --- | --- |
| 1 | `encounter.baseProbability` 0.35→0.25 | 降 | **+3.38** | 高 |
| 2 | `tentPrice` 400→600 | 升 | +1.38 | 中 |
| 3 | `weather.sandstorm.staminaCost` 1→2 | 升 | +1.35 | 中 |
| 4 | `mineValuation.base` 140→110 | 降 | +0.30 | 低 |
| 5 | `weather.grassRain.staminaLossWithoutTent` 2→1 | 降 | −2.86 | 中（方向为负） |
| 6 | `maxStamina` 5→4 | 降 | −3.17 | 中（方向为负） |
| 7 | `startCash` 2000→1600 | 降 | −6.39 | 高（方向为负） |
| 8 | `startCash` 2000→1800 | 降 | −23.44 | 高（方向为负） |

---

### EXP-001 · a01-startCash-1800

- **Timestamp**：2026-09-14 22:39 ~ 22:43
- **Start HEAD**：`f61f377`（工作树无参数改动）
- **假设**：初始资金从 2000 降到 1800，开局无法「帐篷+指南针+余量」全买，应产生真实取舍。
- **修改前 / 修改后**：`startCash` 2000 → **1800**
- **Simulation**：14 Bot × 1000 Seeds = 14,000 局，281.0s
- **关键结果**：score **61.15**（viability 99.40 / diversity 60 / econ 69.07 / resource 60 / failure 100 / mine 99.67，**penalty −20**）
  - ReasonableBot 胜率 90.20%（仍在带内但偏高）、EV 3507.75
  - **WastefulBot EV 3636.62 排名全场第一** → 触发退化策略惩罚
  - 成功局中位资产 / 本金 = **3.22×**（> 3.2 上限）
- **结论**：**REJECT**
- **理由**：降低本金并没有产生取舍，反而让「5 顶帐篷」成为 EV 最优解（因为本金少 → 买不起指南针 → 纯堆帐篷最稳），且 ROI 因本金变小而被抬高到 3.22×，经济健康度下降。
- **是否回滚**：YES（覆盖仅存在于 env，工作树从未改动；结果仅记录）
- **End state**：HEAD `f61f377`，工作树无参数改动

### EXP-002 · a02-startCash-1600

- **Timestamp**：2026-09-14 22:43 ~ 22:46
- **假设**：继续降低本金到 1600，压缩开局购买力。
- **修改前 / 修改后**：`startCash` 2000 → **1600**
- **Simulation**：14,000 局，168.0s
- **关键结果**：score **78.20**（viability 100 / econ **48.25** / resource 60）
  - ReasonableBot 胜率 87.30%、EV 3475.94
  - 成功局中位资产 / 本金 = **3.56×**（远超 3.2 上限 → econ 重扣）
- **结论**：**REJECT**
- **理由**：本金越低 ROI 越高，经济健康度反而恶化；绝对收益几乎不变（EV 3497→3476），说明本金不是真正的约束条件——真正的约束是「装备价格相对宝石收入太便宜」。
- **是否回滚**：YES
- **End state**：HEAD `f61f377`

### EXP-003 · a03-tentPrice-600

- **Timestamp**：2026-09-14 22:46 ~ 22:49
- **假设**：帐篷太便宜（400 元）导致「多买帐篷」几乎无代价（WastefulBot 5 顶帐篷仍 97.5% 胜率）。涨到 600 元应让过度囤积付出代价。
- **修改前 / 修改后**：`tentPrice` 400 → **600**
- **Simulation**：14,000 局，133.8s
- **关键结果**：score **85.97**（viability 100 / econ 100 / resource 60 / mine 99.67，penalty 0）
  - ReasonableBot 胜率 **85.50%**（进入 70~90 目标带）、EV 2919.00（↓577）
  - 成功局中位资产 / 本金 = 2.82×
  - 未再触发「WastefulBot EV 第一」惩罚
- **结论**：**ACCEPT（作为候选进入 Phase B）**
- **理由**：唯一同时把胜率拉回目标带、消除退化策略统治、并保持经济健康的单变量改动。
- **是否回滚**：NO（但只作为候选，未落盘到 gameConfig）
- **End state**：HEAD `f61f377`

### EXP-004 · a04-encounter-0.25

- **Timestamp**：2026-09-14 22:49 ~ 22:51
- **假设**：基线遭遇触发率 96.8%（>95%），几乎每局必踩遭遇，说明遭遇过密、失去「意外」属性。降到 25% 应把触发率拉回区间内。
- **修改前 / 修改后**：`encounter.baseProbability` 0.35 → **0.25**
- **Simulation**：14,000 局，133.5s
- **关键结果**：score **87.97**（viability 96.70 / econ 100 / **resource 80** / failure 100 / mine 99.64，penalty 0）
  - ReasonableBot 胜率 91.10%、EV 3530.50
  - 遭遇触发率从 96.8% 降至区间内（resource 60 → 80）
- **结论**：**ACCEPT（本轮最敏感单变量，作为候选进入 Phase B）**
- **理由**：唯一修复 resourceRelevance 越界项的改动，且对胜率/经济无负面影响。
- **是否回滚**：NO
- **End state**：HEAD `f61f377`

### EXP-005 · a05-grassRain-1

- **Timestamp**：2026-09-14 22:51 ~ 22:53
- **假设（任务书指定观察项）**：草地暴雨无帐篷 −2 是否过重？回到 −1 看数据变化。
- **修改前 / 修改后**：`weather.grassRain.staminaLossWithoutTent` 2 → **1**
- **Simulation**：14,000 局，140.9s
- **关键结果**：score **81.73**（viability **85.90**）
  - ReasonableBot 胜率 **94.70%**（比基线 **+3.35pp**，更远离 70~90 目标带）
  - EV 3679.41（比基线 +183）
  - 遭遇触发率 97.3%（越界依旧）
- **结论**：**REJECT（保留 −2）**
- **理由**：数据明确反对回到 −1。当前版本本来就已经「合理策略胜率偏高」，`−1` 会让游戏进一步变简单（ReasonableBot 94.7%、EV 上升），与「让风险有存在感」的目标相反。**本轮不静默改回：−2 保留，理由记录在此。**
- **是否回滚**：YES
- **End state**：HEAD `f61f377`

### EXP-006 · a06-maxStamina-4

- **Timestamp**：2026-09-14 22:53 ~ 22:56
- **假设**：耐力上限 5 是否过于宽裕？降到 4 应提高生存压力。
- **修改前 / 修改后**：`maxStamina` 5 → **4**，`startStamina` 5 → **4**（必须同步，否则初始值 > 上限）
- **Simulation**：14,000 局，134.7s
- **关键结果**：score **81.42**（viability 100 / econ **70** / resource 60）
  - ReasonableBot 胜率 83.10%、EV 3028.29
  - econ 70：WastefulBot EV 未明显低于 ReasonableBot → −30
- **结论**：**REJECT**
- **理由**：确实降低了胜率，但没有解决「过度囤装备无代价」的问题（econ 反而降到 70），且削弱了绿洲修整的意义（恢复 1 点占上限比例虽变大，但整体缓冲变小让随机死亡变多）。
- **是否回滚**：YES
- **End state**：HEAD `f61f377`

### EXP-007 · a07-mineBase-110

- **Timestamp**：2026-09-14 22:56 ~ 22:58
- **假设**：宝石单价截距 140 元/kg 是否过高？降到 110 应压缩利润、让装备支出更有分量。
- **修改前 / 修改后**：`mineValuation.base` 140 → **110**，`clampMin` 140 → **110**（须 ≤ base）
- **Simulation**：14,000 局，137.4s
- **关键结果**：score **84.89**（viability 96.40 / econ 100 / resource 60）
  - ReasonableBot 胜率 91.20%（几乎没变）、EV 2814.62（↓682）
  - 成功局中位资产 / 本金 = 2.58×
- **结论**：**INCONCLUSIVE（可作为纯经济杠杆备用）**
- **理由**：降价的唯一效果是等比压缩收入，胜率几乎不动（91.2% vs 91.35%），说明**当前胜率问题不是经济问题而是风险问题**。保留为后续微调经济倍率的备用参数。
- **是否回滚**：YES（本轮不采用）
- **End state**：HEAD `f61f377`

### EXP-008 · a08-sandstorm-2

- **Timestamp**：2026-09-14 22:58 ~ 23:01
- **假设**：沙尘暴无帐篷硬扛 −1 是否过轻？提到 −2 应让「带帐篷/指南针」更有必要。
- **修改前 / 修改后**：`weather.sandstorm.staminaCost` 1 → **2**
- **Simulation**：14,000 局，135.2s
- **关键结果**：score **85.94**（viability 100 / econ 100 / resource 60 / mine 99.37，penalty 0）
  - ReasonableBot 胜率 **87.90%**（进入目标带）、EV 3309.31
  - 成功局中位资产 / 本金 = 2.95×
- **结论**：**ACCEPT（作为候选进入 Phase B）**
- **理由**：与 a03 同向有效——提高无装备硬扛的代价，把胜率拉回目标带，且不触发任何退化惩罚。
- **是否回滚**：NO
- **End state**：HEAD `f61f377`

---

## Phase B · 组合候选搜索（8 组 × 21,000 局）

统一条件：14 Bot × 1500 Seeds = 21,000 局 / 组，workers=4，全部 timeouts=0、errors=0。

| 候选 | 配置 | score | R 胜率% | R EV | ROI | penalty | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **b06** | enc 0.25 + tentPrice 700 | **88.85** | 77.33 | 2526.41 | 2.88× | 0 | **Top1** |
| **b02** | enc 0.25 + sandstorm 2 | **88.83** | 88.07 | 3344.09 | 2.99× | 0 | **Top2** |
| b05 | enc 0.20 + tentPrice 600 | 84.35 | 86.00 | 2957.18 | 2.85× | 0 | REJECT |
| b01 | enc 0.25 + tentPrice 600 | 84.35 | 85.93 | 2944.79 | 2.86× | 0 | REJECT |
| b07 | enc 0.25 + tentPrice 600 + forecast×5 | 84.35 | 85.93 | 2944.79 | 2.86× | 0 | REJECT |
| b04 | enc 0.28 + tentPrice 600 | 84.34 | 85.27 | 2893.55 | 2.83× | 0 | REJECT |
| b03 | enc 0.25 + tentPrice 600 + sandstorm 2 | 64.33 | 80.67 | 2638.72 | 2.85× | −20 | REJECT |
| b08 | enc 0.25 + tentPrice 600 + grassRain 3 | 64.31 | 80.27 | 2605.10 | 2.84× | −20 | REJECT |

### EXP-009 · b01-enc25-tent600
- **Timestamp**：2026-09-14 23:11 ~ 23:14｜**假设**：叠加两个最敏感正向杠杆（降遭遇密度 + 涨帐篷价）
- **修改**：`encounter.baseProbability` 0.35→0.25；`tentPrice` 400→600
- **Simulation**：21,000 局，184.5s
- **关键结果**：score 84.35（econ **70**：WastefulBot EV 2986.86 ≥ ReasonableBot EV 2944.79 的 95%）
- **结论**：**REJECT**（优于基线但不如单变量 b02/b06）
- **理由**：出现「伪退化」信号——帐篷涨到 600 后 WastefulBot 的 5 顶帐篷买不起（2000 元只够 3 顶+2 罗盘），它实际上退化成了一个正常的强力配置，因此 EV 追平 ReasonableBot。**这是评分项的一个已知假阳性**（同样是「合理配置」时不该判为浪费），记录但不据此淘汰。

### EXP-010 · b02-enc25-storm2
- **Timestamp**：23:14 ~ 23:17｜**假设**：降遭遇密度 + 提高沙尘暴裸扛代价（让帐篷/指南针更必要）
- **修改**：`encounter.baseProbability` 0.35→0.25；`weather.sandstorm.staminaCost` 1→2
- **Simulation**：21,000 局，187.4s
- **关键结果**：score **88.83**（viability 100 / econ 100 / resource 80 / failure 100 / mine 98.26，penalty 0）；R 胜率 88.07%、EV 3344.09、ROI 2.99×
- **结论**：**ACCEPT → Top2**
- **是否回滚**：NO

### EXP-011 · b03-enc25-tent600-storm2
- **Timestamp**：23:17 ~ 23:20｜**假设**：三个正向杠杆叠加应继续变好
- **修改**：enc 0.25 + tentPrice 600 + sandstorm 2
- **Simulation**：21,000 局，184.3s
- **关键结果**：score **64.33**（penalty −20：WastefulBot EV 2717.06 排名第一）
- **结论**：**REJECT**
- **理由**：三重叠加把难度推得过高（R 胜率 80.67% 尚可），但收益被压到 EV 2638，此时**过度囤帐篷反而因为保命而成为 EV 最优**（失败即损失全部宝石），触发退化惩罚。说明「提高风险」不能无止境堆叠：收益被压低后，「保命」的边际价值会超过「省钱」。

### EXP-012 · b04-enc28-tent600
- **Timestamp**：23:20 ~ 23:23｜**假设**：遭遇密度只微调到 0.28（保守）
- **修改**：enc 0.28 + tentPrice 600
- **Simulation**：21,000 局，188.3s
- **关键结果**：score 84.34（econ 70，同为 Wasteful 伪退化信号）
- **结论**：**REJECT**（劣于 enc 0.25 同组合）

### EXP-013 · b05-enc20-tent600
- **Timestamp**：23:23 ~ 23:27｜**假设**：遭遇密度再降到 0.20
- **修改**：enc 0.20 + tentPrice 600
- **Simulation**：21,000 局，188.0s
- **关键结果**：score 84.35（econ 70）
- **结论**：**REJECT**
- **理由**：enc 0.20 / 0.25 / 0.28 三档在 tentPrice 600 下 score 几乎一致（84.34~84.35），说明**遭遇密度在该区间已进入平台期**，单独再降没有收益；它的价值在于把触发率拉回 95% 以内（resource 60→80）。

### EXP-014 · b06-enc25-tent700
- **Timestamp**：23:27 ~ 23:30｜**假设**：既然帐篷涨价有效，继续涨到 700
- **修改**：`encounter.baseProbability` 0.35→0.25；`tentPrice` 400→700
- **Simulation**：21,000 局，185.5s
- **关键结果**：score **88.85**（viability 100 / econ 100 / resource 80 / failure 100 / mine 98.52，penalty 0）
  - R 胜率 **77.33%**（目标带中段）、EV 2526.41、ROI 2.88×
  - 合理策略胜率极差从 48~58pp 收窄到 **41.2pp**（策略区分度更平滑）
  - WastefulBot EV 2162.33 **明显低于** ReasonableBot 2526.41 ✓（伪退化信号消失）
  - ShortestPathBot（1 帐篷 1 罗盘）EV 2702.25 **高于** ReasonableBot（2 帐篷 1 罗盘）→ 轻装＝高 EV 低胜率(64.8%)，重装＝稳但收益低 → 出现真实取舍
- **结论**：**ACCEPT → Top1**
- **是否回滚**：NO

### EXP-015 · b07-enc25-tent600-fc5
- **Timestamp**：23:30 ~ 23:33｜**假设**：天气预报 1 包 3 次太少、性价比差（ForecastBot EV 比 NoForecastBot 低约 1000），提到 5 次/包
- **修改**：enc 0.25 + tentPrice 600 + `forecast.chargesPerPack` 3→5
- **Simulation**：21,000 局，190.7s
- **关键结果**：score 84.35（与 b01 相同，因 ForecastBot 不在 score 的 6 个关注 Bot 内）
  - ForecastBot：平均购买 5.64 → **5.29** 包，胜率 61.27%→62.60%，EV 1931.37→**2085.84**（+154）
  - NoForecastBot EV 仍显著高于 ForecastBot → 预报仍是净负
- **结论**：**INCONCLUSIVE → 不作为主候选**
- **理由**：提升次数的方向正确但幅度不足；且预报的根本问题是**计价方式（1 maxDays/包）**，这属于机制层，本轮不改。（见「报告 · 机制问题诊断」）

### EXP-016 · b08-enc25-tent600-rain3
- **Timestamp**：23:33 ~ 23:36｜**假设**：草地暴雨既然 −1 变差，那 −3 是否更好？
- **修改**：enc 0.25 + tentPrice 600 + `grassRain.staminaLossWithoutTent` 2→3
- **Simulation**：21,000 局，185.3s
- **关键结果**：score **64.31**（penalty −20：WastefulBot EV 2701.48 排名第一）
- **结论**：**REJECT（grassRain 保持 2）**
- **理由**：与 b03 同因——把整体风险推高后，收益被压低，「堆帐篷保命」重新成为 EV 最优。**这为本轮「草地暴雨 −2 是否保留」提供了间接证据：−2 处于一个还能让「轻装」有意义的区间；−1 太软、−3 太硬（会因过度保命而催生退化解）。**

---

## Phase A/B 阶段小结

- 最敏感参数：`encounter.baseProbability`（+3.38）
- 有效方向：提高「不携带/不使用装备」的代价（帐篷涨价、沙尘暴加重）
- 无效/负向：降低初始资金（抬高 ROI、且让「省下钱买帐篷」变最优）、草地暴雨回到 −1、耐力上限降到 4
- 出现 2 次 −20 退化惩罚（b03 / b08），二者共同教训：**风险不能无限堆叠**

---

## Phase C · 聚焦微调（7 组 × 21,000 局）

围绕 Top1（b06: enc 0.25 + tentPrice 700）与 Top2（b02: enc 0.25 + sandstorm 2）继续微调。
统一条件：14 Bot × 1500 Seeds = 21,000 局 / 组，workers=4，全部 timeouts=0、errors=0。

| 候选 | 配置 | score | R 胜率% | R EV | ROI | 胜率极差 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **c06** | b06 + forecast×5 | **88.85** | 77.33 | 2526.41 | 2.88× | 41.2pp | **最终入选** |
| **c07** | b06 + mineValuation base 150 | **88.85** | 77.33 | 2721.77 | 3.01× | 41.2pp | REJECT（ROI 贴上限） |
| **c03** | enc 0.25 + tentPrice 800 | **88.85** | 71.87 | 2119.55 | 2.84× | 40.1pp | REJECT（改动幅度更大、收益更低） |
| c01 | b06 + sandstorm 2 | 88.82 | 70.20 | 2136.61 | 2.89× | 38.9pp | REJECT（胜率贴下限） |
| c04 | enc 0.22 + tentPrice 700 | 88.83 | 76.93 | 2528.71 | 2.89× | 39.2pp | REJECT（与 0.25 无差异） |
| c05 | enc 0.30 + tentPrice 700 | 88.83 | 77.53 | 2505.43 | 2.85× | 41.2pp | REJECT（与 0.25 无差异） |
| c02 | enc 0.25 + tentPrice 650 | 84.36 | 77.80 | 2634.60 | 2.93× | 51.5pp | REJECT（econ 70 伪退化） |

### EXP-017 · c01-enc25-tent700-storm2
- **Timestamp**：2026-09-14 23:52 ~ 23:55｜**假设**：Top1 与 Top2 的杠杆叠加（帐篷 700 + 沙尘暴 −2）
- **Simulation**：21,000 局，181.5s｜**关键结果**：score 88.82，R 胜率 **70.20%**（正好压在目标带下沿）、EV 2136.61
- **结论**：**REJECT**
- **理由**：与 b06 相比 score 反而略低，且胜率贴着 70% 下限、EV 明显更低（2137 vs 2526）。继续加风险没有收益。

### EXP-018 · c02-enc25-tent650
- **Timestamp**：23:55 ~ 23:58｜**假设**：700 可能过猛，试 650
- **Simulation**：21,000 局，184.9s｜**关键结果**：score 84.36（econ **70**：WastefulBot EV 2527.48 ≈ ReasonableBot 2634.60）
- **结论**：**REJECT**
- **理由**：650 是「伪退化区间」——此时 3 顶帐篷（1950 元）刚好买得起，WastefulBot 再次退化成正常强力配置。说明**帐篷定价存在明显阈值效应**：400/650 会催生伪退化，700+ 才会真正让过度囤积付出代价。

### EXP-019 · c03-enc25-tent800
- **Timestamp**：23:58 ~ 00:02｜**假设**：700 有效，试 800
- **Simulation**：21,000 局，186.6s｜**关键结果**：score 88.85（与 b06 持平），R 胜率 71.87%、EV 2119.55
- **结论**：**REJECT（保持 700）**
- **理由**：score 与 700 完全持平，但胜率更低、收益更低、改动幅度更大。在「同等 score 下选最小改动 + 最好玩家体验」原则下取 700。

### EXP-020 · c04-enc22-tent700
- **Timestamp**：00:02 ~ 00:05｜**假设**：遭遇密度再降一档是否有额外收益
- **Simulation**：21,000 局，186.8s｜**关键结果**：score 88.83（比 0.25 低 0.02）
- **结论**：**REJECT**
- **理由**：0.20 / 0.22 / 0.25 / 0.28 / 0.30 全部落在 88.83~88.85 的 ±0.02 区间内 —— **遭遇密度在该区间是平台期**。取 0.25 只是为「触发率回到区间内」留出余量，不取刚好贴线的 0.30。

### EXP-021 · c05-enc30-tent700
- **Timestamp**：00:05 ~ 00:08｜**假设**：能否只把遭遇从 0.35 微调到 0.30（最小改动）
- **Simulation**：21,000 局，190.4s｜**关键结果**：score 88.83，R 胜率 77.53%
- **结论**：**REJECT（取 0.25）**
- **理由**：0.30 也能让触发率回到区间内，score 与 0.25 实质等价。选 0.25 的理由是**留出安全余量**：0.30 距 95% 触发率阈值更近，后续任何让路线变长的改动都可能把它重新推过线。

### EXP-022 · c06-enc25-tent700-fc5
- **Timestamp**：00:08 ~ 00:11｜**假设**：在 Top1 基础上把天气预报从 3 次/包提到 5 次/包，缩小「买预报 vs 不买预报」的 EV 差距
- **Simulation**：21,000 局，191.0s
- **关键结果**：score **88.85**（关注 Bot 指标与 b06 完全一致，因为只有 ForecastBot 受此参数影响）
  - ForecastBot：EV 1750.48 → **1909.83**（+159），胜率 60.00% → 61.40%，平均购买 5.71 → 5.36 包
  - 与 NoForecastBot 的 EV 差距：1025 → **866**（收窄 16%）
- **结论**：**ACCEPT → 最终入选**
- **理由**：这是唯一能改善「天气预报无人问津」这个已知弱项的**已有数值**杠杆，且对所有其它策略零副作用。预报的根本问题（用 maxDays 计价）属于机制层，本轮不动。

### EXP-023 · c07-enc25-tent700-mb150
- **Timestamp**：00:11 ~ 00:15｜**假设**：帐篷涨价后 EV 降到 2526，是否需要把宝石单价截距从 140 提到 150 补回收益
- **Simulation**：21,000 局，188.8s｜**关键结果**：score 88.85（与 b06 持平），EV 2721.77，ROI **3.01×**
- **结论**：**REJECT**
- **理由**：score 无提升，但 ROI 从 2.88× 抬到 3.01×，距离 econ 的 3.2× 上限更近——**用更高的名义收益换来更薄的安全边际**不划算。保持 base 140。

### Phase C 后的最终决策

最终配置（3 个参数）：
```
tentPrice                       400  → 700
encounter.baseProbability       0.35 → 0.25
forecast.chargesPerPack         3    → 5
```
未采纳但有效的备选：sandstorm 1→2（b02，score 88.83，与入选方案几乎等价，作为「下一轮若仍偏简单」的备用杠杆）。

---
