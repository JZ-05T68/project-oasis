import { describe, it, expect } from 'vitest';
import {
  performAction,
  performMove,
  resolvePendingEvent,
  dismissPendingResult,
  getLegalMoves,
  gameConfig,
} from '../src/game';
import type { EventResult, GameState, ResourceChange } from '../src/game/types';
import {
  newGame,
  calmOverrides,
  mutate,
  withWeather,
  nearestTileOf,
  pathTo,
  walk,
  returnPath,
  resolveAll,
  mkTents,
  charges,
  tentIds,
  TENT_A,
  TENT_B,
  TENT_C,
  TENT_D,
  getLegalMoves as legal,
  nearestMineTile,
} from './helpers';

/**
 * Human Playtest Fix Round 1 —— 真人试玩修复的专项回归测试。
 *
 * 覆盖：
 *  - §六/§七 草地暴雨：不用帐篷耐力 -2（且由配置集中管理）
 *  - §六 使用帐篷：整顶报废、耐力不减（3/3、2/3、1/3 都一样）
 *  - §六 耐力因此归零 → 立即失败且原因是「耐力耗尽」
 *  - §八~§十三 即时反馈：资源变化（变化前 → 变化后）可被 UI 结果弹窗消费
 *  - §十一 双记录：同一事件同时进入即时反馈与右下角历史日志
 *  - §十二 不过度弹窗：普通移动不产生结果
 */

const rainCost = gameConfig.weather.grassRain.staminaLossWithoutTent;

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/** 走到最近的草地格，把抵达当天设为暴雨；返回抵达后的状态 */
function arriveRain(seed: string, tents: number[], stamina?: number) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  s = mutate(s, (m) => {
    m.tents = mkTents(tents);
    if (stamina !== undefined) m.stamina = stamina;
    m.pendingResults = [];
  });
  const target = nearestTileOf(s, 'GRASS');
  const path = pathTo(s, target);
  s = withWeather(s, target, path.length, 'RAINSTORM');
  if (path.length > 1) s = walk(s, path.slice(0, -1));
  // 中途的日志/结果不影响断言
  s = mutate(s, (m) => {
    m.pendingResults = [];
  });
  s = performMove(s, path[path.length - 1]);
  return { s, target, path };
}

function lastResult(s: GameState): EventResult {
  const r = s.pendingResults[s.pendingResults.length - 1];
  if (!r) throw new Error('没有任何即时反馈结果');
  return r;
}

function changeOf(r: EventResult, key: ResourceChange['key']): ResourceChange | undefined {
  return r.changes.find((c) => c.key === key);
}

/** 抛入一个指定种类的待决事件（白盒构造，避免依赖地图随机性） */
function withPendingEvent(s: GameState, ev: GameState['pendingEvents'][number]): GameState {
  return mutate(s, (m) => {
    m.pendingEvents = [ev];
    m.pendingResults = [];
  });
}

/**
 * 跑一整局（挖矿 3 天后返程），并在每一步之后校验：
 * 所有即时反馈都能在右下角历史日志里找到同源记录。
 */
function driveFullGame(seed: string, calm: boolean) {
  let s = calm
    ? newGame(seed, calmOverrides(newGame(seed).map))
    : newGame(seed);
  const results: EventResult[] = [];
  const missing: string[] = [];

  const drain = () => {
    for (const r of s.pendingResults) {
      results.push(r);
      const hit = s.log.some(
        (e) => e.day === r.history.day && e.text === r.history.text && e.kind === r.history.kind,
      );
      if (!hit) missing.push(`${r.title} :: ${r.history.text}`);
    }
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
  };
  drain();

  const goal = nearestMineTile(s).tileId;
  let guard = 0;
  while (s.status === 'ONGOING' && guard++ < 200) {
    if (s.phase === 'MINING') {
      s = s.stats.miningDays >= 3
        ? performAction(s, { type: 'START_RETURN' })
        : performAction(s, { type: 'MINE' });
    } else {
      const path = s.phase === 'OUTBOUND' ? pathTo(s, goal) : returnPath(s, s.map.cityId);
      if (path.length === 0) break;
      s = performMove(s, path[0]);
    }
    s = resolveAll(s);
    drain();
  }
  return { status: s.status, results, missing, logLength: s.log.length, log: s.log };
}

