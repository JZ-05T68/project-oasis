# Harness Check —— Outcome & Mechanism Expansion Lab（Phase 0）

- 时间：2026-09-15T12:14:47.664Z
- 耗时：622.4s
- 样本：300 Seed/Bot，机制 BASE / E1 / E2 / E3 / F1 / G1 / H1，Bot 6 个
- 结论：**全部通过，可以开始机制实验**

| 检查 | 名称 | 结果 | 详情 |
|---|---|---|---|
| H1 | 确定性（同 Bot + 同 Seed 两次运行逐位一致） | ✅ PASS | 40 个 Seed 全部逐位一致 |
| H2 | 共享 Seed：世界只由 Seed 决定（不同 Bot 同 Seed = 同一张图） | ✅ PASS | outcome:0: A@1:8=230,B@4:8=175 | outcome:1: A@0:8=192,B@3:8=220 | outcome:7: A@4:8=298,B@1:8=164 |
| H3 | FairView 纯净性：不含未来天气表 / 遭遇表 / 干涸表 / RNG 状态 | ✅ PASS | FairView 顶层键：seed, day, maxDays, daysRemaining, phase, position, cash, stamina, maxStamina, tents, compasses, gemsKg, forecastCharges, forecastPackPrice, forecastChargesPerPack, forecastAutoUseOnPurchase, forecastPacks, forecastSpent, mineEntranceId, gemPrice, routeScore, rules, visitedOutbound, visitedReturn, explored, intelKnown, oasisRestUsed, knownOasisDrought, map, weatherToday, lastForecast, legalMoves, availableActions, pendingEvent |
| H5 | Bot 动作合法性：全部 Bot × 全部机制 × 300 Seed 无运行错误（非法动作会抛错） | ✅ PASS | 7 机制 × 6 Bot × 300 局 = 12600 局，errors = 0 |
| H6 | 机制真的生效（每个 v0.2.0 机制都有非零行为痕迹） | ✅ PASS | <br>| 机制 | 探查点 | 生效 | 证据 |<br>|---|---|---|---|<br>| E1 | 返程情报揭示 > 0 格 | ✅ | 平均揭示 0.83 格 |<br>| E2 | 环形勘察揭示 > 0 格 | ✅ | 平均揭示 1.66 格 |<br>| E3 | 侦察消耗指南针 | ✅ | 有情报揭示的局 79.0% |<br>| F1 | 村庄服务被使用 | ✅ | 使用率 89.0%，平均花费 354 元 |<br>| G1 | 深层采矿被使用 | ✅ | 使用率 98.7%，平均额外 3.95kg |<br>| H1 | 求援被使用 | ✅ | 使用率 28.0%，平均花费 112 元 | |
| H4 | Bot 真的读取机制信息（OutcomeMasterBot vs 同骨架屏蔽组，动作必须出现差异） | ✅ PASS | <br>| 机制 | 动作改变率% | aware 完成率 | blind 完成率 | aware 盈利率 | blind 盈利率 |<br>|---|---|---:|---:|---:|---:|<br>| BASE | 85.3% | 80.67 | 64.67 | 80.67 | 64.67 |<br>| E1 | 85.0% | 81 | 64.67 | 81 | 64.67 |<br>| E2 | 85.0% | 81 | 64.67 | 81 | 64.67 |<br>| E3 | 84.7% | 79.33 | 64.67 | 79.33 | 64.67 |<br>| F1 | 97.7% | 76.33 | 64.67 | 76.33 | 64.67 |<br>| G1 | 99.7% | 80 | 64.67 | 79.33 | 64.67 |<br>| H1 | 89.7% | 73 | 64.67 | 73 | 64.67 | |
| H8 | 配对比较成立（全部候选与基线同 Seed，配对样本量 = seeds） | ✅ PASS | <br>| 机制 | 配对局数 | 结果 |<br>|---|---:|:---:|<br>| E1 | 300/300 | ✅ |<br>| E2 | 300/300 | ✅ |<br>| E3 | 300/300 | ✅ |<br>| F1 | 300/300 | ✅ |<br>| G1 | 300/300 | ✅ |<br>| H1 | 300/300 | ✅ | |

## 装置说明

- 全部候选 / 全部 Bot 共用同一批 Seed（前缀 `outcome`，`outcome:<i>`）→ 逐局配对比较成立（§35）。
- Decision Change 的分母 = 同 Bot + 同 Seed 的 BASE 结果。
- Bot 只拿 FairView；机制参数通过 `view.rules.*` 以「规则书」形式公开，不含任何隐藏信息。
- `OutcomeMasterBot` 与 `OutcomeBlindBot` 同骨架、同装备、同事件策略，唯一区别是永远看不到 v0.2.0 机制参数。
- Outcome 口径：`expeditionCompleted = VICTORY && miningDays > 0 && stamina > 0`；
  `profitable = netProfit > 0`，而 `netProfit = finalCash − 2000`，剩余装备**不计虚拟残值**（§2/§39）。

