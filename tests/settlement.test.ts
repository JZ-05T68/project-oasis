import { describe, it, expect } from 'vitest';
import {
  performMove,
  performAction,
  computeSettlement,
  createNewGame,
  resolvePendingEvent,
} from '../src/game';
import { newGame, newMiniGame, calmOverrides, walk, act, mutate } from './helpers';
import { worldMap } from '../src/game/map/worldMap';

describe('结算：胜利', () => {
  it('南线完整往返：结算数字完整且正确', () => {
    let s = newGame('settle-victory', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']); // 去程 5 天
    // 出发前买装备
    const base = newGame('equip-check', calmOverrides(worldMap));
    void base;
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'MINE' }); // 采矿 2 天，4kg
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']); // 返程 6 天

    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.outcome).toBe('VICTORY');
    expect(v.seed).toBe('settle-victory');
    expect(v.daysUsed).toBe(13);
    expect(v.outboundDays).toBe(5);
    expect(v.miningDays).toBe(2);
    expect(v.returnDays).toBe(6);
    expect(v.gemsKg).toBe(4);
    expect(v.gemPrice).toBe(Math.round(v.baseGemPrice! * v.marketFactor!));
    expect(v.gemRevenue).toBe(4 * v.gemPrice!);
    expect(v.equipmentSpent).toBe(0);
    expect(v.cashRemaining).toBe(2000);
    expect(v.finalAssets).toBe(2000 + 4 * v.gemPrice!);
    expect(v.netProfit).toBe(v.finalAssets - 2000);
    expect(v.stars).not.toBeNull();
  });

  it('装备支出计入结算（现金减少、资产不变部分）', () => {
    let s = newGame('settle-equip', calmOverrides(worldMap));
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']);
    const v = computeSettlement(s);
    expect(v.equipmentSpent).toBe(500);
    expect(v.cashRemaining).toBe(1500);
    expect(v.gemRevenue).toBe(0); // 没挖矿
    expect(v.finalAssets).toBe(1500);
    expect(v.netProfit).toBe(-500);
  });

  it('天气预报次数计入结算', () => {
    let s = newGame('settle-fc', calmOverrides(worldMap));
    s = performMove(s, 'sg1');
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'FORECAST_OFFER', accept: true });
    expect(s.stats.forecastCount).toBe(1);
    s = walk(s, ['mg1', 'md1']);
    expect(computeSettlement(s).forecastCount).toBe(1);
  });
});

describe('结算：失败', () => {
  it('超时失败：宝石无法出售', () => {
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['city', 'b'],
        ['b', 'm'],
      ],
    );
    s = mutate(s, (m) => {
      m.daysUsed = 40;
    });
    s = walk(s, ['a', 'm']); // 42 天进矿
    s = act(s, { type: 'MINE' }); // 43 天 → 超时（越界瞬间判负，本次挖矿无收获）
    expect(s.status).toBe('DEFEAT');
    const v = computeSettlement(s);
    expect(v.outcome).toBe('DEFEAT');
    expect(v.defeatReason).toBe('TIMEOUT');
    expect(v.gemsKg).toBe(0);
    expect(v.gemRevenue).toBe(0);
    expect(v.finalAssets).toBe(v.cashRemaining);
  });

  it('耐力归零失败：销售收入为 0', () => {
    let s = newGame('settle-stamina', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    s = walk(s, ['mg1']);
    s = mutate(s, (m) => {
      m.weather['md1'][1] = 'HEAT';
    });
    s = performMove(s, 'md1');
    expect(s.status).toBe('DEFEAT');
    const v = computeSettlement(s);
    expect(v.defeatReason).toBe('STAMINA_EXHAUSTED');
    expect(v.gemRevenue).toBe(0);
    expect(v.netProfit).toBe(v.finalAssets - 2000);
  });

  it('返程路线中断失败', () => {
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['a', 'b'],
        ['b', 'm'],
      ],
    );
    s = walk(s, ['a', 'b', 'm']);
    expect(s.status).toBe('DEFEAT');
    const v = computeSettlement(s);
    expect(v.defeatReason).toBe('RETURN_ROUTE_SEVERED');
    expect(v.gemRevenue).toBe(0);
  });

  it('结算显示本局 Seed', () => {
    let s = newGame('seed-visible', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.status = 'DEFEAT';
      m.defeatReason = 'TIMEOUT';
      m.phase = 'FINISHED';
    });
    expect(computeSettlement(s).seed).toBe('seed-visible');
  });
});

describe('42 天边界', () => {
  it('第 42 天恰好回城属于成功', () => {
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['city', 'b'],
        ['b', 'm'],
      ],
    );
    s = mutate(s, (m) => {
      m.daysUsed = 38;
    });
    s = walk(s, ['a', 'm']); // 40
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['b', 'city']); // 41, 42
    expect(s.status).toBe('VICTORY');
    expect(s.daysUsed).toBe(42);
  });

  it('第 43 天才回城 → 失败', () => {
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['city', 'b'],
        ['b', 'm'],
      ],
    );
    s = mutate(s, (m) => {
      m.daysUsed = 39;
    });
    s = walk(s, ['a', 'm']); // 41
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['b']); // 42
    s = performMove(s, 'city'); // 43 → 超时
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });

  it('42 天后任何耗天行动都会失败', () => {
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['city', 'b'],
        ['b', 'm'],
      ],
    );
    s = mutate(s, (m) => {
      m.daysUsed = 40;
    });
    s = walk(s, ['a', 'm']); // 42
    s = act(s, { type: 'MINE' }); // 43
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});

describe('Seed 可复现性', () => {
  function scriptedPlay(seed: string) {
    let s = newGame(seed, calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'MINE' });
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']);
    return s;
  }

  it('同 Seed + 同操作序列 → 完全相同的最终状态', () => {
    const a = scriptedPlay('repro-seed');
    const b = scriptedPlay('repro-seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.gemPrice).toBe(b.gemPrice);
    expect(computeSettlement(a)).toEqual(computeSettlement(b));
  });

  it('不同 Seed → 天气与遭遇表不同（随机性来自 Seed）', () => {
    const a = createNewGame('repro-a');
    const b = createNewGame('repro-b');
    expect(a.weather).not.toEqual(b.weather);
    expect(a.encounterRolls).not.toEqual(b.encounterRolls);
  });

  it('不同 Seed 的同一路线可能得到不同的市场系数', () => {
    const prices = new Set<number>();
    for (const seed of ['mkt-1', 'mkt-2', 'mkt-3', 'mkt-4', 'mkt-5', 'mkt-6']) {
      let s = newGame(seed, calmOverrides(worldMap));
      s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
      prices.add(s.marketFactor!);
    }
    // 至少出现两种不同的市场系数（0.95~1.05 连续分布）
    expect(prices.size).toBeGreaterThanOrEqual(2);
  });
});