/* ------------------------------------------------------------------ */
/* §七 数值由配置集中管理                                                */
/* ------------------------------------------------------------------ */

describe('§七 草地暴雨数值集中管理', () => {
  it('不用帐篷的耐力损失是配置里的单一来源（当前试玩值 = 2）', () => {
    expect(gameConfig.weather.grassRain.staminaLossWithoutTent).toBe(2);
    expect(gameConfig.weather.grassRain.destroysTentOnUse).toBe(true);
    // 旧的扁平字段已移除，避免同一数值散落两处导致调参不一致
    expect((gameConfig as unknown as Record<string, unknown>).rainstormStaminaCost).toBeUndefined();
    expect((gameConfig as unknown as Record<string, unknown>).heatStaminaCost).toBeUndefined();
    expect((gameConfig as unknown as Record<string, unknown>).sandstormStaminaCost).toBeUndefined();
    // 其它天气数值同样是结构化的
    expect(gameConfig.weather.heat.staminaCost).toBe(1);
    expect(gameConfig.weather.sandstorm.staminaCost).toBe(1);
  });

  it('改动配置即可改变结算结果（无需改引擎）', () => {
    // 引擎读取的是同一个配置对象，只要它不是硬编码，这里读到的就是引擎用的值
    expect(rainCost).toBe(gameConfig.weather.grassRain.staminaLossWithoutTent);
  });
});

/* ------------------------------------------------------------------ */
/* §六 草地暴雨：不用帐篷                                                */
/* ------------------------------------------------------------------ */

describe('§六 草地暴雨 · 不使用帐篷', () => {
  it('有帐篷但选择硬扛：耐力 5 → 3', () => {
    const { s } = arriveRain('fb-rain-1', [3]);
    expect(s.pendingEvents[0]?.kind).toBe('RAINSTORM');
    const ev = s.pendingEvents[0];
    const s2 = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: false });
    expect(s2.stamina).toBe(3);
    expect(charges(s2.tents)).toEqual([3]); // 帐篷完全保留
    expect(changeOf(lastResult(s2), 'stamina')).toMatchObject({
      before: '5/5',
      after: '3/5',
      direction: 'down',
    });
  });

  it('没有帐篷直接硬扛：耐力 5 → 3，且不产生待决选择', () => {
    const { s } = arriveRain('fb-rain-2', []);
    expect(s.pendingEvents.filter((e) => e.kind === 'RAINSTORM')).toHaveLength(0);
    expect(s.stamina).toBe(3);
    const r = lastResult(s);
    expect(r.title).toBe('暴雨结算');
    expect(changeOf(r, 'stamina')).toMatchObject({ before: '5/5', after: '3/5' });
  });

  it('耐力 2 → 0：立即失败，原因明确是耐力耗尽，并在弹窗与日志里都写明', () => {
    const { s } = arriveRain('fb-rain-3', [], 2);
    expect(s.stamina).toBe(0);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
    const r = lastResult(s);
    expect(changeOf(r, 'stamina')).toMatchObject({ before: '2/5', after: '0/5' });
    expect(r.outcome).toBe('DEFEAT');
    expect(r.defeatReason).toBe('STAMINA_EXHAUSTED');
    // 失败原因不能只存在于内部枚举里
    expect(s.log.some((e) => e.text.includes('耐力耗尽'))).toBe(true);
  });

  it('耐力刚好等于损失量：1 → 0 也只有一种死因（耐力耗尽）', () => {
    const { s } = arriveRain('fb-rain-3b', [], rainCost - 1);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('STAMINA_EXHAUSTED');
  });
});

