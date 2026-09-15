# Harness Check —— Autonomous Mechanism Evolution Lab（Phase 0）

- 时间：2026-09-15T08:21:12.223Z
- 样本：300 Seed/Bot，机制 BASE / M01 / M03 / M04 / M05 / M07
- 结论：**全部通过，可以开始机制实验**

| 检查 | 名称 | 结果 | 详情 |
|---|---|---|---|
| H1 | 确定性（同 Bot + 同 Seed 两次运行逐位一致） | ✅ PASS | 40 个 Seed 全部逐位一致 |
| H2 | 共享 Seed：世界只由 Seed 决定（不同 Bot 同 Seed = 同一张图） | ✅ PASS | mechlab:0: mines=A@0:8=140,B@3:8=140 | mechlab:1: mines=A@5:8=238,B@2:8=241 | mechlab:7: mines=A@3:8=162,B@0:8=192 |
| H3 | FairView 纯净性：不含未来天气表 / 遭遇表 / 干涸表 / RNG 状态 | ✅ PASS | FairView 顶层键：seed, day, maxDays, daysRemaining, phase, position, cash, stamina, maxStamina, tents, compasses, gemsKg, forecastCharges, forecastPackPrice, forecastChargesPerPack, forecastAutoUseOnPurchase, forecastPacks, forecastSpent, mineEntranceId, gemPrice, routeScore, rules, visitedOutbound, visitedReturn, explored, intelKnown, oasisRestUsed, knownOasisDrought, map, weatherToday, lastForecast, legalMoves, availableActions, pendingEvent |
| H5 | Bot 动作合法性：全部 Bot × 全部机制 × 300 Seed 无运行错误 | ✅ PASS | 6 机制 × 4 Bot × 300 局 = 7200 局，errors = 0 |
| H4 | Bot 真的读取机制信息（AdaptiveMinerBot vs 同骨架但屏蔽机制的对照，采矿天数必须出现差异） | ✅ PASS | <br>| 机制 | 采矿天数改变率% | Adaptive平均采矿 | 屏蔽组平均采矿 | 成功局平均宝石kg |<br>|---|---|---:|---:|---:|<br>| BASE | 1.0% | 14.32 | 14.45 | 29.37 |<br>| M01 | 1.0% | 14.32 | 14.45 | 27.03 |<br>| M03 | 1.0% | 12.12 | 12.25 | 22.42 |<br>| M04 | 28.0% | 10.82 | 11.65 | 16.39 |<br>| M05 | 95.0% | 11.07 | 14.45 | 19.74 |<br>| M07 | 1.0% | 14.32 | 14.45 | 29.25 | |
| H6 | 机制真的生效（每个机制都有非零行为痕迹） | ✅ PASS | <br>| 机制 | 探查点 | 生效 | 证据 |<br>|---|---|---|---|<br>| M01 | 分段递减产量 | ✅ | 成功局平均宝石 27.03kg（BASE 参照另列） |<br>| M03 | 事故率 > 0 | ✅ | 有事故的局 93.7%，事故损失均 2.42kg |<br>| M04 | 事故率 > 0 且带货损 | ✅ | 有事故的局 93.0% |<br>| M05 | 返程负重额外天数 > 0 | ✅ | 负重惩罚额外天数均 2.25 天，丢货局 55.3% |<br>| M07 | 两矿产量倍率生效 | ✅ | MineABot / MineBBot 的宝石量差（见 Phase A） | |

## 装置说明

- 所有候选 / 所有 Bot 共用同一批 Seed（`seedMode=shared`，prefix `mechlab`）→ 逐局配对比较成立。
- Decision Change Rate 的分母 = 同 Bot + 同 Seed 的 baseline（机制全关）结果。
- Bot 只拿 FairView；机制参数通过 `view.rules.*` 以「规则书」形式公开，不含任何隐藏信息。
- `MechanismBlindMinerBot` 与 `AdaptiveMinerBot` 同骨架、同装备、同事件策略，唯一区别是永远看不到机制参数。

