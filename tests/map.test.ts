import { describe, it, expect } from 'vitest';
import { worldMap } from '../src/game/map/worldMap';
import { existsPathExcluding, shortestPath } from '../src/game/map/graph';
import { performMove, getLegalMoves } from '../src/game';
import { newGame, calmOverrides, walk } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';

const TERRAIN_COUNTS: Record<string, number> = {
  CITY: 1,
  MINE: 3,
  DESERT: 5,
  VILLAGE: 2,
  OASIS: 3,
};

describe('固定地图：结构与合法性', () => {
  it('节点规模在 25～40 之间', () => {
    const n = Object.keys(worldMap.nodes).length;
    expect(n).toBeGreaterThanOrEqual(25);
    expect(n).toBeLessThanOrEqual(40);
  });

  it('包含全部必需地形且数量符合设计', () => {
    const counts: Record<string, number> = {};
    for (const node of Object.values(worldMap.nodes)) {
      counts[node.terrain] = (counts[node.terrain] ?? 0) + 1;
    }
    expect(counts['CITY']).toBe(TERRAIN_COUNTS.CITY);
    expect(counts['MINE']).toBe(TERRAIN_COUNTS.MINE);
    expect(counts['DESERT']).toBe(TERRAIN_COUNTS.DESERT);
    expect(counts['VILLAGE']).toBe(TERRAIN_COUNTS.VILLAGE);
    expect(counts['OASIS']).toBe(TERRAIN_COUNTS.OASIS);
    expect(counts['GRASS'] ?? 0).toBeGreaterThan(0);
  });

  it('边无重复、无自环', () => {
    const seen = new Set<string>();
    for (const [a, b] of worldMap.edges) {
      expect(a).not.toBe(b);
      const key = [a, b].sort().join('~');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('所有节点从城市可达', () => {
    for (const id of Object.keys(worldMap.nodes)) {
      expect(shortestPath(worldMap, worldMap.cityId, id), `${id} 不可达`).not.toBeNull();
    }
  });

  it('每个矿区入口至少有两条边（否则无法构造两条不相交路径）', () => {
    for (const mineId of worldMap.mineIds) {
      expect(worldMap.adjacency[mineId].length).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * 核心合法性：城市与每个矿区入口之间存在两条内部普通格完全不重合的路径。
   * 由 Menger 定理，等价于：删去任意一个非端点节点后仍存在城市→入口的路径。
   */
  for (const mineId of worldMap.mineIds) {
    it(`城市 ↔ ${mineId} 满足 2-顶点连通（存在两条不相交合法路线）`, () => {
      for (const v of Object.keys(worldMap.nodes)) {
        if (v === worldMap.cityId || v === mineId) continue;
        expect(
          existsPathExcluding(worldMap, worldMap.cityId, mineId, v),
          `删除节点 ${v} 后城市到 ${mineId} 不连通`,
        ).toBe(true);
      }
    });
  }
});

describe('固定地图：路线难度评分校准', () => {
  const SOUTH = ['sg1', 'sv', 'so', 'sg2', 'mineS'];
  const CENTRAL = ['mg1', 'md1', 'wd1', 'wo', 'wg1', 'nd2', 'cd1', 't3', 'mineC'];
  const NORTH = ['w0', 'w1', 'n0', 'n3', 't1', 't2', 't3', 't4', 't5', 'mineN'];

  function playPrice(seed: string, route: string[]): number {
    let s = newGame(seed, calmOverrides(worldMap));
    s = walk(s, route);
    return s.baseGemPrice!;
  }

  it('三条代表路线全部是地图上的合法路径', () => {
    for (const route of [SOUTH, CENTRAL, NORTH]) {
      let s = newGame('route-validity', calmOverrides(worldMap));
      for (const step of route) {
        expect(getLegalMoves(s)).toContain(step);
        s = performMove(s, step);
      }
    }
  });

  it('南线代表路为低风险区间（100~145 元/kg）', () => {
    const price = playPrice('calibrate-south', SOUTH);
    expect(price).toBeGreaterThanOrEqual(100);
    expect(price).toBeLessThanOrEqual(145);
  });

  it('中线代表路为中风险区间（200~250 元/kg）', () => {
    const price = playPrice('calibrate-central', CENTRAL);
    expect(price).toBeGreaterThanOrEqual(200);
    expect(price).toBeLessThanOrEqual(250);
  });

  it('北线代表路为高风险区间（245~320 元/kg）', () => {
    const price = playPrice('calibrate-north', NORTH);
    expect(price).toBeGreaterThanOrEqual(245);
    expect(price).toBeLessThanOrEqual(320);
  });

  it('评分区间严格递增：南线 < 中线 < 北线', () => {
    const south = playPrice('order-check', SOUTH);
    const central = playPrice('order-check', CENTRAL);
    const north = playPrice('order-check', NORTH);
    expect(south).toBeLessThan(central);
    expect(central).toBeLessThan(north);
  });

  it('草地单格风险系数高于沙漠（草地不是安全地形）', () => {
    expect(gameConfig.tileRisk.GRASS).toBeGreaterThan(gameConfig.tileRisk.DESERT);
  });

  it('去程绕行更多危险地形会提高评分（路线选择有意义）', () => {
    // 同样前往中央矿区：直接北上 vs 先绕行南侧草地
    const short = playPrice('detour-check', CENTRAL);
    const detour = playPrice('detour-check', [
      'mg1', 'sg1', 'sv', 'mv', 'md1', 'wd1', 'wo', 'wg1', 'nd2', 'cd1', 't3', 'mineC',
    ]);
    expect(detour).toBeGreaterThan(short);
  });

  it('去程封死所有返城路线时进入矿区即失败（真实地图场景）', () => {
    // 该去程同时消耗 sg2 的两个出口（so/mg2），南矿区入口将被封死
    let s = newGame('severed-real', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'mg1', 'md1', 'mv', 'mo', 'mg2', 'mineS']);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });
});