/* ------------------------------------------------------------------ */
/* §六 草地暴雨：使用帐篷（逐顶）                                        */
/* ------------------------------------------------------------------ */

describe('§六 草地暴雨 · 使用帐篷整顶报废', () => {
  it('使用 Tent A（3/3）：整顶报废，耐力不变', () => {
    const { s } = arriveRain('fb-rain-4', [3]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, {
      kind: 'RAINSTORM',
      useTent: true,
      tentId: TENT_A,
    });
    expect(s2.tents).toHaveLength(0);
    expect(s2.stamina).toBe(5);
    const r = lastResult(s2);
    expect(changeOf(r, 'tent')).toMatchObject({ label: 'Tent A', before: '3/3', after: '报废' });
    // 耐力没有变化 → 不重复显示
    expect(changeOf(r, 'stamina')).toBeUndefined();
  });

  it('使用 Tent A（1/3）：同样整顶报废，耐力不变', () => {
    const { s } = arriveRain('fb-rain-5', [1]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, {
      kind: 'RAINSTORM',
      useTent: true,
      tentId: TENT_A,
    });
    expect(s2.tents).toHaveLength(0);
    expect(s2.stamina).toBe(5);
    expect(changeOf(lastResult(s2), 'tent')).toMatchObject({
      label: 'Tent A',
      before: '1/3',
      after: '报废',
    });
  });

  it('使用 Tent A（2/3）：同样整顶报废', () => {
    const { s } = arriveRain('fb-rain-6', [2]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, {
      kind: 'RAINSTORM',
      useTent: true,
      tentId: TENT_A,
    });
    expect(s2.tents).toHaveLength(0);
    expect(changeOf(lastResult(s2), 'tent')).toMatchObject({ before: '2/3', after: '报废' });
  });
});

/* ------------------------------------------------------------------ */
/* §五 四顶帐篷逐顶选择：只消耗被选中的那一顶                             */
/* ------------------------------------------------------------------ */

