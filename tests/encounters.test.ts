import { describe, it, expect } from 'vitest';
import {
  performMove,
  performAction,
  resolvePendingEvent,
  getAvailableActions,
} from '../src/game';
import { GameError } from '../src/game/types';
import {
  newGame,
  calmOverrides,
  withEncounterRoll,
  withWeather,
  mutate,
  expectPending,
  walk,
  declineForecast,
} from './helpers';
import { worldMap } from '../src/game/map/worldMap';
import { gameConfig } from '../src/game/config/gameConfig';

/** 沙漠商队场景：第 1 天走 mg1（草），第 2 天进 md1（沙漠）触发商队 */
function caravanScenario(seed: string, cash = 2000) {
  let s = newGame(seed, calmOverrides(worldMap));
  s = mutate(s, (m) => {
    m.cash = cash;
  });
  s = walk(s, ['mg1']);
  s = withEncounterRoll(s, 'md1', 2, 0.01); // 必触发商队
  s = performMove(s, 'md1');
  return s;
}

/** 村庄遭遇场景：第 2 天进入村庄 sv */
function villageScenario(seed: string, roll: number, cash = 2000) {
  let s = newGame(seed, calmOverrides(worldMap));
  s = mutate(s, (m) => {
    m.cash = cash;
  });
  s = walk(s, ['sg1']);
  s = withEncounterRoll(s, 'sv', 2, roll);
  s = performMove(s, 'sv');
  return s;
}

describe('沙漠商队', () => {
  it('进入沙漠触发商队，与天气独立（可同日叠加，先天气后遭遇）', () => {
    let s = newGame('caravan-1', calmOverrides(worldMap));
    s = walk(s, ['mg1']);
    s = withEncounterRoll(s, 'md1', 2, 0.01);
    s = withWeather(s, 'md1', 2, 'SANDSTORM');
    s = performMove(s, 'md1');
    // 队首是沙尘暴，其后是商队
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['SANDSTORM', 'CARAVAN']);
    // 先解决沙尘暴（无帐篷无指南针，选择硬扛：耐力 -1、迷路 +1 天）
    const storm = s.pendingEvents[0];
    s = resolvePendingEvent(s, storm.id, { kind: 'SANDSTORM', useTent: false, useCompass: false });
    // 商队询问仍在
    expect(s.pendingEvents[0].kind).toBe('CARAVAN');
  });

  it('选项 A：花 300 元买二手帐篷（3 次沙漠耐久），不耗时间', () => {
    let s = caravanScenario('caravan-buy');
    const ev = expectPending(s);
    expect(ev.kind).toBe('CARAVAN');
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'BUY_TENT' });
    s = declineForecast(s);
    expect(s.cash).toBe(2000 - gameConfig.caravanTentPrice);
    expect(s.tents).toEqual([gameConfig.caravanTentCharges]);
    expect(s.equipmentSpent).toBe(gameConfig.caravanTentPrice);
    expect(s.daysUsed).toBe(2); // 不消耗时间
  });

  it('现金不足 300 时购买被拒绝（引擎抛错，UI 禁用）', () => {
    let s = caravanScenario('caravan-broke', 200);
    const ev = expectPending(s);
    expect(() => resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'BUY_TENT' })).toThrow(GameError);
    // 情报选项仍可用
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    s = declineForecast(s);
    expect(s.cash).toBe(200);
  });

  it('选项 B：免费揭示路网距离 ≤3 的未知普通格，不耗时间', () => {
    let s = caravanScenario('caravan-intel');
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    s = declineForecast(s);
    expect(s.daysUsed).toBe(2);
    // md1 附近 3 步内：mg1、mv、wd1（2 步）、sg1、city、mo、sv、wo、w1、nd1…（城市/矿区不揭示）
    expect(s.intelKnown).toContain('sg1'); // 距离 2
    expect(s.intelKnown).toContain('so'); // md1→mv→sv→so 距离 3
    expect(s.intelKnown).not.toContain('city'); // 城市不属于普通格
    expect(s.intelKnown).not.toContain('mg1'); // 已亲自探索过
    for (const id of s.intelKnown) {
      const t = worldMap.nodes[id].terrain;
      expect(['DESERT', 'GRASS', 'VILLAGE', 'OASIS']).toContain(t);
    }
  });
});

