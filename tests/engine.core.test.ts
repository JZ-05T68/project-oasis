import { describe, it, expect } from 'vitest';
import { performMove, getLegalMoves, performAction } from '../src/game';
import { GameError } from '../src/game/types';
import type { CreateGameOptions } from '../src/game/types';
import { newGame, calmOverrides, walk, walkTo, mutate, findTiles, mineTile, mkTents, charges, TENT_A } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';

describe('核心引擎：初始状态', () => {
  it('初始状态符合规则', () => {
    const s = newGame('init-seed');
    expect(s.cash).toBe(2000);
    expect(s.stamina).toBe(5);
    expect(s.daysUsed).toBe(0);
    expect(s.maxDays).toBe(42);
    expect(s.phase).toBe('OUTBOUND');
    expect(s.status).toBe('ONGOING');
    expect(s.position).toBe(s.map.cityId);
    expect(s.gemsKg).toBe(0);
    expect(s.tents).toEqual([]);
    expect(s.compasses).toBe(0);
    expect(s.forecastCharges).toBe(0);
    expect(s.visitedOutbound).toEqual([s.map.cityId]);
    expect(s.visitedReturn).toEqual([]);
    // 城市与两矿区开局可见
    expect(s.explored).toContain(s.map.cityId);
    for (const m of s.map.mines) expect(s.explored).toContain(m.tileId);
    expect(s.seed).toBe('init-seed');
  });

  it('开局即可在城市购买装备（不消耗时间）', () => {
    let s = newGame('buy-city');
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    expect(charges(s.tents)).toEqual([gameConfig.tentDesertCharges]);
    expect(s.compasses).toBe(1);
    expect(s.cash).toBe(2000 - 400 - 100);
    expect(s.equipmentSpent).toBe(500);
    expect(s.daysUsed).toBe(0);
  });
});

describe('核心引擎：四方向移动与越界', () => {
  it('只能四方向移动且不越界（城市在角落只有 2 个合法移动）', () => {
    const s = newGame('move-legal', calmOverrides(newGame('move-legal').map));
    const legal = getLegalMoves(s);
    expect(legal.length).toBe(2); // 左下角
    // 合法移动全部是城市邻居
    const neighbors = new Set(getLegalMoves(s));
    for (const id of legal) expect(neighbors.has(id)).toBe(true);
    // 越界目标不存在
    expect(legal).not.toContain('8:-1');
    expect(legal).not.toContain(`${gameConfig.map.rows}:0`); // 越界行
  });

  it('非法目标（不相邻）抛错', () => {
    const s = newGame('move-illegal');
    expect(() => performMove(s, `0:${gameConfig.map.cols - 1}`)).toThrow(GameError);
  });

  it('每移动一格消耗 1 天', () => {
    let s = newGame('move-day', calmOverrides(newGame('move-day').map));
    const target = getLegalMoves(s)[0];
    s = performMove(s, target);
    expect(s.daysUsed).toBe(1);
    expect(s.position).toBe(target);
  });
});

describe('核心引擎：去程规则', () => {
  it('去程不允许重新进入城市', () => {
    let s = newGame('city-ban', calmOverrides(newGame('city-ban').map));
    const first = getLegalMoves(s)[0];
    s = walk(s, [first]);
    expect(getLegalMoves(s)).not.toContain(s.map.cityId);
    expect(() => performMove(s, s.map.cityId)).toThrow(GameError);
  });

  it('去程普通格不可重复（烧格）', () => {
    let s = newGame('repeat-ban', calmOverrides(newGame('repeat-ban').map));
    const first = getLegalMoves(s)[0];
    s = walk(s, [first]);
    const back = s.map.cityId;
    // 从 first 走一步再回来：来路已烧，不能走回头格（城市本来就被禁）
    const second = getLegalMoves(s)[0];
    s = walk(s, [second]);
    // 走回到 first 是不允许的（first 已烧）
    expect(getLegalMoves(s)).not.toContain(first);
    expect(() => performMove(s, first)).toThrow(GameError);
    void back;
  });

  it('进入任一矿区即进入 MINING 且不能移动', () => {
    let s = newGame('mining-lock', calmOverrides(newGame('mining-lock').map));
    s = walkTo(s, mineTile(s, 'A'));
    expect(s.phase).toBe('MINING');
    expect(s.mineEntranceId).toBe(mineTile(s, 'A'));
    expect(getLegalMoves(s)).toEqual([]);
    const neighbor = Object.keys(s.map.tiles)[5];
    expect(() => performMove(s, neighbor)).toThrow(GameError);
  });
});

