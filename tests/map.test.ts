import { describe, it, expect } from 'vitest';
import { generateWorld } from '../src/game/map/generate';
import { existsPathExcluding, gridNeighbors } from '../src/game/map/grid';
import { gameConfig } from '../src/game/config/gameConfig';

describe('v0.1.2 随机地图生成', () => {
  it('地图尺寸固定为 10×12', () => {
    const m = generateWorld('size-check');
    expect(m.rows).toBe(10);
    expect(m.cols).toBe(12);
    expect(Object.keys(m.tiles).length).toBe(120);
    expect(gameConfig.map.rows).toBe(10);
    expect(gameConfig.map.cols).toBe(12);
  });

  it('城市永远在左下角 (rows-1, 0)', () => {
    for (const seed of ['s1', 's2', 's3']) {
      const m = generateWorld(seed);
      const c = m.tiles[m.cityId];
      expect(c.row).toBe(9);
      expect(c.col).toBe(0);
      expect(c.terrain).toBe('CITY');
    }
  });

  it('两矿区都位于最右列 (col = cols-1)，且不重合、保持最小行距', () => {
    for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const m = generateWorld(seed);
      expect(m.mines.length).toBe(2);
      const [a, b] = m.mines;
      for (const mine of m.mines) {
        expect(mine.col).toBe(11);
        expect(m.tiles[mine.tileId].terrain).toBe('MINE');
      }
      expect(a.tileId).not.toBe(b.tileId);
      expect(Math.abs(a.row - b.row)).toBeGreaterThanOrEqual(gameConfig.map.mineMinRowGap);
    }
  });

  it('普通格地形只来自配置集合且分布合理（30 个 Seed 抽样）', () => {
    const allowed = new Set(['GRASS', 'DESERT', 'VILLAGE', 'OASIS']);
    const counts: Record<string, number> = { GRASS: 0, DESERT: 0, VILLAGE: 0, OASIS: 0 };
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`dist-${i}`);
      for (const tile of Object.values(m.tiles)) {
        if (tile.terrain === 'CITY' || tile.terrain === 'MINE') continue;
        expect(allowed.has(tile.terrain)).toBe(true);
        counts[tile.terrain] += 1;
        total += 1;
      }
    }
    expect(total).toBe(30 * (120 - 3));
    for (const terrain of ['GRASS', 'DESERT', 'VILLAGE', 'OASIS'] as const) {
      expect(counts[terrain]).toBeGreaterThan(0);
      const share = counts[terrain] / total;
      const target = gameConfig.terrainProbability[terrain];
      expect(Math.abs(share - target)).toBeLessThan(0.08);
    }
  });

  it('同 Seed 地图完全一致（地形/遭遇/天气/矿价）', () => {
    const a = generateWorld('same-seed');
    const b = generateWorld('same-seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('不同 Seed 通常得到不同地图', () => {
    const a = JSON.stringify(generateWorld('different-1'));
    const b = JSON.stringify(generateWorld('different-2'));
    expect(a).not.toBe(b);
  });

  it('城市与每个矿区都存在两条内部格子完全不重合的路径（Menger 校验）', () => {
    for (const seed of ['valid-1', 'valid-2', 'valid-3']) {
      const m = generateWorld(seed);
      for (const mine of m.mines) {
        for (const id of Object.keys(m.tiles)) {
          if (id === m.cityId || id === mine.tileId) continue;
          expect(
            existsPathExcluding(m, m.cityId, mine.tileId, id),
            `seed=${seed} 删除 ${id} 后城市→Mine ${mine.slot} 不连通`,
          ).toBe(true);
        }
      }
    }
  });

  it('四方向邻接正确（角落 2 / 边缘 3 / 内部 4）', () => {
    const m = generateWorld('adj-check');
    expect(gridNeighbors(m, '0:0').length).toBe(2);
    expect(gridNeighbors(m, '0:5').length).toBe(3);
    expect(gridNeighbors(m, '5:5').length).toBe(4);
    expect(gridNeighbors(m, '9:11').length).toBe(2);
  });

  it('遭遇按 25% 基础概率预生成（统计抽样）', () => {
    let withEncounter = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`enc-${i}`);
      for (const [id, kind] of Object.entries(m.encounters)) {
        total += 1;
        if (kind !== null) withEncounter += 1;
        const terrain = m.tiles[id].terrain;
        if (terrain === 'CITY' || terrain === 'MINE') throw new Error('城市/矿区不应有遭遇');
      }
    }
    const rate = withEncounter / total;
    expect(Math.abs(rate - gameConfig.encounter.baseProbability)).toBeLessThan(0.05);
  });

  it('村庄遭遇为盗贼/市集五五开（统计抽样）', () => {
    let thief = 0;
    let market = 0;
    for (let i = 0; i < 40; i++) {
      const m = generateWorld(`village-${i}`);
      for (const kind of Object.values(m.encounters)) {
        if (kind === 'THIEF') thief += 1;
        if (kind === 'MARKET') market += 1;
      }
    }
    expect(thief).toBeGreaterThan(0);
    expect(market).toBeGreaterThan(0);
    const ratio = thief / (thief + market);
    expect(Math.abs(ratio - gameConfig.encounter.villageThiefRatio)).toBeLessThan(0.15);
  });

  it('沙漠遭遇为商队、草地遭遇为牧民', () => {
    for (let i = 0; i < 20; i++) {
      const m = generateWorld(`kind-${i}`);
      for (const [id, kind] of Object.entries(m.encounters)) {
        if (kind === null) continue;
        const terrain = m.tiles[id].terrain;
        if (terrain === 'DESERT') expect(kind).toBe('CARAVAN');
        if (terrain === 'GRASS') expect(kind).toBe('HERDSMAN');
        if (terrain === 'VILLAGE') expect(['THIEF', 'MARKET']).toContain(kind);
      }
    }
  });

  it('绿洲干涸由 Seed 确定（同 Seed 一致，概率约 20%）', () => {
    let dry = 0;
    let total = 0;
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`drought-${i}`);
      const a = JSON.stringify(m.drought);
      const b = JSON.stringify(generateWorld(`drought-${i}`).drought);
      expect(a).toBe(b);
      for (const d of Object.values(m.drought)) {
        total += 1;
        if (d) dry += 1;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(dry / total).toBeGreaterThan(0.05);
    expect(dry / total).toBeLessThan(0.4);
  });
});

describe('v0.1.2 矿区动态价值', () => {
  it('价格在 80~320 区间内', () => {
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`price-${i}`);
      for (const mine of m.mines) {
        expect(mine.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
        expect(mine.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
      }
    }
  });

  it('同 Seed 矿价可复现；两矿价格可以不同', () => {
    const a = generateWorld('mine-price');
    const b = generateWorld('mine-price');
    expect(a.mines.map((m) => m.gemPrice)).toEqual(b.mines.map((m) => m.gemPrice));
    let differ = 0;
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`differ-${i}`);
      if (m.mines[0].gemPrice !== m.mines[1].gemPrice) differ += 1;
    }
    // v0.1.2a 价格更集中，允许部分对局两矿同价
    expect(differ).toBeGreaterThanOrEqual(10);
  });

});
