/**
 * 为浏览器审计寻找确定性 Seed（城市 (7,0)，一步邻格 (6,0)，两步邻格 (5,0)）：
 * - STORM   ：(6,0) 沙漠 且 1~7 天内 ≥5 天沙尘暴（快速凑齐 4 次沙尘暴，省帐篷预算）
 * - RAIN    ：(6,0) 草地 且 1~7 天内 ≥3 天暴雨
 * - OASIS   ：(5,0) 有水绿洲，且 (6,0) 第 1 天为高温/沙尘暴（先掉 1 点耐力，才能修整）
 * - OASISDRY：(6,0) 干涸绿洲（验证干涸禁止修整）
 * 用法：npx tsx scripts/find-audit-seed.ts
 */
import { generateWorld } from '../src/game/map/generate';
import { tileIdOf } from '../src/game/map/grid';
import { gameConfig } from '../src/game/config/gameConfig';

const cityRow = gameConfig.map.rows - 1;
const n1 = tileIdOf(cityRow - 1, 0); // 6:0
const n2 = tileIdOf(cityRow - 2, 0); // 5:0

type Found = { seed: string; tile: string; detail: string } | null;

const out: Record<string, Found> = { STORM: null, RAIN: null, OASIS: null, OASISDRY: null };

for (let i = 0; i < 60000; i++) {
  if (out.STORM && out.RAIN && out.OASIS && out.OASISDRY) break;
  const seed = `audit-${i}`;
  const m = generateWorld(seed);
  const t1 = m.tiles[n1];
  const t2 = m.tiles[n2];
  if (!t1) continue;
  const w1 = m.weather[n1];
  const stormDays: number[] = [];
  const rainDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    if (w1[d] === 'SANDSTORM') stormDays.push(d + 1);
    if (w1[d] === 'RAINSTORM') rainDays.push(d + 1);
  }
  if (!out.STORM && t1.terrain === 'DESERT' && stormDays.length >= 5) {
    out.STORM = { seed, tile: n1, detail: '沙尘暴日=' + stormDays.join(',') };
  }
  if (!out.RAIN && t1.terrain === 'GRASS' && rainDays.length >= 3) {
    out.RAIN = { seed, tile: n1, detail: '暴雨日=' + rainDays.join(',') };
  }
  if (
    !out.OASIS &&
    t2 &&
    t2.terrain === 'OASIS' &&
    !m.drought[n2] &&
    (w1[0] === 'HEAT' || w1[0] === 'SANDSTORM')
  ) {
    out.OASIS = { seed, tile: n2, detail: '(6,0)=' + t1.terrain + '/' + w1[0] + ' → (5,0) 有水绿洲' };
  }
  if (!out.OASISDRY && t1.terrain === 'OASIS' && m.drought[n1]) {
    out.OASISDRY = { seed, tile: n1, detail: '干涸绿洲' };
  }
}

for (const k of Object.keys(out)) console.log(k.padEnd(9) + ' ' + JSON.stringify(out[k]));
