import { useState } from 'react';
import { gameConfig } from '../game';

interface Props {
  onStart: (seed: string) => void;
  randomSeed: () => string;
}

export default function StartScreen({ onStart, randomSeed }: Props) {
  const [seed, setSeed] = useState(randomSeed());

  return (
    <div className="app-shell">
      <div className="start-screen">
        <h1>绿洲计划</h1>
        <p className="subtitle">PROJECT OASIS · 沙漠商队策略 · v0.1.2b</p>
        <div className="start-card">
          <p className="desc">
            你携带 <b>{gameConfig.startCash} 元</b> 从城市出发。穿越<b>随机生成</b>的沙漠与草原，
            抵达两个随机矿区之一（宝石单价属于最终鉴定结果，<b>成功返城后才会公布</b>），
            自行决定挖矿天数，再沿一条<b>不重复</b>的路线返回城市。
            整个旅程必须在 <b>{gameConfig.maxDays} 天</b>内完成——矿区越难安全往返，宝石通常越值钱，
            但你的体力、帐篷与时间都是有限的。
          </p>
          <div className="seed-row">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="输入 Seed（可复现整局随机）"
              aria-label="Seed"
            />
            <button className="btn" onClick={() => setSeed(randomSeed())}>
              随机 Seed
            </button>
          </div>
          <button
            className="btn gold block"
            disabled={!seed.trim()}
            onClick={() => onStart(seed.trim())}
          >
            开始游戏
          </button>
          <div className="rules-brief">
            <b>远征规则：</b>8×9 随机地图（72 格），四方向移动，每格 1 天。去程走过的格子会被永久"烧掉"，
            返程不得重复；城市与当前矿区是仅有的可以重复的地点。<br />
            <b>矿区：</b>两座矿位于地图最右侧，但<b>不会紧贴右下角</b>（避免远征过短）。
            客观开采难度只由「最短合法往返方案有多危险」决定，与你怎么走完全无关；
            你实际绕路、受伤、烧帐篷都不会让宝石变贵。<br />
            <b>天气：</b>沙漠有高温与沙尘暴（帐篷逐次抵挡、指南针防迷路）；草地有暴雨（用帐篷则整顶报废但保住体力，不用帐篷则耐力 -2）与泥沼（损耗一天）。<br />
            <b>帐篷：</b>每顶帐篷都有独立编号（Tent A / B / C…）与独立耐久，用哪一顶永远由你选择。<br />
            <b>天气预报包：</b>购买使最大旅程天数 -1，获得 3 次预报并立即使用 1 次；
            次数可储存、不过期，随时查看"明天"的当前格与周围一圈天气。原地停留可以等坏天气过去。<br />
            <b>即时反馈：</b>任何关键资源变化（耐力/金钱/帐篷/指南针/预报次数/天数/宝石）都会立刻弹窗，
            按<b>变化前 → 变化后</b>显示；右下的旅途日志仍保留完整历史。
          </div>
        </div>
      </div>
    </div>
  );
}