describe('村庄盗贼', () => {
  it('触发盗贼：stolen = min(300, 现金)', () => {
    let s = villageScenario('thief-1', 0.01);
    const ev = expectPending(s);
    expect(ev.kind).toBe('THIEF');
    if (ev.kind === 'THIEF') expect(ev.stolen).toBe(300);
  });

  it('现金低于 300 时只偷走全部现金，现金永不为负', () => {
    let s = villageScenario('thief-poor', 0.01, 150);
    const ev = expectPending(s);
    if (ev.kind !== 'THIEF') throw new Error('应为盗贼事件');
    expect(ev.stolen).toBe(150);
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'GIVE_UP' });
    s = declineForecast(s);
    expect(s.cash).toBe(0);
  });

  it('放弃：损失被盗金额', () => {
    let s = villageScenario('thief-giveup', 0.01);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'GIVE_UP' });
    s = declineForecast(s);
    expect(s.cash).toBe(1700);
    expect(s.daysUsed).toBe(2);
  });

  it('追回：消耗 1 天，全额找回', () => {
    let s = villageScenario('thief-chase', 0.01);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'CHASE' });
    s = declineForecast(s);
    expect(s.cash).toBe(2000);
    expect(s.daysUsed).toBe(3); // 追回 +1 天
    // 追回是正常行动日：之后仍有天气预报询问
    s = declineForecast(s);
    void s;
  });

  it('追回导致超过 42 天 → 按规则失败', () => {
    let s = villageScenario('thief-timeout', 0.01);
    s = mutate(s, (m) => {
      m.daysUsed = 42; // 已经是最后一天
      // 修正各节点天数快照不影响本测试
    });
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'THIEF', action: 'CHASE' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
  });

  it('村庄在同一时间只触发一种遭遇（盗贼/市集互斥）', () => {
    // roll=0.01 → 盗贼；roll=0.4 → 市集（0.3 ≤ 0.4 < 0.55）；roll=0.9 → 无
    const thief = villageScenario('v-excl-1', 0.01);
    expect(thief.pendingEvents.map((e) => e.kind)).toEqual(['THIEF']);
    const market = villageScenario('v-excl-2', 0.4);
    expect(market.pendingEvents.map((e) => e.kind)).toEqual(['MARKET']);
    const none = villageScenario('v-excl-3', 0.9);
    expect(none.pendingEvents.filter((e) => e.kind !== 'FORECAST_OFFER')).toHaveLength(0);
  });
});

describe('村庄繁荣市集', () => {
  it('选项 A 八折购物：本次访问帐篷 320 / 指南针 80', () => {
    let s = villageScenario('market-1', 0.4);
    const ev = expectPending(s);
    expect(ev.kind).toBe('MARKET');
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'TAKE_DISCOUNT' });
    s = declineForecast(s);
    expect(s.visitDiscount).toBe(true);
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    expect(s.cash).toBe(2000 - 320 - 80);
    expect(s.equipmentSpent).toBe(400);
    expect(s.daysUsed).toBe(2);
  });

  it('选项 B 打工：1 天 +500 元', () => {
    let s = villageScenario('market-2', 0.4);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'WORK' });
    s = declineForecast(s);
    expect(s.cash).toBe(2500);
    expect(s.daysUsed).toBe(3);
    expect(s.visitDiscount).toBe(false);
  });

  it('二选一不可兼得：打折后无打工，打工后无打折', () => {
    let s = villageScenario('market-3', 0.4);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'MARKET', action: 'TAKE_DISCOUNT' });
    s = declineForecast(s);
    // 打工只存在于市集事件中，事件已解决，无法再打工
    expect(s.pendingEvents.filter((e) => e.kind === 'MARKET')).toHaveLength(0);
    // 打折只持续本次访问：离开后失效
    s = walk(s, ['so']);
    expect(s.visitDiscount).toBe(false);
  });

  it('非市集/非村庄场景按原价购买', () => {
    let s = newGame('normal-price', calmOverrides(worldMap));
    s = performAction(s, { type: 'BUY', item: 'tent' });
    expect(s.cash).toBe(2000 - 400);
  });
});

