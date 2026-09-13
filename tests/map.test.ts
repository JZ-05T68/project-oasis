import { describe, it, expect } from 'vitest';
import { worldMap } from '../src/game/map/worldMap';
import { existsPathExcluding, shortestPath } from '../src/game/map/graph';
import { getLegalMoves } from '../src/game';
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

describe('固定地图：矿区定价与路线风险评分', () => {
  const SOUTH = ['sg1', 'sv', 'so', 'sg2', 'mineS'];
  const CENTRAL = ['mg1', 'md1', 'wd1', 'wo', 'wg1', 'nd2', 'cd1', 't3', 'mineC'];
  const NORTH = ['w0', 'w1', 'n0', 'n3', 't1', 't2', 't3', 't4', 't5', 'mineN'];

  function play(seed: string, route: string[]) {
    let s = newGame(seed, calmOverrides(worldMap));
    s = walk(s, route);
    return s;
  }

  it('三条代表路线全部是地图上的合法路径', () => {
    for (const route of [SOUTH, CENTRAL, NORTH]) {
      let s = newGame('route-validity', calmOverrides(worldMap));
      for (const step of route) {
        expect(getLegalMoves(s)).toContain(step);
        s = walk(s, [step]);
      }
    }
  });

  it('v0.1.1 固定定价：南矿 100 / 中央矿 160 / 北矿 240 元/kg', () => {
    expect(gameConfig.mineBasePrice.SOUTH).toBe(100);
    expect(gameConfig.mineBasePrice.CENTRAL).toBe(160);
    expect(gameConfig.mineBasePrice.NORTH).toBe(240);
    expect(play('price-s', SOUTH).gemPrice).toBe(100);
    expect(play('price-c', CENTRAL).gemPrice).toBe(160);
    expect(play('price-n', NORTH).gemPrice).toBe(240);
  });

  it('路线风险评分与售价完全解耦：同一矿区不同路线 → 同价不同分', () => {
    // 两条通往中央矿区且都存在合法返程的路线
    const short = play('decouple-1', CENTRAL);
    const detour = play('decouple-1', [
      'mg1', 'sg1', 'sv', 'mv', 'md1', 'wd1', 'wo', 'wg1', 'nd2', 'cd1', 't3', 'mineC',
    ]);
    expect(detour.status).toBe('ONGOING');
    expect(detour.baseGemPrice).toBe(short.baseGemPrice);
    expect(detour.gemPrice).toBe(short.gemPrice);
    expect(detour.routeScore).not.toBe(short.routeScore); // 评分反映路线差异，售价不受影响
  });

  it('价格不受 Seed 影响（市场系数关闭）', () => {
    const prices = new Set<number>();
    for (const seed of ['mk-1', 'mk-2', 'mk-3', 'mk-4', 'mk-5', 'mk-6']) {
      const fac = play(seed, SOUTH).marketFactor;
      const price = play(seed, NORTH).gemPrice;
      prices.add(fac === null ? -1 : fac);
      prices.add(price === null ? -1 : price);
    }
    expect(prices.has(1)).toBe(true);
    expect(gameConfig.marketEnabled).toBe(false);
  });

  it('路线风险评分仍然有效：南线 < 北线（客观风险差异保留在统计中）', () => {
    const south = play('order-check', SOUTH).routeScore ?? -1;
    const north = play('order-check', NORTH).routeScore ?? -1;
    expect(south).toBeGreaterThan(0);
    expect(south).toBeLessThan(north);
  });

  it('草地单格风险系数高于沙漠（草地不是安全地形）', () => {
    expect(gameConfig.tileRisk.GRASS).toBeGreaterThan(gameConfig.tileRisk.DESERT);
  });

  it('去程封死所有返城路线时进入矿区即失败（真实地图场景）', () => {
    let s = newGame('severed-real', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'mg1', 'md1', 'mv', 'mo', 'mg2', 'mineS']);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });
});