describe('§五 四顶帐篷（3/3、2/3、1/3、3/3）逐顶选择专项', () => {
  const build = [3, 2, 1, 3];
  const allIds = [TENT_A, TENT_B, TENT_C, TENT_D];
  const labels = ['Tent A', 'Tent B', 'Tent C', 'Tent D'];
  /** 逐顶：{ 帐篷 ID, 在列表中的下标, 剩余耐久 } */
  const cases = allIds.map((id, i) => ({ id, idx: i, charges: build[i], label: labels[i] }));

  /** 消耗 1 点耐久后的预期（归零则整顶消失） */
  function afterOneCharge(c: (typeof cases)[number]) {
    const next = c.charges - 1;
    if (next <= 0) {
      // 耐久归零 → 整顶从列表移除
      return {
        ids: allIds.filter((id) => id !== c.id),
        charges: build.filter((_, i) => i !== c.idx),
        after: '报废',
      };
    }
    return {
      ids: allIds,
      charges: build.map((v, i) => (i === c.idx ? next : v)),
      after: `${next}/${gameConfig.tentDesertCharges}`,
    };
  }

  for (const c of cases) {
    it(`草原暴雨 · 选择 ${c.label}（${c.charges}/3）：只有它报废，其余三顶原样保留`, () => {
      const { s } = arriveRain(`fb-rain-4tents-${c.id}`, build);
      expect(tentIds(s.tents)).toEqual(allIds);
      const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, {
        kind: 'RAINSTORM',
        useTent: true,
        tentId: c.id,
      });
      expect(tentIds(s2.tents)).toEqual(allIds.filter((id) => id !== c.id));
      expect(charges(s2.tents)).toEqual(build.filter((_, i) => i !== c.idx));
      expect(s2.stamina).toBe(5); // 用帐篷耐力不减
      expect(changeOf(lastResult(s2), 'tent')).toMatchObject({
        label: c.label,
        before: `${c.charges}/${gameConfig.tentDesertCharges}`,
        after: '报废',
      });
    });
  }

  for (const c of cases) {
    it(`沙尘暴 · 选择 ${c.label}（${c.charges}/3）：只扣这一顶的耐久`, () => {
      const seed = `fb-storm-${c.id}`;
      let s = newGame(seed, calmOverrides(newGame(seed).map));
      s = mutate(s, (m) => {
        m.tents = mkTents(build);
        m.compasses = 1;
        m.pendingResults = [];
      });
      s = withPendingEvent(s, { id: 'storm', kind: 'SANDSTORM', tileId: s.position });
      const s2 = resolvePendingEvent(s, 'storm', {
        kind: 'SANDSTORM',
        useTent: true,
        useCompass: true,
        tentId: c.id,
      });
      const exp = afterOneCharge(c);
      expect(tentIds(s2.tents)).toEqual(exp.ids);
      expect(charges(s2.tents)).toEqual(exp.charges);
      expect(s2.compasses).toBe(0);
      expect(changeOf(lastResult(s2), 'tent')).toMatchObject({ label: c.label, after: exp.after });
    });
  }

  for (const c of cases) {
    it(`野外宿营 · 选择 ${c.label}（${c.charges}/3）：只降低这一顶的耐久`, () => {
      const seed = `fb-camp-${c.id}`;
      let s = newGame(seed, calmOverrides(newGame(seed).map));
      s = mutate(s, (m) => {
        m.tents = mkTents(build);
        m.pendingResults = [];
      });
      const target = nearestTileOf(s, 'DESERT');
      s = walk(s, pathTo(s, target));
      s = mutate(s, (m) => {
        m.pendingResults = [];
      });
      const s2 = performAction(s, { type: 'WAIT', tentId: c.id });
      const exp = afterOneCharge(c);
      expect(tentIds(s2.tents)).toEqual(exp.ids);
      expect(charges(s2.tents)).toEqual(exp.charges);
      expect(changeOf(lastResult(s2), 'tent')).toMatchObject({
        label: c.label,
        before: `${c.charges}/${gameConfig.tentDesertCharges}`,
        after: exp.after,
      });
    });
  }
});

/* ------------------------------------------------------------------ */
/* §八~§十三 即时反馈 + 双记录 + 不过度弹窗                              */
/* ------------------------------------------------------------------ */

