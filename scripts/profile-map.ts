import { generateWorld } from './src/game/map/generate';
import { bfsPath, dijkstraPath, enumeratePaths, existsPathExcluding } from './src/game/map/grid';
import { hashSeed, nextRandom } from './src/game/random/rng';
import { gameConfig } from './src/game/config/gameConfig';

function timeIt(label: string, fn: () => void) {
  const t0 = performance.now();
  fn();
  console.log(`${label}: ${(performance.now() - t0).toFixed(1)}ms`);
}

// 逐 seed 计时
for (const seed of ['alpha', 'beta', 'gamma']) {
  timeIt(`generateWorld(${seed})`, () => generateWorld(seed));
}

// 单独测 enumeratePaths 性能
const map = generateWorld('alpha');
const mineA = map.mines[0].tileId;
const cityId = map.cityId;
timeIt('bfs', () => bfsPath(map, cityId, mineA));
timeIt('dijkstra', () => dijkstraPath(map, cityId, mineA, () => 3));
timeIt('enumerate30', () => enumeratePaths(map, mineA, cityId, [], 30));
timeIt('validity(118 BFS)', () => {
  for (const id of Object.keys(map.tiles)) {
    if (id === cityId || id === mineA) continue;
    existsPathExcluding(map, cityId, mineA, id);
  }
});
