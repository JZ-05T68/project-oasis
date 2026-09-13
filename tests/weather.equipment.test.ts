import { describe, it, expect } from 'vitest';
import { performMove, getLegalMoves, resolvePendingEvent } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, mutate, withWeather, nearestTileOf, pathTo, walk } from './helpers';

/** 天气系统（沙漠高温/沙尘暴、草地暴雨/泥沼）与装备（帐篷/指南针） */

/** 沙尘暴场景：走到最近的沙漠格，把该格抵达日设为沙尘暴 */
function stormScenario(seed: string, tents: number[], compasses: number) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  s = mutate(s, (m) => {
    m.tents = tents;
    m.compasses = compasses;
  });
  const target = nearestTileOf(s, 'DESERT');
  const path = pathTo(s, target);
  const day = path.length;
  s = withWeather(s, target, day, 'SANDSTORM');
  if (path.length > 1) s = walk(s, path.slice(0, -1)); // 中间步
  s = performMove(s, path[path.length - 1]); // 最后一步：沙尘暴 Modal 待决
  return { s, target, day };
}

/** 暴雨场景：走到最近的草地格 */
function rainScenario(seed: string, tents: number[]) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  s = mutate(s, (m) => {
    m.tents = tents;
  });
  const target = nearestTileOf(s, 'GRASS');
  const path = pathTo(s, target);
  const day = path.length;
  s = withWeather(s, target, day, 'RAINSTORM');
  if (path.length > 1) s = walk(s, path.slice(0, -1)); // 中间步
  s = performMove(s, path[path.length - 1]); // 最后一步：暴雨 Modal 待决
  return { s, target, day };
}

describe('沙尘暴：四象限（帐篷 × 指南针）', () => {
  it('有帐篷 + 使用指南针：不掉耐力、不迷路，帐篷 -1、指南针 -1', () => {
    const { s, day } = stormScenario('storm-1', [3], 1);
    expect(s.pendingEvents[0].kind).toBe('SANDSTORM');
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: true });
    expect(s2.tents).toEqual([2]);
    expect(s2.compasses).toBe(0);
    expect(s2.stamina).toBe(5);
    expect(s2.daysUsed).toBe(day); // 无额外损失
    expect(s2.position).toBe(s.position);
  });

  it('有帐篷 + 不用指南针：不掉耐力，帐篷 -1，迷路额外损失 1 天', () => {
    const { s, day } = stormScenario('storm-2', [3], 0);
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    expect(s2.tents).toEqual([2]);
    expect(s2.stamina).toBe(5);
    expect(s2.daysUsed).toBe(day + 1); // 迷路 +1 天
    expect(s2.position).toBe(s.position); // 迷路不传送
  });

  it('无帐篷 + 使用指南针：耐力 -1，不迷路，指南针 -1', () => {
    const { s, day } = stormScenario('storm-3', [], 1);
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: true });
    expect(s2.compasses).toBe(0);
    expect(s2.stamina).toBe(4);
    expect(s2.daysUsed).toBe(day);
  });

  it('无帐篷 + 不用指南针：耐力 -1 且迷路额外损失 1 天', () => {
    const { s, day } = stormScenario('storm-4', [], 0);
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: false });
    expect(s2.stamina).toBe(4);
    expect(s2.daysUsed).toBe(day + 1);
  });

  it('帐篷 3 次沙漠耐久：第 3 次抵挡后整顶消失', () => {
    const { s } = stormScenario('storm-deplete', [1], 0);
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    expect(s2.tents).toEqual([]); // 1 → 0 → 整顶消失
    expect(s2.stamina).toBe(5); // 帐篷抵挡过，不掉耐力
  });

  it('拥有装备时引擎必须询问玩家，绝不自动消耗', () => {
    const { s } = stormScenario('storm-ask', [3], 1);
    expect(s.pendingEvents.length).toBe(1);
    expect(s.tents).toEqual([3]);
    expect(s.compasses).toBe(1);
  });

  it('没有对应装备时选择无效并抛错', () => {
    const { s } = stormScenario('storm-invalid', [], 0);
    const ev = s.pendingEvents[0];
    expect(() => resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false })).toThrow(GameError);
    expect(() => resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: true })).toThrow(GameError);
  });
});

describe('草地暴雨：整顶帐篷的取舍', () => {
  it('使用帐篷：整顶立即消失（2/3 剩余也一样），不掉耐力', () => {
    const { s } = rainScenario('rain-1', [2, 3]);
    const ev = s.pendingEvents[0];
    expect(ev.kind).toBe('RAINSTORM');
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: true });
    expect(s2.tents).toEqual([3]); // 耐久最低的一顶被整顶消耗
    expect(s2.stamina).toBe(5);
  });

  it('不使用帐篷：耐力 -1，帐篷保留', () => {
    const { s } = rainScenario('rain-2', [3]);
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: false });
    expect(s2.tents).toEqual([3]);
    expect(s2.stamina).toBe(4);
  });

  it('没有帐篷：不弹出选择，直接耐力 -1', () => {
    const { s } = rainScenario('rain-3', []);
    expect(s.pendingEvents.filter((e) => e.kind === 'RAINSTORM')).toHaveLength(0);
    expect(s.stamina).toBe(4);
  });

  it('暴雨耗尽最后耐力 → 立即失败', () => {
    let s = newGame('rain-death');
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    const target = getLegalMoves(s)[0];
    s = withWeather(s, target, 1, 'RAINSTORM');
    s = performMove(s, target);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
  });
});

describe('高温与泥沼', () => {
  it('高温：耐力 -1，无额外时间损失', () => {
    let s = newGame('heat-1', calmOverrides(newGame('heat-1').map));
    const target = nearestTileOf(s, 'DESERT');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'HEAT');
    s = walk(s, path);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(path.length);
  });

  it('泥沼：移动已完成，额外损失 1 天，停留在当前格', () => {
    let s = newGame('mud-1', calmOverrides(newGame('mud-1').map));
    const target = nearestTileOf(s, 'GRASS');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'MUD');
    s = walk(s, path);
    expect(s.daysUsed).toBe(path.length + 1); // 移动 + 泥沼
    expect(s.position).toBe(target);
  });

  it('泥沼把天数推过上限 → 超时失败', () => {
    let s = newGame('mud-timeout', calmOverrides(newGame('mud-timeout').map));
    const target = nearestTileOf(s, 'GRASS');
    const path = pathTo(s, target);
    s = mutate(s, (m) => {
      m.daysUsed = 41;
      m.maxDays = 42;
    });
    s = withWeather(s, target, 42, 'MUD');
    // 移动到位：天数 41 + path.length；最后一步的抵达日应恰为 42，随后泥沼 +1 → 43 > 42
    // 为保证确定性：将天数直接设为 42 - path.length + 1，使最后一步落在第 42 天
    s = mutate(s, (m) => {
      m.daysUsed = 42 - path.length;
    });
    s = walk(s, path);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
    expect(s.daysUsed).toBe(43);
  });

  it('耐力归零立即失败', () => {
    let s = newGame('stamina-death', calmOverrides(newGame('stamina-death').map));
    const target = nearestTileOf(s, 'DESERT');
    const path = pathTo(s, target);
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    s = withWeather(s, target, path.length, 'HEAT');
    s = walk(s, path);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
  });
});