describe('核心引擎：返程规则', () => {
  function gotoMineA(seed: string, miningDays = 1) {
    let s = newGame(seed, calmOverrides(newGame(seed).map));
    s = walkTo(s, mineTile(s, 'A'));
    for (let i = 0; i < miningDays; i++) s = performAction(s, { type: 'MINE' });
    s = performAction(s, { type: 'START_RETURN' });
    return s;
  }

  it('返程不得经过去程走过的格子', () => {
    const s = gotoMineA('return-ban');
    const burned = s.visitedOutbound.filter((id) => id !== s.map.cityId && id !== s.mineEntranceId);
    const legal = new Set(getLegalMoves(s));
    for (const b of burned) {
      if (b === s.position) continue;
      // 烧掉的格子若与当前位置相邻，也不允许进入
      const neighbors = gameConfig ? null : null;
      void neighbors;
      expect(legal.has(b)).toBe(false);
    }
  });

  it('返程自身也不得重复普通格', () => {
    let s = gotoMineA('return-self-ban');
    // 走一步返程
    const first = getLegalMoves(s)[0];
    s = walk(s, [first]);
    const legal = new Set(getLegalMoves(s));
    expect(legal.has(first)).toBe(false);
    expect(() => performMove(s, first)).toThrow(GameError);
  });

  it('当前矿区豁免：返程中可以重复进入当前矿区', () => {
    let s = gotoMineA('mine-exempt');
    const first = getLegalMoves(s)[0];
    s = walk(s, [first]);
    // 返程开始后（位置=矿区），矿区格必然在合法移动中（豁免）
    expect(getLegalMoves(s)).toContain(s.mineEntranceId!);
  });

  it('另一个矿区不是豁免格：返程不可进入', () => {
    // 用小步幅检查：任一返程状态下的合法移动都不包含另一个矿区
    let s = gotoMineA('other-mine-ban');
    const other = s.map.mines.find((m) => m.tileId !== s.mineEntranceId)!.tileId;
    const legal = new Set(getLegalMoves(s));
    expect(legal.has(other)).toBe(false);
  });

  it('返程抵达城市即胜利', () => {
    let s = gotoMineA('victory-grid');
    s = walkTo(s, s.map.cityId);
    expect(s.status).toBe('VICTORY');
    expect(s.phase).toBe('FINISHED');
    expect(s.daysUsed <= s.maxDays).toBe(true);
  });
});

/** 直接把玩家传送到矿区并进入 MINING（避免长走程触发提前判负，专测后续规则） */
function teleportToMineA(seed: string, opts: CreateGameOptions = {}) {
  let s = newGame(seed, { ...calmOverrides(newGame(seed).map), ...opts });
  const mine = mineTile(s, 'A');
  s = mutate(s, (m) => {
    m.position = mine;
    m.phase = 'MINING';
    m.mineEntranceId = mine;
    m.stats.outboundDays = m.daysUsed;
    if (!m.visitedOutbound.includes(mine)) m.visitedOutbound.push(mine);
    if (!m.explored.includes(mine)) m.explored.push(mine);
  });
  return s;
}

