# Project Oasis · 绿洲计划

一款原创的**回合制沙漠商队策略游戏**（v0.1.2b）。

你携带 **2000 元** 从城市出发，穿越沙漠与草地，抵达远方的宝库矿区，
自行决定挖矿天数，再沿一条**不重复**的路线返回城市——整个旅程必须在 **42 天** 内完成。

核心体验：**路线规划 + 时间管理 + 风险管理 + 信息价值 + 装备管理 + 贪心决策。**

## 快速开始

```bash
npm install
npm run dev       # 启动开发服务器（默认 http://localhost:5173）
```

Windows 一键启动：双击 `START_PROJECT_OASIS.bat`（自动选择可用端口 + 自动打开浏览器）。

```bash
npm test                       # 运行全部自动测试（Vitest）
npm run build                  # 类型检查 + 生产构建
npm run sim -- --runs 3000     # 平衡仿真（多进程并行）
npx tsx scripts/economy-calibrate.ts --runs 3000   # 宝石经济标定扫描
bash scripts/run-browser-audit.sh                  # 浏览器逐按钮点击审计（需先启动 dev server）
```

## 玩法概览

- **地图**：8×9 随机格子地图（72 格）。城市固定在**左下角 (7,0)**，两个矿区固定在**最右列**，
  但不会出现在最下方两行（避免远征过短）。同一 Seed 生成完全相同的地图。
- **去程**：从城市出发，普通格子不可重复经过，抵达任一矿区即进入采矿阶段。
- **采矿**：矿区安全无天气，每天挖矿获得 2kg 宝石，何时收手由你决定。
- **返程**：不得经过任何去程走过的普通格，从同一个矿区沿全新路线回城。
- **帐篷**：每顶帐篷有独立编号（`tent-001`…）与独立耐久，用哪一顶**永远由你选择**；
  草地暴雨会把被选中的那顶**整顶报废**。
- **天气**：沙漠有高温 / 沙尘暴，草地有暴雨 / 泥沼。天气预报包用「最大旅程天数 -1」换 3 次单日局部预报。
- **结算**：宝石单价**全程保密**，成功返城后做最终鉴定才公布；
  单价基数只由该矿区「最短合法往返方案」的客观危险程度决定，
  你实际怎么走、受多少伤都改变不了鉴定结果。

详细规则见 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)，架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 技术栈

- Vite + React 19 + TypeScript（UI 层）
- 纯 TypeScript 游戏引擎（与 UI 完全分离，全部逻辑可测试、可复现）
- Vitest（190+ 条引擎/经济/仿真规则测试）
- 所有随机内容由局内 Seed 驱动：同 Seed + 同操作序列 = 完全相同的结果

## 目录结构

```
project-oasis/
├─ src/game/        # 游戏引擎（纯 TypeScript，不依赖 React）
│  ├─ engine/       # 对外 API：createNewGame / performMove / performAction ...
│  ├─ rules/        # 移动、天气、遭遇、路线评分、结算等规则
│  ├─ map/          # 固定世界地图
│  ├─ random/       # 可复现随机数（seeded RNG）
│  ├─ config/       # 全部可调数值（gameConfig）
│  └─ types/        # 类型定义
├─ src/components/  # React UI 组件
├─ src/pages/       # 页面入口
├─ src/styles/      # 样式
├─ tests/           # 引擎自动测试
├─ docs/            # 设计文档 / 架构文档 / 开发日志
└─ public/          # 静态资源
```

## 许可证

本项目代码以 [MIT License](LICENSE) 发布。

### 第三方依赖许可证

| 依赖 | 用途 | 许可证 |
| --- | --- | --- |
| react / react-dom | UI 框架 | MIT |
| vite | 构建工具 | MIT |
| @vitejs/plugin-react | Vite React 插件 | MIT |
| typescript | 类型系统 | Apache-2.0 |
| vitest | 测试框架 | MIT |
| @types/react / @types/react-dom | 类型声明 | MIT |

游戏内所有美术均为 CSS/SVG 几何图形自绘，系统字体，无任何第三方素材，不含任何商业游戏 IP 内容。
