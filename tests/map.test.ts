import { describe, it, expect } from 'vitest';
import { generateWorld, mineLegalRows, mineLegalRowRange, cityCoords, mineCol } from '../src/game/map/generate';
import { existsPathExcluding, gridNeighbors } from '../src/game/map/grid';
import { gameConfig } from '../src/game/config/gameConfig';

/**
 * v0.1.2b 地图生成（真人试玩修正版）。
 * 所有尺寸断言都从 gameConfig.map 派生，并把新人肉试玩约束写死为回归测试：
 * 8×9 / 城市 (7,0) / 矿区 col=8 且 row ∈ [0,5]（禁止 row 6、7）。
 */

const CFG = gameConfig.map;
const LEGAL_ROWS = (() => {
  const out: number[] = [];
  for (let r = mineLegalRowRange().min; r <= mineLegalRowRange().max; r++) out.push(r);
  return out;
})();

describe('v0.1.2b 随机地图生成', () => {
  it('地图尺寸固定为 8×9（72 格），且配置与生成结果一致', () => {
    const m = generateWorld('size-check');
    expect(CFG.rows).toBe(8);
    expect(CFG.cols).toBe(9);
    expect(m.rows).toBe(CFG.rows);
    expect(m.cols).toBe(CFG.cols);
    expect(Object.keys(m.tiles).length).toBe(CFG.rows * CFG.cols);
    expect(CFG.rows * CFG.cols).toBe(72);
  });

  it('城市永远在左下角 (7,0)', () => {
    expect(cityCoords()).toEqual({ row: 7, col: 0 });
    for (const seed of ['s1', 's2', 's3']) {
      const m = generateWorld(seed);
      const c = m.tiles[m.cityId];
      expect(c.row).toBe(7);
      expect(c.col).toBe(0);
      expect(c.terrain).toBe('CITY');
    }
  });

  it('两矿区位于最右列 (col=8)，不重合并保持最小行距', () => {
    for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const m = generateWorld(seed);
      expect(m.mines.length).toBe(2);
      expect(mineCol()).toBe(8);
      const [a, b] = m.mines;
      for (const mine of m.mines) {
        expect(mine.col).toBe(8);
        expect(m.tiles[mine.tileId].terrain).toBe('MINE');
      }
      expect(a.tileId).not.toBe(b.tileId);
      expect(Math.abs(a.row - b.row)).toBeGreaterThanOrEqual(CFG.mineMinRowGap);
    }
  });

  it('矿区合法行范围为 0~5，禁止出现在最下方两行 (row 6 / 7)', () => {
    expect(mineLegalRowRange()).toEqual({ min: 0, max: 5 });
    expect(mineLegalRows()).toEqual([0, 1, 2, 3, 4, 5]);
    const forbidden = [CFG.rows - 2, CFG.rows - 1];
    expect(forbidden).toEqual([6, 7]);
    // 大规模扫描：任何 Seed 都不能把矿区放在右下两行
    const seenRows = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const m = generateWorld(`mine-rows-${i}`);
      for (const mine of m.mines) {
        expect(mine.col).toBe(8);
        expect(forbidden).not.toContain(mine.row);
        expect(LEGAL_ROWS).toContain(mine.row);
        seenRows.add(mine.row);
      }
    }
    // 合法行区间应被实际用到（不是只扎堆在两端）
    expect([...seenRows].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('Seed 合法性扫描：大样本范围内 100% 生成成功且约束全满足', () => {
    for (let i = 0; i < 300; i++) {
      const seed = `valid-scan-${i}`;
      const m = generateWorld(seed);
      expect(m.mines.length).toBe(2);
      const [a, b] = m.mines;
      expect(Math.abs(a.row - b.row)).toBeGreaterThanOrEqual(CFG.mineMinRowGap);
      expect(m.tiles[m.cityId].terrain).toBe('CITY');
      // 每个矿区都必须有唯一合法往返方案（矿价评估阶段必然可解）
      for (const mine of m.mines) {
        expect(Number.isFinite(mine.gemPrice)).toBe(true);
        expect(Number.isFinite(mine.detail.roundTripLength)).toBe(true);
        expect(mine.detail.roundTripLength).toBeGreaterThan(0);
      }
    }
  });

  it('普通格地形只来自配置集合且分布合理（30 个 Seed 抽样）', () => {
    const allowed = new Set(['GRASS', 'DESERT', 'VILLAGE', 'OASIS']);
    const counts: Record<string, number> = { GRASS: 0, DESERT: 0, VILLAGE: 0, OASIS: 0 };
    let total = 0;
    const nonNormal = 3; // 城市 1 + 矿区 2
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`dist-${i}`);
      for (const tile of Object.values(m.tiles)) {
        if (tile.terrain === 'CITY' || tile.terrain === 'MINE') continue;
        expect(allowed.has(tile.terrain)).toBe(true);
        counts[tile.terrain] += 1;
        total += 1;
      }
    }
    expect(total).toBe(30 * (CFG.rows * CFG.cols - nonNormal));
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
    const last = `${CFG.rows - 1}:${CFG.cols - 1}`;
    expect(gridNeighbors(m, '0:0').length).toBe(2);
    expect(gridNeighbors(m, `0:${Math.floor(CFG.cols / 2)}`).length).toBe(3);
    expect(gridNeighbors(m, '4:4').length).toBe(4);
    expect(gridNeighbors(m, last).length).toBe(2);
  });

  it('遭遇按配置基础概率预生成（统计抽样）', () => {
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
    expect(total).toBeGreaterThan(20);
    expect(dry / total).toBeGreaterThan(0.05);
    expect(dry / total).toBeLessThan(0.4);
  });
});

describe('v0.1.2b 矿区动态价值', () => {
  it('价格在新区间内且两矿可能不同', () => {
    const { clampMin, clampMax } = gameConfig.mineValuation;
    for (let i = 0; i < 30; i++) {
      const m = generateWorld(`price-${i}`);
      for (const mine of m.mines) {
        expect(mine.gemPrice).toBeGreaterThanOrEqual(clampMin);
        expect(mine.gemPrice).toBeLessThanOrEqual(clampMax);
      }
    }
  });

  it('同 Seed 矿价可复现；两矿价格可以不同', () => {
    const a = generateWorld('mine-price');
    const b = generateWorld('mine-price');
    expect(a.mines.map((m) => m.gemPrice)).toEqual(b.mines.map((m) => m.gemPrice));
    let differ = 0;
    for (let i = 0; i < 60; i++) {
      const m = generateWorld(`differ-${i}`);
      if (m.mines[0].gemPrice !== m.mines[1].gemPrice) differ += 1;
    }
    // 新地图上两矿难度分布重叠更多，仍要求有相当比例的差异化定价
    expect(differ).toBeGreaterThanOrEqual(15);
  });

  it('最短合法往返长度落在地图尺寸允许的范围内（20~30）', () => {
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < 60; i++) {
      const m = generateWorld(`len-${i}`);
      for (const mine of m.mines) {
        min = Math.min(min, mine.detail.roundTripLength);
        max = Math.max(max, mine.detail.roundTripLength);
      }
    }
    // 城市 (7,0) → 矿区 (r,8)：曼哈顿 = 15-r，r∈[0,5] ⇒ 单程 10~15 ⇒ 往返 20~30
    expect(min).toBeGreaterThanOrEqual(20);
    expect(max).toBeLessThanOrEqual(30);
  });
});
