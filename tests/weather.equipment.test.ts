import { describe, it, expect } from 'vitest';
import { performMove, resolvePendingEvent, getCurrentWeather, getWeatherForDay } from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, calmOverrides, withWeather, mutate, expectPending, walk, declineForecast } from './helpers';
import { worldMap } from '../src/game/map/worldMap';

/**
 * 沙尘暴测试场景：第 2 天进入边缘沙漠 md1。
 */
function stormScenario(seed: string, tents: number[], compasses: number) {
  let s = newGame(seed, calmOverrides(worldMap));
  s = mutate(s, (m) => {
    m.tents = tents;
    m.compasses = compasses;
  });
  s = walk(s, ['mg1']); // 第 1 天
  s = withWeather(s, 'md1', 2, 'SANDSTORM');
  s = performMove(s, 'md1'); // 第 2 天抵达，遭遇沙尘暴
  return s;
}

describe('天气系统：预生成与确定性', () => {
  it('同一 Seed 生成的天气表完全一致，不同 Seed 不同', () => {
    const a = newGame('weather-a');
    const b = newGame('weather-a');
    const c = newGame('weather-b');
    expect(a.weather).toEqual(b.weather);
    expect(a.weather).not.toEqual(c.weather);
  });

  it('开局天气表覆盖全部节点与 46 天', () => {
    const s = newGame('weather-cover');
    for (const id of Object.keys(worldMap.nodes)) {
      expect(s.weather[id].length).toBe(46);
    }
  });

  it('查询接口与预生成表一致', () => {
    const s = newGame('weather-query');
    const day = 7;
    for (const id of Object.keys(worldMap.nodes)) {
      expect(getWeatherForDay(s, id, day)).toBe(s.weather[id][day - 1]);
    }
  });

  it('城市与矿区入口永远是晴天（宝库安全）', () => {
    const s = newGame('weather-safe');
    for (let d = 1; d <= 46; d++) {
      expect(getWeatherForDay(s, 'city', d)).toBe('SUNNY');
      for (const m of worldMap.mineIds) {
        expect(getWeatherForDay(s, m, d)).toBe('SUNNY');
      }
    }
  });

  it('沙漠分布只含晴/高温/沙尘暴；草地只含晴/暴雨/泥沼（天气与遭遇数据分离）', () => {
    const s = newGame('weather-dist');
    const desertKinds = new Set(s.weather['md1']);
    const grassKinds = new Set(s.weather['sg1']);
    for (const k of desertKinds) expect(['SUNNY', 'HEAT', 'SANDSTORM']).toContain(k);
    for (const k of grassKinds) expect(['SUNNY', 'RAINSTORM', 'MUD']).toContain(k);
    expect(desertKinds.size).toBeGreaterThan(1);
    expect(grassKinds.size).toBeGreaterThan(1);
  });
});

describe('沙尘暴：四象限（帐篷 × 指南针）', () => {
  it('有帐篷 + 使用指南针：不掉耐力、不迷路，帐篷 -1、指南针 -1', () => {
    let s = stormScenario('storm-1', [3], 1);
    const ev = expectPending(s);
    expect(ev.kind).toBe('SANDSTORM');
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: true });
    s = declineForecast(s);
    expect(s.tents).toEqual([2]);
    expect(s.compasses).toBe(0);
    expect(s.stamina).toBe(5);
    expect(s.daysUsed).toBe(2); // 无额外损失
    expect(s.position).toBe('md1');
  });

  it('有帐篷 + 不用指南针：不掉耐力，帐篷 -1，迷路额外损失 1 天', () => {
    let s = stormScenario('storm-2', [3], 0);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    s = declineForecast(s);
    expect(s.tents).toEqual([2]);
    expect(s.stamina).toBe(5);
    expect(s.daysUsed).toBe(3); // 迷路 +1 天
    expect(s.position).toBe('md1'); // 迷路不传送，仍停留在当前沙漠格
  });

  it('无帐篷 + 使用指南针：耐力 -1，不迷路，指南针 -1', () => {
    let s = stormScenario('storm-3', [], 1);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: true });
    s = declineForecast(s);
    expect(s.compasses).toBe(0);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(2);
  });

  it('无帐篷 + 不用指南针：耐力 -1 且迷路额外损失 1 天', () => {
    let s = stormScenario('storm-4', [], 0);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: false });
    s = declineForecast(s);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(3);
    expect(s.position).toBe('md1');
  });

  it('帐篷 3 次沙漠耐久：第 3 次抵挡后消失', () => {
    let s = stormScenario('storm-deplete', [1], 0);
    let ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    s = declineForecast(s);
    expect(s.tents).toEqual([]); // 1 → 0 → 整顶消失
    expect(s.stamina).toBe(5); // 帐篷抵挡过，不掉耐力

    // 再次进入沙尘暴：已无帐篷，走无帐象限
    s = mutate(s, (m) => {
      m.position = 'mg1';
      m.visitedOutbound = ['city', 'mg1'];
      m.phase = 'OUTBOUND';
      m.status = 'ONGOING';
      m.defeatReason = null;
      m.pendingEvents = [];
    });
    s = withWeather(s, 'md1', 4, 'SANDSTORM');
    s = performMove(s, 'md1');
    ev = expectPending(s);
    expect(ev.kind).toBe('SANDSTORM');
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: false });
    s = declineForecast(s);
    expect(s.stamina).toBe(4);
  });

  it('拥有装备时引擎必须询问玩家，绝不自动消耗', () => {
    const s = stormScenario('storm-ask', [3], 1);
    expect(s.pendingEvents.length).toBe(1);
    expect(s.tents).toEqual([3]); // 未被自动消耗
    expect(s.compasses).toBe(1);
  });

  it('没有对应装备时选择无效并抛错', () => {
    let s = stormScenario('storm-invalid', [], 0);
    const ev = expectPending(s);
    expect(() =>
      resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false }),
    ).toThrow(GameError);
    expect(() =>
      resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: false, useCompass: true }),
    ).toThrow(GameError);
  });
});

