import { describe, it, expect } from 'vitest';
import { performAction, getLegalMoves } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, mutate, nearestMineTile } from './helpers';
import { walkTo } from './helpers';

/**
 * v0.1.2a 宿营与帐篷逐顶管理规则。
 * 城市/村庄 = 免费等待；野外（沙漠/草地/绿洲）与矿区空等 = 宿营（必须帐篷、逐顶选择）。
 */

/** 把玩家安全地放到某个指定地形上（calm 全晴，途中不掉耐力） */
function gotoTerrain(seed: string, terrain: 'DESERT' | 'GRASS' | 'OASIS', tents: number[]) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  const target = Object.values(s.map.tiles).find((t) => t.terrain === terrain && !(t.row === 9 && t.col === 0))!;
  s = mutate(s, (m) => {
    m.tents = [...tents];
    // 直接传送到目标格并标记去程（保持测试聚焦宿营规则本身）
    m.position = target.id;
    if (!m.visitedOutbound.includes(target.id)) m.visitedOutbound.push(target.id);
    if (!m.explored.includes(target.id)) m.explored.push(target.id);
  });
  return { s, target };
}

describe('宿营：城市与村庄免费等待', () => {
  it('城市停留：天数 +1、坐标不变、不耗帐篷、不要求数量', () => {
    let s = newGame('camp-city', calmOverrides(newGame('camp-city').map));
    s = mutate(s, (m) => {
      m.tents = [];
    });
    const pos = s.position;
    s = performAction(s, { type: 'WAIT' });
    expect(s.daysUsed).toBe(1);
    expect(s.position).toBe(pos);
    expect(s.tents).toEqual([]);
  });

  it('村庄停留：不消耗帐篷、不恢复耐力、不刷新遭遇', () => {
    let s = newGame('camp-village', calmOverrides(newGame('camp-village').map));
    const village = Object.values(s.map.tiles).find((t) => t.terrain === 'VILLAGE')!;
    s = mutate(s, (m) => {
      m.tents = [];
      m.stamina = 3;
      m.position = village.id;
      if (!m.visitedOutbound.includes(village.id)) m.visitedOutbound.push(village.id);
      if (!m.explored.includes(village.id)) m.explored.push(village.id);
    });
    s = performAction(s, { type: 'WAIT' });
    expect(s.daysUsed).toBe(1);
    expect(s.position).toBe(village.id);
    expect(s.tents).toEqual([]);
    expect(s.stamina).toBe(3); // 不恢复
    expect(s.pendingEvents.length).toBe(0); // 不刷新遭遇
  });
});

describe('宿营：野外必须帐篷且逐顶选择', () => {
  it('沙漠宿营：选中帐篷耐久 -1，其他帐篷不受影响', () => {
    const { s: s0 } = gotoTerrain('camp-desert', 'DESERT', [3, 1]);
    // 明确选第 2 顶（B 1/3）→ 用掉后整顶消失，A 3/3 原样保留
    const s = performAction(s0, { type: 'WAIT', tentIndex: 1 });
    expect(s.daysUsed).toBe(1);
    expect(s.tents).toEqual([3]);
  });

  it('草地宿营：选 A 只扣 A（系统不得自动选最低/最新）', () => {
    const { s: s0 } = gotoTerrain('camp-grass', 'GRASS', [1, 3]);
    const s = performAction(s0, { type: 'WAIT', tentIndex: 0 });
    expect(s.tents).toEqual([3]); // A 1/3 用掉消失，B 3/3 纹丝不动
  });

  it('草地宿营：3/3 → 2/3', () => {
    const { s: s0 } = gotoTerrain('camp-grass2', 'GRASS', [3]);
    const s = performAction(s0, { type: 'WAIT', tentIndex: 0 });
    expect(s.tents).toEqual([2]);
  });

  it('绿洲普通停留（非修整）：+1 天、帐篷 -1、不恢复耐力', () => {
    const { s: s0 } = gotoTerrain('camp-oasis', 'OASIS', [3]);
    const s = performAction(s0, { type: 'WAIT', tentIndex: 0 });
    expect(s.daysUsed).toBe(1);
    expect(s.tents).toEqual([2]);
    expect(s.stamina).toBe(5); // 停留 ≠ 修整，不恢复耐力
    expect(Object.keys(s.oasisRestUsed).length).toBe(0); // 未占用修整次数
  });

  it('无帐篷在野外不能主动停留', () => {
    const { s: s0 } = gotoTerrain('camp-none', 'DESERT', []);
    expect(() => performAction(s0, { type: 'WAIT' })).toThrow(GameError);
  });

  it('有帐篷但未指明哪一顶 → 抛错（不允许系统自动选）', () => {
    const { s: s0 } = gotoTerrain('camp-ambiguous', 'DESERT', [3, 3]);
    expect(() => performAction(s0, { type: 'WAIT' })).toThrow(GameError);
  });
});

describe('矿区空等 = 野外宿营', () => {
  it('矿区等待：+1 天、不挖矿、帐篷 -1（挖矿本身不耗帐篷）', () => {
    let s = newGame('camp-mine', calmOverrides(newGame('camp-mine').map));
    s = mutate(s, (m) => {
      m.tents = [3, 3];
    });
    s = walkTo(s, nearestMineTile(s).tileId);
    expect(s.phase).toBe('MINING');
    // 挖矿 1 天：不耗帐篷
    s = performAction(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(2);
    expect(s.tents).toEqual([3, 3]);
    // 矿区空等：需要帐篷
    s = performAction(s, { type: 'WAIT', tentIndex: 1 });
    expect(s.tents).toEqual([3, 2]);
    expect(s.gemsKg).toBe(2); // 等待不产出
  });

  it('矿区无帐篷不能空等（但可以正常挖矿或返程）', () => {
    let s = newGame('camp-mine-none', calmOverrides(newGame('camp-mine-none').map));
    s = mutate(s, (m) => {
      m.tents = [];
    });
    s = walkTo(s, nearestMineTile(s).tileId);
    expect(() => performAction(s, { type: 'WAIT' })).toThrow(GameError);
    s = performAction(s, { type: 'MINE' }); // 挖矿不受影响
    expect(s.gemsKg).toBe(2);
  });
});

describe('天气预报购买的必败检查', () => {
  it('前期购买不受限', () => {
    let s = newGame('fc-buy-ok', calmOverrides(newGame('fc-buy-ok').map));
    const info = getLegalMoves(s);
    void info;
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(41);
  });

  it('剩余时间仅够完成旅程时禁止购买（不泄露内部天数）', () => {
    let s = newGame('fc-buy-doom', calmOverrides(newGame('fc-buy-doom').map));
    // 把玩家放在半程、剩余时间紧张：maxDays -1 后数学上无法完成
    s = mutate(s, (m) => {
      m.daysUsed = 35;
      m.maxDays = 42;
    });
    expect(() => performAction(s, { type: 'BUY_FORECAST_PACK' })).toThrow(
      /剩余时间不足/,
    );
    // 购买被拒绝：状态不变
    expect(s.maxDays).toBe(42);
    expect(s.stats.forecastPacks).toBe(0);
  });
});
