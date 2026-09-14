import { describe, it, expect } from 'vitest';
import { performMove, performAction, resolvePendingEvent, getLegalMoves } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, mutate, charges } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';

/** 遭遇系统（v0.1.2）：按格预生成、首次进入触发、每格每局一次 */

function gotoTileWithEncounter(seed: string, kind: 'CARAVAN' | 'THIEF' | 'MARKET' | 'HERDSMAN', cash = 2000) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  s = mutate(s, (m) => {
    m.cash = cash;
  });
  const target = getLegalMoves(s)[0];
  s = mutate(s, (m) => {
    m.map.encounters[target] = kind;
  });
  s = performMove(s, target);
  return s;
}

describe('沙漠商队', () => {
  it('触发商队；与天气独立（可同日叠加）', () => {
    let s = newGame('caravan-1');
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'DESERT'; // 强制沙漠以匹配沙尘暴天气
      m.map.encounters[target] = 'CARAVAN';
      m.map.weather[target][0] = 'SANDSTORM';
    });
    s = performMove(s, target);
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['SANDSTORM', 'CARAVAN']);
  });

  it('选项 A：花 300 元买二手帐篷，不耗时间', () => {
    let s = gotoTileWithEncounter('caravan-buy', 'CARAVAN');
    const ev = s.pendingEvents[0];
    expect(ev.kind).toBe('CARAVAN');
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'BUY_TENT' });
    expect(s.cash).toBe(2000 - gameConfig.caravanTentPrice);
    expect(charges(s.tents)).toEqual([gameConfig.caravanTentCharges]);
    expect(s.equipmentSpent).toBe(gameConfig.caravanTentPrice);
    expect(s.daysUsed).toBe(1);
  });

  it('现金不足 300 时购买被拒绝', () => {
    let s = gotoTileWithEncounter('caravan-broke', 'CARAVAN', 200);
    const ev = s.pendingEvents[0];
    expect(() => resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'BUY_TENT' })).toThrow(GameError);
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    expect(s.cash).toBe(200);
  });

  it('选项 B：免费揭示曼哈顿距离 ≤2 的未知普通格', () => {
    let s = gotoTileWithEncounter('caravan-intel', 'CARAVAN');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    expect(s.daysUsed).toBe(1); // 不耗时间
    expect(s.intelKnown.length).toBeGreaterThan(0);
    for (const id of s.intelKnown) {
      const terrain = s.map.tiles[id].terrain;
      expect(['DESERT', 'GRASS', 'VILLAGE', 'OASIS']).toContain(terrain);
      // 曼哈顿距离 ≤2
      const [r, c] = id.split(':').map(Number);
      const [pr, pc] = s.position.split(':').map(Number);
      expect(Math.abs(r - pr) + Math.abs(c - pc)).toBeLessThanOrEqual(2);
    }
  });
});

describe('村庄盗贼', () => {
  it('触发盗贼：stolen = min(300, 现金)', () => {
    let s = gotoTileWithEncounter('thief-1', 'THIEF');
    const ev = s.pendingEvents[0];
    expect(ev.kind).toBe('THIEF');
    if (ev.kind === 'THIEF') expect(ev.stolen).toBe(300);
  });

  it('现金低于 300 时只偷走全部现金，现金永不为负', () => {
    let s = gotoTileWithEncounter('thief-poor', 'THIEF', 150);
    const ev = s.pendingEvents[0];
    if (ev.kind !== 'THIEF') throw new Error('应为盗贼事件');
    expect(ev.stolen).toBe(150);
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'GIVE_UP' });
    expect(s.cash).toBe(0);
  });

  it('追回：消耗 1 天，全额找回', () => {
    let s = gotoTileWithEncounter('thief-chase', 'THIEF');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'CHASE' });
    expect(s.cash).toBe(2000);
    expect(s.daysUsed).toBe(2);
  });

  it('追回导致超过 maxDays → 按规则失败', () => {
    let s = gotoTileWithEncounter('thief-timeout', 'THIEF');
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'CHASE' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});

describe('村庄繁荣市集', () => {
  it('选项 A 八折购物：本次访问帐篷 320 / 指南针 80', () => {
    let s = newGame('market-1', calmOverrides(newGame('market-1').map));
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'VILLAGE'; // 繁荣市集只发生在村庄
      m.map.encounters[target] = 'MARKET';
    });
    s = performMove(s, target);
    const ev = s.pendingEvents[0];
    expect(ev.kind).toBe('MARKET');
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'TAKE_DISCOUNT' });
    expect(s.visitDiscount).toBe(true);
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    expect(s.cash).toBe(2000 - 320 - 80);
    expect(s.daysUsed).toBe(1);
  });

  it('选项 B 打工：1 天 +500 元', () => {
    let s = gotoTileWithEncounter('market-2', 'MARKET');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'WORK' });
    expect(s.cash).toBe(2500);
    expect(s.daysUsed).toBe(2);
    expect(s.visitDiscount).toBe(false);
  });

  it('二选一不可兼得：打折后无打工', () => {
    let s = gotoTileWithEncounter('market-3', 'MARKET');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'TAKE_DISCOUNT' });
    expect(s.pendingEvents.filter((e) => e.kind === 'MARKET')).toHaveLength(0);
  });
});

describe('草地牧民指引', () => {
  it('免费揭示周边 ≤2 格未知普通格，不耗时间', () => {
    let s = gotoTileWithEncounter('herdsman-1', 'HERDSMAN');
    expect(s.daysUsed).toBe(1);
    expect(s.intelKnown.length).toBeGreaterThan(0);
    expect(s.explored).not.toContain(s.intelKnown[0]);
  });
});

describe('遭遇：每格每局最多一次', () => {
  it('首次进入触发后，triggeredEncounters 永久记录', () => {
    let s = newGame('enc-once', calmOverrides(newGame('enc-once').map));
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.encounters[target] = 'CARAVAN';
    });
    s = performMove(s, target);
    expect(s.pendingEvents[0].kind).toBe('CARAVAN');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    expect(s.triggeredEncounters).toContain(target);
    expect(s.pendingEvents.length).toBe(0);
  });
});

describe('遭遇概率配置', () => {
  it('基础概率放入配置（v0.1.2a：35%）', () => {
    expect(gameConfig.encounter.baseProbability).toBe(0.35);
    expect(gameConfig.encounter.villageThiefRatio).toBe(0.5);
  });
});