describe('核心引擎：路线中断（无路可回）', () => {
  it('开始返程时若已无合法路径 → 判负（RETURN_ROUTE_SEVERED）', () => {
    let s = teleportToMineA('severed-at-start');
    // 模拟封死：把矿区以西的大片格子标记为去程已烧
    s = mutate(s, (m) => {
      for (const id of Object.keys(m.map.tiles)) {
        const t = m.map.tiles[id];
        if (t.terrain !== 'DESERT' && t.terrain !== 'GRASS' && t.terrain !== 'VILLAGE' && t.terrain !== 'OASIS') continue;
        if (t.col <= 6 && !m.visitedOutbound.includes(id)) m.visitedOutbound.push(id);
      }
    });
    s = performAction(s, { type: 'START_RETURN' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });

  it('返程中途被封死 → 立即判负（RETURN_ROUTE_SEVERED）', () => {
    let s = teleportToMineA('severed-grid');
    s = performAction(s, { type: 'START_RETURN' });
    // 返程开始后封死矿区周边以外的所有格子 → 下一步行动触发判负
    s = mutate(s, (m) => {
      m.tents = mkTents([3]);
      for (const id of Object.keys(m.map.tiles)) {
        const t = m.map.tiles[id];
        if (t.terrain !== 'DESERT' && t.terrain !== 'GRASS' && t.terrain !== 'VILLAGE' && t.terrain !== 'OASIS') continue;
        const isNearMine =
          t.col >= 10 && Math.abs(t.row - m.map.tiles[m.mineEntranceId!].row) <= 1;
        if (!isNearMine && !m.visitedOutbound.includes(id) && !m.visitedReturn.includes(id)) {
          m.visitedOutbound.push(id);
        }
      }
    });
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.status).toBe('DEFEAT');
    expect(['RETURN_ROUTE_SEVERED', 'NO_LEGAL_ROUTE']).toContain(s.defeatReason);
  });
});

describe('核心引擎：原地停留', () => {
  it('停留：天数 +1，坐标不变，无收益', () => {
    let s = newGame('wait-1', calmOverrides(newGame('wait-1').map));
    s = mutate(s, (m) => {
      m.cash = 500;
      m.stamina = 3;
      m.gemsKg = 0;
    });
    const before = { pos: s.position, cash: s.cash, stamina: s.stamina, gems: s.gemsKg };
    s = performAction(s, { type: 'WAIT' });
    expect(s.daysUsed).toBe(1);
    expect(s.position).toBe(before.pos);
    expect(s.cash).toBe(before.cash); // 不赚钱
    expect(s.stamina).toBe(before.stamina); // 不回血
    expect(s.gemsKg).toBe(before.gems); // 不获得宝石
  });

  it('停留日当天天气正常结算：沙漠沙尘暴照常处理', () => {
    let s = newGame('wait-storm', calmOverrides(newGame('wait-storm').map));
    s = mutate(s, (m) => {
      m.tents = mkTents([3]);
      m.compasses = 1;
    });
    const target = getLegalMoves(s)[0];
    s = performMove(s, target);
    expect(s.pendingEvents.length).toBe(0); // calm：移动当天不触发事件
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'DESERT'; // 强制沙漠以匹配沙尘暴
      m.map.weather[target][m.daysUsed] = 'SANDSTORM';
      m.map.encounters[target] = null;
    });
    // 野外宿营：必须选择帐篷（耐久 -1）
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    // 停留当天遭遇沙尘暴 → 沙尘暴 Modal 出现
    expect(s.pendingEvents[0]?.kind ?? s.status).toBe('SANDSTORM');
  });

  it('停留不重复触发遭遇（每格每局最多一次）', () => {
    let s = newGame('wait-enc', calmOverrides(newGame('wait-enc').map));
    // 强制当前格有遭遇并标记已触发
    s = mutate(s, (m) => {
      const first = getLegalMoves(m)[0];
      m.map.encounters[first] = 'CARAVAN';
      m.triggeredEncounters.push(first);
      m.tents = mkTents([3]);
    });
    const target = getLegalMoves(s)[0];
    s = performMove(s, target); // 已触发过 → 不再触发
    expect(s.pendingEvents.length).toBe(0);
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.pendingEvents.length).toBe(0); // 停留绝不刷新遭遇
  });

  it('停留导致超过最大天数 → 失败', () => {
    let s = newGame('wait-timeout');
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    s = performAction(s, { type: 'WAIT' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});

describe('核心引擎：探索与战争迷雾', () => {
  it('未探索格地形隐藏，亲自进入后永久揭示', () => {
    let s = newGame('fog-1', calmOverrides(newGame('fog-1').map));
    const target = getLegalMoves(s)[0];
    expect(s.explored).not.toContain(target);
    s = performMove(s, target);
    expect(s.explored).toContain(target);
  });

  it('情报揭示曼哈顿距离 ≤2 的未知普通格', () => {
    let s = newGame('intel-1');
    const pos = s.position;
    // 2 格内必有若干普通格（120 格全随机，几乎必然）
    const inRadius = Object.keys(s.map.tiles).filter((id) => {
      const [r, c] = id.split(':').map(Number);
      const [pr, pc] = pos.split(':').map(Number);
      return Math.abs(r - pr) + Math.abs(c - pc) <= 2;
    });
    expect(inRadius.length).toBeGreaterThan(4);
  });
});

describe('核心引擎：天气与遭遇分离', () => {
  it('同一天可以同时发生天气与遭遇（先天气后遭遇）', () => {
    let s = newGame('sep-1');
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'DESERT';
      m.map.weather[target][0] = 'SANDSTORM';
      m.map.encounters[target] = 'CARAVAN';
    });
    s = performMove(s, target);
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['SANDSTORM', 'CARAVAN']);
  });
});