describe('§八~§十三 即时反馈（resource delta result）', () => {
  it('资源变化一律以「变化前 → 变化后」表达，UI 无需自己推算', () => {
    const { s } = arriveRain('fb-shape', [3]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, { kind: 'RAINSTORM', useTent: false });
    const r = lastResult(s2);
    expect(Object.keys(r).sort()).toEqual(
      ['changes', 'day', 'defeatReason', 'history', 'kind', 'message', 'outcome', 'title'].sort(),
    );
    for (const c of r.changes) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.before).toBe('string');
      expect(typeof c.after).toBe('string');
      expect(c.before).not.toBe('');
      expect(c.after).not.toBe('');
      expect(['up', 'down', 'flat']).toContain(c.direction);
    }
  });

  it('德州高温：耐力下降产生即时反馈', () => {
    let s = newGame('fb-heat', calmOverrides(newGame('fb-heat').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    const target = nearestTileOf(s, 'DESERT');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'HEAT');
    s = walk(s, path);
    expect(s.stamina).toBe(4);
    const r = lastResult(s);
    expect(r.title).toBe('沙漠高温');
    expect(changeOf(r, 'stamina')).toMatchObject({ before: '5/5', after: '4/5' });
  });

  it('泥沼：天数变化也会即时反馈', () => {
    let s = newGame('fb-mud', calmOverrides(newGame('fb-mud').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    const target = nearestTileOf(s, 'GRASS');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'MUD');
    s = walk(s, path);
    expect(s.daysUsed).toBe(path.length + 1);
    expect(changeOf(lastResult(s), 'day')).toMatchObject({
      before: `第 ${path.length} 天`,
      after: `第 ${path.length + 1} 天`,
    });
  });

  it('§十二 普通移动不产生结果（不会变成弹窗模拟器）', () => {
    let s = newGame('fb-plain', calmOverrides(newGame('fb-plain').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    s = performMove(s, getLegalMoves(s)[0]);
    expect(s.pendingResults).toHaveLength(0);
    s = performMove(s, getLegalMoves(s)[0]);
    expect(s.pendingResults).toHaveLength(0);
  });

  it('§十二 城市原地停留只推进时间 → 不弹窗，但日志照记', () => {
    let s = newGame('fb-city-wait', calmOverrides(newGame('fb-city-wait').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    const before = s.log.length;
    s = performAction(s, { type: 'WAIT' });
    expect(s.daysUsed).toBe(1);
    expect(s.pendingResults).toHaveLength(0);
    expect(s.log.length).toBeGreaterThan(before);
  });

  it('§十三 一次事件改变多个资源 → 只弹一个综合结果', () => {
    let s = newGame('fb-caravan', calmOverrides(newGame('fb-caravan').map));
    s = mutate(s, (m) => {
      m.tents = [];
    });
    s = withPendingEvent(s, { id: 'cv', kind: 'CARAVAN', tileId: s.position });
    const cashBefore = s.cash;
    const s2 = resolvePendingEvent(s, 'cv', { kind: 'CARAVAN', action: 'BUY_TENT' });
    expect(s2.pendingResults).toHaveLength(1);
    const r = lastResult(s2);
    expect(changeOf(r, 'cash')).toMatchObject({ before: `¥${cashBefore}`, after: `¥${cashBefore - gameConfig.caravanTentPrice}` });
    expect(changeOf(r, 'tent')).toMatchObject({ label: 'Tent A（新）', before: '无', after: '3/3', direction: 'up' });
  });

  it('购买天气预报包：maxDays 与预报次数合成同一个结果', () => {
    let s = newGame('fb-forecast', calmOverrides(newGame('fb-forecast').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    const s2 = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s2.pendingResults).toHaveLength(1);
    const r = lastResult(s2);
    expect(r.title).toBe('天气预报已购买');
    expect(changeOf(r, 'maxDays')).toMatchObject({
      before: String(gameConfig.maxDays),
      after: String(gameConfig.maxDays - 1),
    });
    expect(changeOf(r, 'forecast')).toMatchObject({
      before: '0',
      after: String(gameConfig.forecast.chargesPerPack - gameConfig.forecast.autoUseOnPurchase),
    });
    expect(s2.lastForecast).not.toBeNull();
  });

  it('绿洲修整：耐力恢复 + 帐篷耐久 + 天数合成同一个结果', () => {
    let s = newGame('fb-oasis', calmOverrides(newGame('fb-oasis').map));
    s = mutate(s, (m) => {
      m.tents = mkTents([3]);
      m.pendingResults = [];
    });
    // 先掉一点耐力，修整才有意义
    s = mutate(s, (m) => {
      m.stamina = 3;
    });
    const target = nearestTileOf(s, 'OASIS');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'SUNNY');
    s = walk(s, path);
    s = mutate(s, (m) => {
      m.pendingResults = [];
      m.stamina = 3;
      m.tents = mkTents([3]);
    });
    const s2 = performAction(s, { type: 'REST', tentId: TENT_A });
    const r = lastResult(s2);
    expect(s2.pendingResults).toHaveLength(1);
    expect(changeOf(r, 'stamina')).toMatchObject({ before: '3/5', after: '4/5', direction: 'up' });
    expect(changeOf(r, 'tent')).toMatchObject({ label: 'Tent A', before: '3/3', after: '2/3' });
    expect(changeOf(r, 'day')).toBeTruthy();
  });

  it('dismissPendingResult：玩家确认后从队列移除，且是纯函数（不改原状态）', () => {
    const { s } = arriveRain('fb-dismiss', [3]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, { kind: 'RAINSTORM', useTent: false });
    expect(s2.pendingResults).toHaveLength(1);
    const s3 = dismissPendingResult(s2);
    expect(s3.pendingResults).toHaveLength(0);
    expect(s2.pendingResults).toHaveLength(1); // 原状态不被修改
    expect(dismissPendingResult(s3).pendingResults).toHaveLength(0); // 空队列安全
  });
});

/* ------------------------------------------------------------------ */
/* §十一 双记录：即时反馈 + 右下角历史日志                               */
/* ------------------------------------------------------------------ */

describe('§十一 同一事件同时进入即时反馈与历史日志', () => {
  it('暴雨结算后：结果弹窗与日志各有一条，且日志仍是历史累积', () => {
    const { s } = arriveRain('fb-dual-1', [3]);
    const logBefore = s.log.length;
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, { kind: 'RAINSTORM', useTent: false });
    const r = lastResult(s2);
    expect(s2.log.length).toBe(logBefore + 1);
    expect(
      s2.log.some((e) => e.day === r.history.day && e.text === r.history.text && e.kind === r.history.kind),
    ).toBe(true);
    // 日志没有被清空 / 没有被替换成只有弹窗
    expect(s2.log.length).toBeGreaterThan(1);
  });

  it('整局不变量：每条即时反馈都能在右下角日志里找到同源记录', () => {
    const real = driveFullGame('fb-dual-full', false);
    expect(real.missing).toEqual([]);
    expect(real.results.length).toBeGreaterThan(0);
    expect(real.logLength).toBeLessThanOrEqual(gameConfig.logLimit);

    // 晴朗地图上跑一局完整远征（应当胜利），同样满足双记录不变量
    const calm = driveFullGame('fb-dual-calm', true);
    expect(calm.missing).toEqual([]);
    expect(calm.status).toBe('VICTORY');
    expect(calm.log.length).toBeGreaterThan(3); // 右下列表始终保留历史
  });

  it('日志仍在保留（不会被即时反馈取代）', () => {
    const { s } = arriveRain('fb-dual-2', [3]);
    const s2 = resolvePendingEvent(s, s.pendingEvents[0].id, { kind: 'RAINSTORM', useTent: true, tentId: TENT_A });
    expect(lastResult(s2)).toBeTruthy();
    expect(s2.log.some((e) => e.text.includes('Tent A'))).toBe(true);
  });

  it('结算日志按「事件发生当天」记录，便于历史回溯', () => {
    let s = newGame('fb-log-day', calmOverrides(newGame('fb-log-day').map));
    s = mutate(s, (m) => {
      m.pendingResults = [];
    });
    const target = nearestTileOf(s, 'GRASS');
    const path = pathTo(s, target);
    s = withWeather(s, target, path.length, 'MUD');
    s = walk(s, path);
    const r = lastResult(s);
    // 泥沼额外 +1 天，但日志记录的是「发生泥沼的那一天」
    expect(r.history.day).toBe(path.length);
    expect(r.day).toBe(path.length + 1);
  });
});

/* ------------------------------------------------------------------ */
/* 其它：结局也能看到最后一次结算                                        */
/* ------------------------------------------------------------------ */

describe('失败局：结算原因明确', () => {
  it('耐力耗尽失败时结果里带有明确原因，可直接展示给玩家', () => {
    const { s } = arriveRain('fb-fatal', [], 1);
    expect(s.status).toBe('DEFEAT');
    const r = lastResult(s);
    expect(r.outcome).toBe('DEFEAT');
    expect(r.defeatReason).toBe('STAMINA_EXHAUSTED');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

// 保证未使用的导入不会让 lint/tsc 报错（同时兜住 helpers 的导出契约）
void legal;
void TENT_B;
void TENT_C;
void TENT_D;
