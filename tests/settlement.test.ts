import { describe, it, expect } from 'vitest';
import { performMove, performAction, computeSettlement, resolvePendingEvent, createNewGame, getLegalMoves } from '../src/game';
import { newGame, calmOverrides, walkTo, mutate, mineTile, nearestMineTile, act } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';


describe('结算：胜利', () => {
  it('完整往返：结算数字完整且正确（最终鉴定价返城公布）', () => {
    let s = newGame('settle-victory', calmOverrides(newGame('settle-victory').map));
    const mine = nearestMineTile(s);
    s = walkTo(s, mine.tileId);
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'MINE' });
    const outbound = s.stats.outboundDays!;
    s = performAction(s, { type: 'START_RETURN' });
    s = walkTo(s, s.map.cityId);

    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.outcome).toBe('VICTORY');
    expect(v.seed).toBe('settle-victory');
    expect(v.maxDays).toBe(42);
    expect(v.outboundDays).toBe(outbound);
    expect(v.miningDays).toBe(2);
    expect(v.returnDays).toBe(s.daysUsed - s.stats.returnStartDay!);
    expect(v.gemsKg).toBe(4);
    expect(v.gemPrice).not.toBeNull(); // 胜利后公布
    expect(v.gemPrice).toBe(s.map.mines.find((m) => m.tileId === mine.tileId)!.gemPrice);
    expect(v.gemRevenue).toBe(4 * v.gemPrice!);
    // v0.3.0：最终现金 = 现金 + 宝石净收入 − 结算期费用（这里体现为远征运营成本）
    expect(v.finalAssets).toBe(s.cash + 4 * v.gemPrice! - v.settlementExpenses);
    expect(v.settlementExpenses).toBe(v.operatingCost);
    expect(v.accountingOk).toBe(true);
    expect(v.netProfit).toBe(v.finalAssets - 2000);
    expect(v.mineSlot).toBe(mine.slot);
  });

  it('装备支出计入结算', () => {
    let s = newGame('settle-equip', calmOverrides(newGame('settle-equip').map));
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    const mine = nearestMineTile(s);
    s = walkTo(s, mine.tileId);
    s = performAction(s, { type: 'START_RETURN' });
    s = walkTo(s, s.map.cityId);
    const v = computeSettlement(s);
    // 帐篷价为可调参数：从 gameConfig 推导，不写死 500 / 1500
    const spent = gameConfig.tentPrice + gameConfig.compassPrice;
    expect(v.equipmentSpent).toBe(spent);
    expect(v.cashRemaining).toBe(gameConfig.startCash - spent);
    expect(v.gemRevenue).toBe(0); // 未挖矿
    expect(v.finalAssets).toBe(gameConfig.startCash - spent);
    expect(v.netProfit).toBe(-spent);
    expect(v.mineSlot).toBe(mine.slot);
  });

  it('天气预报包购买次数计入结算', () => {
    let s = newGame('settle-fc', calmOverrides(newGame('settle-fc').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    s = performAction(s, { type: 'USE_FORECAST' });
    s = walkTo(s, nearestMineTile(s).tileId);
    expect(computeSettlement(s).forecastPacks).toBe(1);
  });
});

describe('结算：失败', () => {
  it('超时失败：宝石无法出售', () => {
    let s = newGame('settle-timeout', calmOverrides(newGame('settle-timeout').map));
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    const target = getLegalMoves(s)[0];
    s = performMove(s, target); // 43 > 42 → 超时
    expect(s.status).toBe('DEFEAT');
    const v = computeSettlement(s);
    expect(v.defeatReason).toBe('TIMEOUT');
    expect(v.gemRevenue).toBe(0);
    expect(v.finalAssets).toBe(v.cashRemaining);
  });

  it('耐力归零失败：销售收入为 0', () => {
    let s = newGame('settle-stamina');
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.weather[target][0] = 'HEAT';
    });
    s = performMove(s, target);
    expect(s.status).toBe('DEFEAT');
    const v = computeSettlement(s);
    expect(v.defeatReason).toBe('STAMINA_EXHAUSTED');
    expect(v.gemRevenue).toBe(0);
  });

  it('结算显示本局 Seed 与 maxDays', () => {
    let s = newGame('seed-visible');
    s = mutate(s, (m) => {
      m.status = 'DEFEAT';
      m.defeatReason = 'TIMEOUT';
      m.phase = 'FINISHED';
    });
    const v = computeSettlement(s);
    expect(v.seed).toBe('seed-visible');
    expect(v.maxDays).toBe(42);
  });
});

describe('天气预报包的现金成本模型（v0.1.3）', () => {
  it('购买不再压缩时间预算：连买 4 包 maxDays 仍是 42，只扣现金', () => {
    let s = newGame('fc-cost', calmOverrides(newGame('fc-cost').map));
    for (let i = 0; i < 4; i++) s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    // 旧机制下 maxDays 会变成 38；新机制恒为 42
    expect(s.maxDays).toBe(gameConfig.maxDays);
    expect(s.stats.forecastPacks).toBe(4);
    expect(s.cash).toBe(gameConfig.startCash - gameConfig.forecast.packPrice * 4);
    expect(s.forecastSpent).toBe(gameConfig.forecast.packPrice * 4);
    expect(s.daysUsed).toBe(0);
    expect(s.status).toBe('ONGOING');
  });

  it('正常前期购买不会被误禁：day 0 购买成功且只扣现金', () => {
    let s = newGame('fc-cost-ok', calmOverrides(newGame('fc-cost-ok').map));
    const cash0 = s.cash;
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(gameConfig.maxDays);
    expect(s.cash).toBe(cash0 - gameConfig.forecast.packPrice);
    expect(s.status).toBe('ONGOING');
  });
});

describe('Seed 可复现性', () => {
  function scriptedPlay(seed: string) {
    let s = newGame(seed, calmOverrides(newGame(seed).map));
    s = walkTo(s, mineTile(s, 'B'));
    s = act(s, { type: 'MINE' });
    s = performAction(s, { type: 'START_RETURN' });
    s = walkTo(s, s.map.cityId);
    return s;
  }

  it('同 Seed + 同操作序列 → 完全相同的最终状态', () => {
    const a = scriptedPlay('repro-seed');
    const b = scriptedPlay('repro-seed');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(computeSettlement(a)).toEqual(computeSettlement(b));
  });

  it('不同 Seed → 地图与价格不同（随机性来自 Seed）', () => {
    const a = createNewGame('repro-a');
    const b = createNewGame('repro-b');
    expect(JSON.stringify(a.map.tiles)).not.toBe(JSON.stringify(b.map.tiles));
    // 价格至少有一个矿区不同（30 对抽样中至少 15 对不同；新模型价格更集中）
    let differ = 0;
    for (let i = 0; i < 30; i++) {
      const x = createNewGame(`cmp-${i}`);
      const y = createNewGame(`cmp2-${i}`);
      if (x.map.mines[0].gemPrice !== y.map.mines[0].gemPrice) differ += 1;
    }
    expect(differ).toBeGreaterThanOrEqual(15);
  });
});

describe('盗贼追回时间边界', () => {
  it('追回导致超过 maxDays → 按规则失败', () => {
    let s = newGame('thief-timeout-v012');
    const target = getLegalMoves(s)[0];
    s = mutate(s, (m) => {
      m.map.encounters[target] = 'THIEF';
      m.daysUsed = 41;
      m.maxDays = 42;
    });
    s = performMove(s, target);
    const ev = s.pendingEvents[0];
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'CHASE' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });
});