describe('草地牧民指引', () => {
  it('免费揭示周边 ≤3 的未知普通格，不耗时间、不是天气', () => {
    let s = newGame('herdsman-1', calmOverrides(worldMap));
    s = walk(s, ['sg1']); // 第 1 天草地（无遭遇）
    s = withEncounterRoll(s, 'mg1', 2, 0.01); // 第 2 天草地牧民
    s = performMove(s, 'mg1');
    s = declineForecast(s);
    expect(s.daysUsed).toBe(2); // 不额外耗时间
    // mg1 周边 3 步：md1、w0（1 步）、w1、wd1（2 步）、n0、wo、nd1、mv（3 步）
    expect(s.intelKnown).toContain('md1');
    expect(s.intelKnown).toContain('wd1');
    expect(s.intelKnown).toContain('w0');
    expect(s.intelKnown).not.toContain('city');
    expect(s.explored).not.toContain('md1'); // 是情报，不是亲自探索
  });

  it('情报揭示与天气互不干扰（同一天可同时发生）', () => {
    let s = newGame('herdsman-2', calmOverrides(worldMap));
    s = walk(s, ['sg1']);
    s = withEncounterRoll(s, 'mg1', 2, 0.01);
    s = withWeather(s, 'mg1', 2, 'RAINSTORM');
    s = performMove(s, 'mg1');
    // 暴雨（无帐篷直接扣耐力）与牧民揭示同时发生
    expect(s.stamina).toBe(4);
    expect(s.intelKnown).toContain('md1');
  });
});

describe('绿洲', () => {
  function oasisScenario(seed: string, drought = false) {
    let s = newGame(seed, calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.oasisDrought = { so: drought, mo: false, wo: false };
    });
    s = walk(s, ['sg1', 'sv']);
    return s;
  }

  it('进入绿洲耗 1 天，不免费恢复；休整耗 1 天 +1 耐力，每局每绿洲一次', () => {
    let s = oasisScenario('oasis-1');
    expect(s.stamina).toBe(5); // 初始满耐力
    s = mutate(s, (m) => {
      m.stamina = 3;
    });
    s = walk(s, ['so']); // 第 3 天进入绿洲
    expect(s.stamina).toBe(3); // 不免费恢复
    const restAction = getAvailableActions(s).find((a) => a.action.type === 'REST');
    expect(restAction).toBeDefined();
    s = performAction(s, { type: 'REST' });
    s = declineForecast(s);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(4);
    expect(s.oasisRestUsed['so']).toBe(true);
    // 每局每绿洲一次：再次休整被拒绝
    expect(() => performAction(s, { type: 'REST' })).toThrow(GameError);
  });

  it('耐力已满时不能休整', () => {
    let s = oasisScenario('oasis-2');
    s = walk(s, ['so']);
    const restAction = getAvailableActions(s).find((a) => a.action.type === 'REST');
    expect(restAction?.disabled).toBe(true);
    expect(() => performAction(s, { type: 'REST' })).toThrow(GameError);
  });

  it('干涸绿洲不可休整（干涸由 Seed 决定，抵达时揭晓）', () => {
    let s = oasisScenario('oasis-3', true);
    s = walk(s, ['so']);
    const restAction = getAvailableActions(s).find((a) => a.action.type === 'REST');
    expect(restAction?.disabled).toBe(true);
    expect(restAction?.disabledReason).toContain('干涸');
    expect(() => performAction(s, { type: 'REST' })).toThrow(GameError);
  });

  it('休整恢复不超过上限 5', () => {
    let s = oasisScenario('oasis-4');
    s = mutate(s, (m) => {
      m.stamina = 5;
    });
    s = walk(s, ['so']);
    expect(() => performAction(s, { type: 'REST' })).toThrow(GameError);
  });

  it('干涸概率来自配置且开局确定（与抵达时机无关）', () => {
    const a = newGame('drought-seed');
    const b = newGame('drought-seed');
    expect(a.oasisDrought).toEqual(b.oasisDrought);
    expect(Object.keys(a.oasisDrought).sort()).toEqual(['mo', 'so', 'wo']);
  });
});
