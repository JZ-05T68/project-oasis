import { generateWorld } from '../src/game/map/generate';
import { bfsPath, tileIdOf } from '../src/game/map/grid';

// 为浏览器 E2E 预计算路径（输出 JSON 到 stdout）
function pathFrom(seed: string, predicate: (id: string) => boolean, needDry?: boolean): string {
  const map = generateWorld(seed);
  const city = map.cityId;
  const targets = Object.values(map.tiles)
    .filter((t) => predicate(t.id) && !(t.row === 9 && t.col === 0))
    .filter((t) => (needDry === undefined ? true : map.drought[t.id] === needDry));
  for (const t of targets.sort((a, b) => a.row - b.row)) {
    const p = bfsPath(map, city, t.id, [], (id) => map.tiles[id].terrain !== 'MINE');
    if (p && p.length <= 9) return JSON.stringify({ seed, tile: t.id, path: p.slice(1) });
  }
  return JSON.stringify({ seed, tile: null, path: null });
}

const out = {
  desert: pathFrom('e2e-desert', (id) => true) && (() => {
    // 找沙漠
    const map = generateWorld('e2e-desert');
    const t = Object.values(map.tiles).find((x) => x.terrain === 'DESERT' && bfsPath(map, map.cityId, x.id, [], (id) => map.tiles[id].terrain !== 'MINE') && bfsPath(map, map.cityId, x.id, [], (id) => map.tiles[id].terrain !== 'MINE')!.length <= 9);
    if (!t) return { seed: 'e2e-desert', tile: null, path: null };
    const p = bfsPath(map, map.cityId, t.id, [], (id) => map.tiles[id].terrain !== 'MINE')!;
    return { seed: 'e2e-desert', tile: t.id, path: p.slice(1) };
  })(),
  village: (() => {
    const map = generateWorld('e2e-village');
    const t = Object.values(map.tiles).find((x) => x.terrain === 'VILLAGE' && (bfsPath(map, map.cityId, x.id, [], (id) => map.tiles[id].terrain !== 'MINE')?.length ?? 99) <= 9);
    if (!t) return { seed: 'e2e-village', tile: null, path: null };
    const p = bfsPath(map, map.cityId, t.id, [], (id) => map.tiles[id].terrain !== 'MINE')!;
    return { seed: 'e2e-village', tile: t.id, path: p.slice(1) };
  })(),
  oasisWet: (() => {
    const map = generateWorld('e2e-oasis');
    const t = Object.values(map.tiles).find((x) => x.terrain === 'OASIS' && map.drought[x.id] === false && (bfsPath(map, map.cityId, x.id, [], (id) => map.tiles[id].terrain !== 'MINE')?.length ?? 99) <= 9);
    if (!t) return { seed: 'e2e-oasis', tile: null, path: null };
    const p = bfsPath(map, map.cityId, t.id, [], (id) => map.tiles[id].terrain !== 'MINE')!;
    return { seed: 'e2e-oasis-wet', tile: t.id, path: p.slice(1) };
  })(),
  oasisDry: (() => {
    const map = generateWorld('e2e-oasis');
    const t = Object.values(map.tiles).find((x) => x.terrain === 'OASIS' && map.drought[x.id] === true && (bfsPath(map, map.cityId, x.id, [], (id) => map.tiles[id].terrain !== 'MINE')?.length ?? 99) <= 9);
    if (!t) return { seed: 'e2e-oasis', tile: null, path: null };
    const p = bfsPath(map, map.cityId, t.id, [], (id) => map.tiles[id].terrain !== 'MINE')!;
    return { seed: 'e2e-oasis-dry', tile: t.id, path: p.slice(1) };
  })(),
};
console.log(JSON.stringify(out));
void tileIdOf;