describe('草地暴雨：整顶帐篷的取舍', () => {
  function rainScenario(seed: string, tents: number[]) {
    let s = newGame(seed, calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.tents = tents;
    });
    s = walk(s, ['sg1']); // 第 1 天
    s = withWeather(s, 'mg1', 2, 'RAINSTORM');
    s = performMove(s, 'mg1'); // 第 2 天进入草地 mg1，遭遇暴雨
    return s;
  }

  it('使用帐篷：整顶立即消失（2/3 剩余也一样），不掉耐力', () => {
    let s = rainScenario('rain-1', [2, 3]);
    const ev = expectPending(s);
    expect(ev.kind).toBe('RAINSTORM');
    s = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: true });
    s = declineForecast(s);
    // 耐久最低的一顶（2/3）被整顶消耗，剩 [3]
    expect(s.tents).toEqual([3]);
    expect(s.stamina).toBe(5);
    expect(s.daysUsed).toBe(2);
  });

  it('不使用帐篷：耐力 -1，帐篷保留', () => {
    let s = rainScenario('rain-2', [3]);
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: false });
    s = declineForecast(s);
    expect(s.tents).toEqual([3]);
    expect(s.stamina).toBe(4);
  });

  it('没有帐篷：不弹出选择，直接耐力 -1', () => {
    let s = rainScenario('rain-3', []);
    expect(s.pendingEvents.filter((e) => e.kind === 'RAINSTORM')).toHaveLength(0);
    s = declineForecast(s);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(2);
  });

  it('暴雨耗尽最后耐力 → 立即失败', () => {
    let s = newGame('rain-death', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    s = walk(s, ['sg1']);
    s = withWeather(s, 'mg1', 2, 'RAINSTORM');
    s = performMove(s, 'mg1'); // 无帐篷硬扛暴雨，耐力归零
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
  });
});

describe('沙漠高温与草地泥沼', () => {
  it('高温：耐力 -1（v0.1 规则），无额外时间损失', () => {
    let s = newGame('heat-1', calmOverrides(worldMap));
    s = walk(s, ['mg1']);
    s = withWeather(s, 'md1', 2, 'HEAT');
    s = performMove(s, 'md1');
    s = declineForecast(s);
    expect(s.stamina).toBe(4);
    expect(s.daysUsed).toBe(2);
  });

  it('泥沼：移动已完成，额外损失 1 天，停留在当前格', () => {
    let s = newGame('mud-1', calmOverrides(worldMap));
    s = walk(s, ['sg1']);
    s = withWeather(s, 'mg1', 2, 'MUD');
    s = performMove(s, 'mg1');
    s = declineForecast(s);
    expect(s.daysUsed).toBe(3); // 移动 1 天 + 泥沼 1 天
    expect(s.position).toBe('mg1');
  });

  it('耐力归零立即失败', () => {
    let s = newGame('stamina-death', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.stamina = 1;
    });
    s = walk(s, ['mg1']);
    s = withWeather(s, 'md1', 2, 'HEAT');
    s = performMove(s, 'md1');
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
  });

  it('当前天气查询与位置一致', () => {
    let s = newGame('cur-weather', calmOverrides(worldMap));
    s = withWeather(s, 'sg1', 1, 'CLOUDY');
    s = walk(s, ['sg1']);
    expect(getCurrentWeather(s)).toBe('CLOUDY');
  });
});
