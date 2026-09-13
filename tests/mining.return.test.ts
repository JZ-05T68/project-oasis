import { describe, it, expect } from 'vitest';
import { performMove, performAction, getLegalMoves } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, walkTo, walk, mutate, mineTile, act, returnPath } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';

function gotoMineA(seed: string) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  s = walkTo(s, mineTile(s, 'A'));
  return s;
}

describe('矿区：进入与价格锁定', () => {
  it('首次进入矿区即锁定该矿区的动态评估价', () => {
    const s = gotoMineA('mine-lock');
    expect(s.phase).toBe('MINING');
    expect(s.mineEntranceId).toBe(mineTile(s, 'A'));
    expect(s.gemPrice).not.toBeNull();
    const mine = s.map.mines.find((m) => m.slot === 'A')!;
    expect(s.gemPrice).toBe(mine.gemPrice);
    expect(s.routeScore).not.toBeNull();
    expect(s.stats.outboundDays).toBe(s.daysUsed);
  });

  it('价格在本局开局已确定：移动/掉耐力/用装备都不会改变', () => {
    let s = newGame('price-stable', calmOverrides(newGame('price-stable').map));
    const priceA = s.map.mines.find((m) => m.slot === 'A')!.gemPrice;
    // 模拟玩家行为：买装备、掉耐力、绕路，都不会改变地图评估价
    s = mutate(s, (m) => {
      m.cash = 1000;
      m.stamina = 2;
      m.tents = [3];
      m.compasses = 1;
    });
    s = walkTo(s, mineTile(s, 'A'));
    expect(s.phase).toBe('MINING');
    expect(s.routeScore).not.toBeNull(); // 评分随路线变化
    expect(s.gemPrice).toBe(priceA); // 价格纹丝不动
  });

  it('价格由地图生成时确定：同 Seed 两局价格一致', () => {
    const a = gotoMineA('price-determinism');
    const b = gotoMineA('price-determinism');
    expect(a.gemPrice).toBe(b.gemPrice);
    expect(a.routeScore).toBe(b.routeScore);
  });

  it('价格在 clamp 范围 80~320 内', () => {
    const s = newGame('price-range');
    for (const mine of s.map.mines) {
      expect(mine.gemPrice).toBeGreaterThanOrEqual(gameConfig.mineValuation.clampMin);
      expect(mine.gemPrice).toBeLessThanOrEqual(gameConfig.mineValuation.clampMax);
    }
  });
});

describe('采矿与返程', () => {
  it('挖矿：1 天 = 2kg，累计正确', () => {
    let s = gotoMineA('mining-1');
    s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(2);
    expect(s.stats.miningDays).toBe(1);
    s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(4);
  });

  it('开始返程：不耗时间、从同一矿区出发', () => {
    let s = gotoMineA('return-start');
    const day = s.daysUsed;
    s = performAction(s, { type: 'START_RETURN' });
    expect(s.phase).toBe('RETURN');
    expect(s.stats.returnStartDay).toBe(day);
    expect(s.visitedReturn).toContain(s.mineEntranceId);
  });

  it('连挖多天后正常返城胜利', () => {
    let s = gotoMineA('mining-long');
    for (let i = 0; i < 5; i++) s = act(s, { type: 'MINE' });
    expect(s.gemsKg).toBe(10);
    s = performAction(s, { type: 'START_RETURN' });
    s = walkTo(s, s.map.cityId);
    expect(s.status).toBe('VICTORY');
    expect(s.gemsKg).toBe(10);
  });

  it('MINING 阶段不能移动', () => {
    const s = gotoMineA('mining-nomove');
    expect(getLegalMoves(s)).toEqual([]);
    const any = Object.keys(s.map.tiles)[3];
    expect(() => performMove(s, any)).toThrow(GameError);
  });
});

describe('时间模型与失败边界', () => {
  it('daysUsed == maxDays 当天回城允许成功', () => {
    let s = newGame('edge-eq', calmOverrides(newGame('edge-eq').map));
    s = walkTo(s, mineTile(s, 'A'));
    s = performAction(s, { type: 'START_RETURN' });
    const path = returnPath(s, s.map.cityId);
    // 把 maxDays 恰好设为“走完返程”所需天数：最后一天回城 = maxDays
    s = mutate(s, (m) => {
      m.maxDays = m.daysUsed + path.length;
    });
    s = walk(s, path);
    expect(s.status).toBe('VICTORY');
    expect(s.daysUsed).toBe(s.maxDays);
  });

  it('daysUsed > maxDays 立即失败', () => {
    let s = newGame('edge-over', calmOverrides(newGame('edge-over').map));
    s = mutate(s, (m) => {
      m.daysUsed = 41;
      m.maxDays = 42;
    });
    const target = getLegalMoves(s)[0];
    s = performMove(s, target); // 41→42 OK
    expect(s.daysUsed).toBe(42);
    expect(s.status).toBe('ONGOING');
    const next = getLegalMoves(s);
    if (next.length > 0) {
      s = performMove(s, next[0]); // 42→43 失败
      expect(s.status).toBe('DEFEAT');
      expect(s.defeatReason).toBe('TIMEOUT');
    }
  });

  it('已用完最大天数仍未回城 → 超时失败', () => {
    let s = newGame('edge-out');
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    const target = getLegalMoves(s)[0];
    s = performMove(s, target);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});

