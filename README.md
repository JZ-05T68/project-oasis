# Project Oasis · 绿洲计划

一款原创的**回合制沙漠商队策略游戏**（v0.1.0）。

你携带 **2000 元** 从城市出发，穿越沙漠与草地，抵达远方的宝库矿区，
自行决定挖矿天数，再沿一条**不重复**的路线返回城市——整个旅程必须在 **42 天** 内完成。

核心体验：**路线规划 + 时间管理 + 风险管理 + 信息价值 + 装备管理 + 贪心决策。**

## 快速开始

```bash
npm install
npm run dev       # 启动开发服务器（默认 http://localhost:5173）
```

```bash
npm test          # 运行全部自动测试（Vitest）
npm run build     # 类型检查 + 生产构建
```

## 玩法概览

- **去程**：从城市出发，普通格子不可重复经过，抵达三个矿区入口之一后宝石单价锁定。
- **采矿**：宝库内安全无天气，每天挖矿获得 2kg 宝石，何时收手由你决定。
- **返程**：不得经过任何去程走过的普通格，从同一个矿区入口沿全新路线回城。
- **天气**：沙漠有高温 / 沙尘暴，草地有暴雨 / 泥沼——暴雨会**整顶消耗帐篷**。
- **情报**：花 1 天购买未来 3 天天气预报，但只能看到已知地形的区域。
- **结算**：宝石售价由所走路线的**综合难度评分**动态决定（80～320 元/kg），越危险的路线越值钱。

详细规则见 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)，架构说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 技术栈

- Vite + React 19 + TypeScript（UI 层）
- 纯 TypeScript 游戏引擎（与 UI 完全分离，全部逻辑可测试、可复现）
- Vitest（约 100+ 条引擎规则测试）
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
