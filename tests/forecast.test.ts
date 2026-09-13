import { describe, it, expect } from 'vitest';
import { performMove, performAction, resolvePendingEvent, getWeatherForDay } from '../src/game';
import { newGame, calmOverrides, withWeather, mutate, expectPending, walk } from './helpers';
import { worldMap } from '../src/game/map/worldMap';

function offer(state: ReturnType<typeof newGame>) {
  const ev = state.pendingEvents.find((e) => e.kind === 'FORECAST_OFFER');
  if (!ev) throw new Error('期望出现天气预报询问');
  return ev;
}

describe('天气预报：20:00 主动询问', () => {
  it('每个正常行动日结束后弹出询问', () => {
    let s = newGame('fc-1', calmOverrides(worldMap));
    s = performMove(s, 'sg1');
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['FORECAST_OFFER']);
  });

  it('选择查看：额外消耗 1 天，显示之后 3 天天气，且该天不再触发新询问', () => {
    let s = newGame('fc-2', calmOverrides(worldMap));
    s = performMove(s, 'sg1'); // 第 1 天（保留询问在队首）
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: true });
    expect(s.daysUsed).toBe(2); // 预报占用了第 2 天
    expect(s.stats.forecastCount).toBe(1);
    expect(s.lastForecast).not.toBeNull();
    expect(s.lastForecast!.dayNumbers).toEqual([3, 4, 5]);
    // 预报日不递归弹窗
    expect(s.pendingEvents).toHaveLength(0);
  });

  it('选择不查看：不耗时间，正常进入下一天；下一天行动后可再次询问', () => {
    let s = newGame('fc-3', calmOverrides(worldMap));
    s = performMove(s, 'sg1');
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: false });
    expect(s.daysUsed).toBe(1);
    expect(s.lastForecast).toBeNull();
    expect(s.pendingEvents).toHaveLength(0);
    s = performMove(s, 'mg1');
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['FORECAST_OFFER']);
  });

  it('预报内容只包含已知地形：未知格显示 UNKNOWN', () => {
    let s = newGame('fc-4', calmOverrides(worldMap));
    s = performMove(s, 'sg1'); // 只亲自探索了 sg1（保留询问）
    // 给已知/未知格设置确定天气以便断言
    s = withWeather(s, 'sg1', 3, 'SANDSTORM');
    s = withWeather(s, 'md1', 4, 'HEAT'); // md1 尚未知 → 应显示 UNKNOWN
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: true });
    const view = s.lastForecast!;
    const rowOf = (id: string) => view.rows.find((r) => r.nodeId === id)!;
    expect(rowOf('sg1').terrainKnown).toBe(true);
    expect(rowOf('sg1').values[0]).toBe('SANDSTORM'); // 第 3 天
    expect(rowOf('md1').terrainKnown).toBe(false);
    expect(rowOf('md1').values).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    // 城市与矿区开局已知
    expect(rowOf('city').terrainKnown).toBe(true);
    expect(rowOf('mineS').terrainKnown).toBe(true);
  });

  it('情报揭示的地形也会进入预报（两种信息资源相互独立但都有效）', () => {
    let s = newGame('fc-5', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.intelKnown = ['md1'];
    });
    s = performMove(s, 'mg1');
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: true });
    const row = s.lastForecast!.rows.find((r) => r.nodeId === 'md1')!;
    expect(row.terrainKnown).toBe(true);
    expect(row.values[0]).toBe(getWeatherForDay(s, 'md1', s.daysUsed + 1));
  });

  it('惩罚日（泥沼/迷路）不触发 20:00 询问', () => {
    let s = newGame('fc-6', calmOverrides(worldMap));
    s = walk(s, ['sg1']);
    s = withWeather(s, 'mg1', 2, 'MUD');
    s = performMove(s, 'mg1');
    expect(s.daysUsed).toBe(3); // 泥沼 +1
    expect(s.pendingEvents).toHaveLength(0); // 无询问
  });

  it('迷路日不触发询问', () => {
    let s = newGame('fc-7', calmOverrides(worldMap));
    s = mutate(s, (m) => {
      m.tents = [3];
    });
    s = walk(s, ['mg1']);
    s = withWeather(s, 'md1', 2, 'SANDSTORM');
    s = performMove(s, 'md1');
    const ev = expectPending(s);
    s = resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    expect(s.daysUsed).toBe(3); // 迷路 +1
    expect(s.pendingEvents).toHaveLength(0);
  });

  it('挖矿/休整/打工等正常行动日后同样弹出询问', () => {
    let s = newGame('fc-8', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2']);
    s = performMove(s, 'mineS'); // 最后一跳保留询问
    // 进矿日（移动）后有询问
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['FORECAST_OFFER']);
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: false });
    s = performAction(s, { type: 'MINE' });
    // 挖矿日后有询问
    expect(s.pendingEvents.map((e) => e.kind)).toEqual(['FORECAST_OFFER']);
  });

  it('第 42 天不再询问（预报会把天数推到 43，必然失败）', () => {
    // 42 天时挖矿 → 43 天失败，且失败前不出现天气预报询问
    let s = newGame('fc-9', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    s = mutate(s, (m) => {
      m.daysUsed = 41;
      m.pendingEvents = [];
    });
    s = performAction(s, { type: 'MINE' });
    expect(s.daysUsed).toBe(42);
    expect(s.pendingEvents).toHaveLength(0); // 第 42 天不再询问
    s = performAction(s, { type: 'MINE' });
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TIMEOUT');
    expect(s.pendingEvents).toHaveLength(0);
  });

  it('预报天数对应真实天气表（预生成，非查看时生成）', () => {
    let s = newGame('fc-10', calmOverrides(worldMap));
    s = performMove(s, 'sg1');
    const before = s.weather['sg1'];
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: true });
    const view = s.lastForecast!;
    const row = view.rows.find((r) => r.nodeId === 'sg1')!;
    expect(row.terrainKnown).toBe(true);
    expect(row.values[0]).toBe(before[view.dayNumbers[0] - 1]);
    expect(row.values[1]).toBe(before[view.dayNumbers[1] - 1]);
    expect(row.values[2]).toBe(before[view.dayNumbers[2] - 1]);
  });

  it('移动后旧预报失效', () => {
    let s = newGame('fc-11', calmOverrides(worldMap));
    s = performMove(s, 'sg1');
    s = resolvePendingEvent(s, offer(s).id, { kind: 'FORECAST_OFFER', accept: true });
    expect(s.lastForecast).not.toBeNull();
    s = walk(s, ['mg1']);
    expect(s.lastForecast).toBeNull();
  });
});
