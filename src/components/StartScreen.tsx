import { useState } from 'react';

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
        <p className="subtitle">PROJECT OASIS · 沙漠商队策略 · v0.1.0</p>
        <div className="start-card">
          <p className="desc">
            你携带 <b>2000 元</b> 从城市出发。穿越沙漠与草地，抵达远方的宝库矿区，
            自行决定挖矿天数，再沿一条<b>完全不同</b>的路线返回城市。
            整个旅程必须在 <b>42 天</b> 内完成——宝石越危险的路线越值钱，但你的体力、
            帐篷与时间都是有限的。
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
            <b>远征规则：</b>10×12 随机地图，四方向移动，每格 1 天。去程走过的格子会被永久"烧掉"，
            返程不得重复；城市与当前矿区是唯二可以重复的地点。<br />
            <b>矿区：</b>两座矿位于地图最右侧，收购价由本局客观环境在开局确定（越远越险越值钱），
            开局即可见，进矿锁定；你的实际行为不会改变价格。<br />
            <b>天气：</b>沙漠有高温与沙尘暴（帐篷逐次抵挡、指南针防迷路）；草地有暴雨（整顶吃掉帐篷）与泥沼（损耗一天）。<br />
            <b>天气预报包：</b>购买使最大旅程天数 -1，获得 3 次预报并立即使用 1 次；
            次数可储存、不过期，随时查看"明天"的当前格与周围一圈天气。原地停留可以等坏天气过去。
          </div>
        </div>
      </div>
    </div>
  );
}
