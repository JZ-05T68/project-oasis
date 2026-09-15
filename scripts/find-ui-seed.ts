/**
 * 为浏览器审计场景 fullrun 找一个「矿区离家近」的 Seed。
 * 目的：让真人式点击走法能在不依赖高深策略的情况下完成一次成功远征，
 * 从而稳定覆盖「成功结算」这条 UI 路径。
 */
import { createNewGame } from '../src/game';
import { bfsPath } from '../src/game/map/grid';

const out: Array<{ seed: string; slot: string; tile: string; hops: number; desertRatio: number }> = [];
for (let i = 0; i < 4000; i++) {
  const seed = `uiwin-${i}`;
  const s = createNewGame(seed);
  for (const m of s.map.mines) {
    const other = s.map.mines.filter((x) => x.tileId !== m.tileId).map((x) => x.tileId);
    const p = bfsPath(s.map, s.map.cityId, m.tileId, [], (id) => !other.includes(id));
    if (!p) continue;
    const hops = p.length - 1;
    const desert = p.filter((id) => s.map.tiles[id].terrain === 'DESERT').length;
    out.push({ seed, slot: m.slot, tile: m.tileId, hops, desertRatio: Math.round((desert / hops) * 100) });
  }
}
out.sort((a, b) => a.hops + a.desertRatio / 100 - (b.hops + b.desertRatio / 100));
console.log(JSON.stringify(out.slice(0, 12), null, 1));
