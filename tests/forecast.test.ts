import { describe, it, expect } from 'vitest';
import { performMove, performAction, getLegalMoves } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, mutate, walkTo } from './helpers';

/** 天气预报（v0.1.2）：单日局部 + 可储存次数 */
describe('天气预报：购买机制', () => {
  it('首次购买：maxDays 42→41，获得 3 次，自动使用 1 次剩 2 次，并立即显示明天', () => {
    let s = newGame('fc-buy-1', calmOverrides(newGame('fc-buy-1').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(41);
    expect(s.daysUsed).toBe(0); // 购买不消耗当天
    expect(s.forecastCharges).toBe(2);
    expect(s.stats.forecastPacks).toBe(1);
    expect(s.lastForecast).not.toBeNull();
    expect(s.lastForecast!.day).toBe(1); // 明天
  });

  it('重复购买正确叠加：1 存量 + 3 - 1 自动 = 3', () => {
    let s = newGame('fc-buy-2', calmOverrides(newGame('fc-buy-2').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(1);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(40);
    expect(s.forecastCharges).toBe(3);
    expect(s.stats.forecastPacks).toBe(2);
  });

  it('购买后手动使用：不消耗 daysUsed、不再减少 maxDays', () => {
    let s = newGame('fc-use-1', calmOverrides(newGame('fc-use-1').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const before = { day: s.daysUsed, maxDays: s.maxDays };
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.daysUsed).toBe(before.day);
    expect(s.maxDays).toBe(before.maxDays);
    expect(s.forecastCharges).toBe(before.day === 0 ? 1 : 1); // 2 - 1
  });

  it('次数不能低于 0：无次数时使用抛错', () => {
    const s = newGame('fc-use-2');
    expect(s.forecastCharges).toBe(0);
    expect(() => performAction(s, { type: 'USE_FORECAST' })).toThrow(GameError);
  });

  it('储存次数不过期、不随移动消失', () => {
    let s = newGame('fc-save', calmOverrides(newGame('fc-save').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    // 连续移动多天
    for (let i = 0; i < 3; i++) {
      const legal = getLegalMoves(s);
      s = performMove(s, legal[0]);
    }
    expect(s.forecastCharges).toBe(2); // 不过期
  });

  it('天数推进后旧预报失效', () => {
    let s = newGame('fc-stale', calmOverrides(newGame('fc-stale').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast).not.toBeNull();
    const legal = getLegalMoves(s);
    s = performMove(s, legal[0]);
    expect(s.lastForecast).toBeNull(); // 移动一天后失效
  });

  it('daysUsed == maxDays 时购买会立即超时失败', () => {
    let s = newGame('fc-death');
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});

describe('天气预报：空间范围（当前格 + 8 邻域）', () => {
  it('内部格：显示当前 + 8 = 9 格', () => {
    let s = newGame('fc-area-in', calmOverrides(newGame('fc-area-in').map));
    // 走到内部格：找一个四邻都在图内的格子
    const inner = Object.values(s.map.tiles).find(
      (t) => t.row > 0 && t.row < s.map.rows - 1 && t.col > 0 && t.col < s.map.cols - 1,
    )!;
    s = mutate(s, (m) => {
      m.position = inner.id;
      m.visitedOutbound.push(inner.id);
      m.explored.push(inner.id);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(9);
    expect(s.lastForecast!.cells.filter((c) => c.isCurrent).length).toBe(1);
  });

  it('边缘格：显示当前 + 5 = 6 格', () => {
    let s = newGame('fc-area-edge', calmOverrides(newGame('fc-area-edge').map));
    const edge = Object.values(s.map.tiles).find(
      (t) => t.col === 0 && t.row > 0 && t.row < s.map.rows - 1,
    )!;
    s = mutate(s, (m) => {
      m.position = edge.id;
      m.visitedOutbound.push(edge.id);
      m.explored.push(edge.id);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(6);
  });

  it('角落格：显示当前 + 3 = 4 格', () => {
    let s = newGame('fc-area-corner', calmOverrides(newGame('fc-area-corner').map));
    // 右上角 (0, cols-1)
    const corner = `0:${s.map.cols - 1}`;
    s = mutate(s, (m) => {
      m.position = corner;
      m.visitedOutbound.push(corner);
      m.explored.push(corner);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(4);
  });

  it('只显示下一天：day = daysUsed + 1', () => {
    let s = newGame('fc-oneday', calmOverrides(newGame('fc-oneday').map));
    const legal = getLegalMoves(s);
    s = performMove(s, legal[0]);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.day).toBe(s.daysUsed + 1);
    // 单日：视图无“后天”信息
    expect(Object.keys(s.lastForecast!)).toEqual(['day', 'cells']);
  });

  it('预报不受战争迷雾限制：未知格显示坐标与天气，但不永久揭示地形', () => {
    let s = newGame('fc-fog', calmOverrides(newGame('fc-fog').map));
    // 城市角落只有 4 格视野；全部未探索（除城市与矿区）
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const unknownCells = s.lastForecast!.cells.filter((c) => !c.terrainKnown);
    expect(unknownCells.length).toBeGreaterThan(0);
    for (const c of unknownCells) {
      expect(s.explored).not.toContain(c.tileId);
      expect(s.intelKnown).not.toContain(c.tileId);
      // 天气仍然可见（合法推断）
      expect(typeof c.weather).toBe('string');
    }
  });
});

describe('天气预报：等待避灾配合', () => {
  it('停留决策依赖预报：预报显示当前格明天沙尘暴时，玩家可提前得知', () => {
    let s = newGame('fc-wait-storm');
    const legal = getLegalMoves(s);
    const target = legal[0];
    s = performMove(s, target);
    // 强制当前格为沙漠并覆盖明天为沙尘暴
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'DESERT';
      m.map.weather[target][m.daysUsed] = 'SANDSTORM'; // 明天（1-based 索引 = daysUsed）
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const cell = s.lastForecast!.cells.find((c) => c.isCurrent)!;
    expect(cell.weather).toBe('SANDSTORM');
    // 玩家此时可以选择停留——停留当天将触发沙尘暴 Modal
    s = performAction(s, { type: 'WAIT' });
    expect(s.pendingEvents[0]?.kind ?? '').toBe('SANDSTORM');
  });

  it('预报次数用尽后无法再查看', () => {
    let s = newGame('fc-empty', calmOverrides(newGame('fc-empty').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    s = performAction(s, { type: 'USE_FORECAST' });
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(0);
    expect(() => performAction(s, { type: 'USE_FORECAST' })).toThrow(GameError);
  });

  it('矿区内也可以购买与使用预报（为返程做准备）', () => {
    let s = newGame('fc-mine');
    s = walkTo(s, s.map.mines[0].tileId);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    expect(s.lastForecast).not.toBeNull();
  });
});
