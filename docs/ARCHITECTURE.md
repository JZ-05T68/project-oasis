# Project Oasis 架构文档（v0.1.0）

## 总体原则

1. **游戏核心规则与 React UI 严格分离**：`src/game/**` 是纯 TypeScript 引擎，不 import 任何
   React/DOM 内容；`src/components`、`src/pages` 只调用引擎公开 API，不在组件内实现规则。
2. **确定性**：同一 Seed + 同一操作序列 ⇒ 完全相同的状态与结果。
3. **不可变状态**：所有引擎函数返回新的 `GameState`（内部用 `structuredClone`），
   UI 以整体替换的方式更新状态，刷新/重开不会产生状态污染。
4. **数值配置化**：所有可平衡数值集中在 `src/game/config/gameConfig.ts`。

## 模块划分

```
src/game/
├─ types/       # 全部类型定义（GameState、Map、事件、结算视图等）
├─ config/      # gameConfig：时间、金钱、天气概率、遭遇概率、地形风险系数、定价参数…
├─ random/      # xmur3 字符串散列 + mulberry32 PRNG，封装为可序列化的 rngState
├─ map/         # 固定世界地图（节点、边、坐标、名称）+ 图工具（BFS、路径枚举）
├─ rules/       # 纯规则函数
│  ├─ movement.ts      # 合法移动、visited 管理、合法返程路径搜索
│  ├─ weather.ts       # 天气预生成与天气效果
│  ├─ encounters.ts    # 遭遇预生成与效果（商队/盗贼/市集/牧民）
│  ├─ equipment.ts     # 帐篷/指南针消耗规则
│  ├─ routeScore.ts    # 路线难度评分、星级、宝石定价
│  ├─ reveal.ts        # 情报揭示（路网距离 ≤3 BFS）
│  └─ settlement.ts    # 结算视图计算
└─ engine/
   └─ engine.ts        # 对外唯一入口：编排上述规则模块
```

## 引擎公开 API

```ts
createNewGame(seed, opts?)                     // 开新局（opts 支持测试注入天气/遭遇覆盖）
getLegalMoves(state): string[]                 // 当前合法移动目标（UI 只允许点击这些）
performMove(state, toNodeId): GameState        // 移动 1 格并结算到达链
getAvailableActions(state): ActionInfo[]       // 当前可执行行动（含价格/禁用原因）
performAction(state, action): GameState        // 挖矿/返程/休整/购买
resolvePendingEvent(state, eventId, choice)    // 回答事件 Modal（沙尘暴/暴雨/商队/盗贼/市集/天气预报）
computeSettlement(state): SettlementView       // 胜负结算视图
```

非法操作一律抛出 `GameError`（带错误码），UI 层通过只渲染合法选项来避免触发。

## 回合结算管线（performMove）

```
校验 → daysUsed+1 → visited/explored 更新 → 阶段切换（进矿/回城）
→ 天气效果（可入队沙尘暴/暴雨 Modal 或直接结算高温/泥沼）
→ 遭遇判定（商队/盗贼/市集入队 Modal；牧民直接揭示）
→ 终局检查（超时/耐力/路线中断）
→ finalizeTurn：若无惩罚日/预报日且 daysUsed < 42 → 入队 20:00 天气预报询问
```

`pendingEvents` 是一个队列，UI 逐个弹出；每个选择的结算可能追加后续事件
（例：沙尘暴 Modal 之后接商队 Modal，最后接天气预报询问）。

## 确定性设计

- 开局用 Seed 一次性预生成三张表：`weather[node][day]`、`encounterRolls[node][day]`、
  `oasisDrought[node]`，之后运行期不再为这些内容掷随机数。
- 唯一的运行期随机数是进入矿区时抽取的市场波动系数（0.95~1.05），
  由保存在 `GameState.rngState` 中的 PRNG 状态决定，同样可复现。
- 因此「天气预报看到的是真实未来」、遭遇不依赖操作顺序、结算必然可复现。

## 路线难度评分

进入矿区时：统计去程实际路径的地形风险和；用 DFS 在「避开去程普通格」的约束下枚举
合法返程路径（上限 8 条），取风险最小者计入返程风险，并按路径数施加稀缺惩罚；
时间冗余按 42 天与去返最短天数之差计算。全部系数见 `gameConfig` 与 `docs/GAME_DESIGN.md`。

## 测试策略

- `tests/` 使用 Vitest（node 环境），不依赖浏览器。
- 通过 `createNewGame(seed, { weather, encounters, drought })` 覆盖注入确定性的天气/遭遇，
  无需在测试里碰运气。
- 地图合法性测试：全图连通性 + 「删任意单节点后城市到每个矿区入口仍连通」
  （等价于存在两条内部节点不相交的路径）+ 代表路线评分区间锚定。
- 引擎支持注入自定义迷你地图（自定义地图作为 GameState 一部分），用于构造
  「返程路线中断」等现实地图上难以稳定复现的场景。

## UI 结构

```
src/pages/GamePage.tsx      # 根状态：开始界面 / 对局 / 结算
src/components/StartScreen  # Seed 输入 + 开局
src/components/TopBar       # Day/现金/耐力/帐篷/指南针/宝石/阶段
src/components/MapView      # SVG 地图（迷雾、去返程高亮、合法移动高亮、当前位置）
src/components/SidePanel    # 地点信息/天气/行动按钮/商店/宝库面板/日志
src/components/EventModal   # 事件 Modal（含天气预报询问与结果展示）
src/components/Settlement   # 结算画面
```
