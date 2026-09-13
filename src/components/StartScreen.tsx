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
            <b>路线规则：</b>去程普通格不可重复、不可中途回城；返程不得重走去程与返程走过的普通格。
            城市与矿区入口是唯二可以重复的地点。<br />
            <b>天气：</b>沙漠有高温与沙尘暴（帐篷逐次抵挡、指南针防迷路）；草地有暴雨（整顶吃掉帐篷）与泥沼（损耗一天）。<br />
            <b>情报：</b>每天傍晚可花 1 天查看未来 3 天天气——但只能看到已知地形的区域。<br />
            <b>定价：</b>三个矿区入口的宝石收购价固定——南矿 100、中央矿 160、北矿 240 元/kg。
            越危险遥远的矿区越值钱，进入哪个入口单价即锁定，路线风险评级仅供统计、不影响售价。
          </div>
        </div>
      </div>
    </div>
  );
}