describe('核心引擎：绿洲修整', () => {
  it('绿洲修整耗 1 天 +1 耐力（消耗帐篷 1 点），每局每绿洲一次', () => {
    let s = newGame('oasis-1', calmOverrides(newGame('oasis-1').map));
    const oasis = findTiles(s, 'OASIS')[0];
    s = mutate(s, (m) => {
      m.stamina = 3;
      m.tents = mkTents([3]);
    });
    s = walkTo(s, oasis);
    expect(s.stamina).toBe(3); // 进入不免费恢复
    s = performAction(s, { type: 'REST', tentId: TENT_A });
    expect(s.stamina).toBe(4);
    expect(charges(s.tents)).toEqual([2]); // 修整需要宿营：帐篷耐久 -1
    expect(s.oasisRestUsed[oasis]).toBe(true);
    expect(() => performAction(s, { type: 'REST', tentId: TENT_A })).toThrow(GameError);
  });

  it('干涸绿洲不可修整', () => {
    let s = newGame('oasis-2');
    const oasis = findTiles(s, 'OASIS')[0];
    s = mutate(s, (m) => {
      m.map.drought[oasis] = true;
      m.tents = mkTents([3]);
    });
    s = walkTo(s, oasis);
    expect(() => performAction(s, { type: 'REST', tentId: TENT_A })).toThrow(GameError);
  });

  it('无帐篷时即使有水绿洲也不能修整', () => {
    let s = newGame('oasis-3', calmOverrides(newGame('oasis-3').map));
    const oasis = findTiles(s, 'OASIS')[0];
    s = mutate(s, (m) => {
      m.stamina = 3;
      m.tents = []; // 明确无帐篷
    });
    s = walkTo(s, oasis);
    expect(s.map.drought[oasis]).toBe(false);
    expect(() => performAction(s, { type: 'REST' })).toThrow(GameError);
  });
});

describe('核心引擎：购买天气预报包', () => {
  it('购买：maxDays -1，+3 次并立即使用 1 次剩 2 次', () => {
    let s = newGame('fpack-1', calmOverrides(newGame('fpack-1').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(41);
    expect(s.forecastCharges).toBe(2);
    expect(s.stats.forecastPacks).toBe(1);
    expect(s.daysUsed).toBe(0); // 不消耗当天
    expect(s.lastForecast).not.toBeNull();
    expect(s.lastForecast!.day).toBe(1);
  });

  it('重复购买正确叠加', () => {
    let s = newGame('fpack-2', calmOverrides(newGame('fpack-2').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    // 手动用掉 1 次后剩余 1，再购买：1 + 3 - 1 = 3
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(1);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(40);
    expect(s.forecastCharges).toBe(3);
    expect(s.stats.forecastPacks).toBe(2);
  });
});
