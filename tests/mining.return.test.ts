import { describe, it, expect } from 'vitest';
import {
  performAction,
  getAvailableActions,
  getLegalMoves,
} from '../src/game';
import { newGame, calmOverrides, walk, act } from './helpers';
import { worldMap } from '../src/game/map/worldMap';
import { gameConfig } from '../src/game/config/gameConfig';

function gotoMine(seed: string, route: string[] = ['sg1', 'sv', 'so', 'sg2', 'mineS']) {
  let s = newGame(seed, calmOverrides(worldMap));
  s = walk(s, route);
  return s;
}

describe('宝库：进入与价格锁定', () => {
  it('首次进入矿区入口即锁定路线评分与固定价格', () => {
    const s = gotoMine('mine-lock');
    expect(s.phase).toBe('MINING');
    expect(s.mineEntranceId).toBe('mineS');
    expect(s.routeScore).not.toBeNull();
    expect(s.stats.outboundDays).toBe(5);
    // v0.1.1：南矿区固定价 100 元/kg，市场系数关闭
    expect(s.baseGemPrice).toBe(gameConfig.mineBasePrice.SOUTH);
    expect(s.baseGemPrice).toBe(100);
    expect(s.marketFactor).toBe(1);
    expect(s.gemPrice).toBe(100);
  });

  it('同一 Seed 同一路线 → 完全相同的评分与价格', () => {
    const a = gotoMine('price-determinism');
    const b = gotoMine('price-determinism');
    expect(a.routeScore).toBe(b.routeScore);
    expect(a.baseGemPrice).toBe(b.baseGemPrice);
    expect(a.marketFactor).toBe(b.marketFactor);
    expect(a.gemPrice).toBe(b.gemPrice);
  });

  it('价格在进矿后不可改变（挖矿天数不影响单价）', () => {
    let s = gotoMine('price-locked');
    const lockedPrice = s.gemPrice;
    const lockedBase = s.baseGemPrice;
    const lockedFactor = s.marketFactor;
    const lockedScore = s.routeScore;
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'MINE' });
    expect(s.gemPrice).toBe(lockedPrice);
    expect(s.baseGemPrice).toBe(lockedBase);
    expect(s.marketFactor).toBe(lockedFactor);
    expect(s.routeScore).toBe(lockedScore);
  });

  it('三个矿区入口各自的评分不同（南 < 中 < 北 由地图测试保证，这里验证入口独立）', () => {
    const south = gotoMine('entrances', ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    const central = gotoMine('entrances', ['mg1', 'md1', 'wd1', 'wo', 'wg1', 'nd2', 'cd1', 't3', 'mineC']);
    const north = gotoMine('entrances', ['w0', 'w1', 'n0', 'n3', 't1', 't2', 't3', 't4', 't5', 'mineN']);
    expect(south.routeScore).not.toBe(central.routeScore);
    expect(central.routeScore).not.toBe(north.routeScore);
    expect(south.mineEntranceId).toBe('mineS');
    expect(central.mineEntranceId).toBe('mineC');
    expect(north.mineEntranceId).toBe('mineN');
  });
});

describe('采矿与返程', () => {
  it('挖矿：1 天 = 2kg，累计正确', () => {
    let s = gotoMine('mining-1');
    s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(2);
    expect(s.stats.miningDays).toBe(1);
    expect(s.daysUsed).toBe(6);
    s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(4);
    expect(s.stats.miningDays).toBe(2);
  });

  it('采矿阶段提供挖矿与开始返程两个行动', () => {
    const s = gotoMine('mining-actions');
    const actions = getAvailableActions(s).map((a) => a.action.type);
    expect(actions).toContain('MINE');
    expect(actions).toContain('START_RETURN');
  });

  it('开始返程：不耗时间、阶段切换、从同一入口出发', () => {
    let s = gotoMine('return-start');
    s = performAction(s, { type: 'START_RETURN' });
    expect(s.phase).toBe('RETURN');
    expect(s.stats.returnStartDay).toBe(s.daysUsed);
    expect(s.daysUsed).toBe(5); // 不耗时间
    expect(s.visitedReturn).toContain('mineS');
    // 从同一入口出发：mg2（另一入口不可能瞬移到达）
    expect(getLegalMoves(s)).toContain('mg2');
  });

  it('挖矿天数由玩家自由决定：连挖多天后仍可正常返程', () => {
    let s = gotoMine('mining-long');
    for (let i = 0; i < 10; i++) s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(20);
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']);
    expect(s.status).toBe('VICTORY');
    expect(s.gemsKg).toBe(20);
  });
});
