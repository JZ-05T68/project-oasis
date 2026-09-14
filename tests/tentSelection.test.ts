import { describe, it, expect } from 'vitest';
import { performAction, performMove, resolvePendingEvent } from '../src/game';
import { GameError } from '../src/game/types';
import type { GameState, TentId, TentItem } from '../src/game/types';
import {
  newGame,
  calmOverrides,
  mutate,
  mkTents,
  charges,
  tentIds,
  nearestTileOf,
  pathTo,
  walk,
  withWeather,
  mineTile,
  TENT_A,
  TENT_B,
  TENT_C,
  TENT_D,
} from './helpers';

/**
 * v0.1.2b 多顶帐篷专项（真人试玩 P0 回归）。
 *
 * 真人试玩复现：沙漠沙尘暴里拥有多顶帐篷时，后两顶「点不动」。
 * 根因是 Modal 内容溢出被裁剪（见 EventModal / global.css 修复），
 * 同时引擎侧的帐篷选择从 array index 改为稳定唯一 ID。
 *
 * 本文件用固定的 4 顶帐篷（Tent A 3/3、B 2/3、C 1/3、D 3/3）逐一点击，
 * 覆盖全部 5 个需要选择帐篷的场景，断言：
 *   1. 四顶全部可被选中（引擎不会因为「第 3/4 顶」拒绝）；
 *   2. 只消耗玩家明确选择的那一顶，其它帐篷的 ID 与耐久完全不变；
 *   3. 选中耐久为 1 的帐篷时它整顶消失，列表重排后其余帐篷 ID 不错位。
 */

const BASE = [3, 2, 1, 3];
const ALL: TentId[] = [TENT_A, TENT_B, TENT_C, TENT_D];
const LABEL: Record<string, string> = {
  [TENT_A]: 'A',
  [TENT_B]: 'B',
  [TENT_C]: 'C',
  [TENT_D]: 'D',
};

/** 期望：普通消耗（耐久 -1，归零整顶移除） */
function expectChargeConsumed(after: TentItem[], chosen: TentId) {
  const before = new Map(ALL.map((id, i) => [id, BASE[i]]));
  const expectedIds: TentId[] = [];
  const expectedCharges: number[] = [];
  for (const id of ALL) {
    const left = before.get(id)! - (id === chosen ? 1 : 0);
    if (left > 0) {
      expectedIds.push(id);
      expectedCharges.push(left);
    }
  }
  expect(tentIds(after)).toEqual(expectedIds);
  expect(charges(after)).toEqual(expectedCharges);
  expect(after.some((t) => t.id === chosen && t.charges === 0)).toBe(false);
}

/** 期望：暴雨整顶报废 */
function expectWholeTentLost(after: TentItem[], chosen: TentId) {
  const expectedIds = ALL.filter((id) => id !== chosen);
  expect(tentIds(after)).toEqual(expectedIds);
  expect(charges(after)).toEqual(BASE.filter((_, i) => ALL[i] !== chosen));
}

/* ------------------------------------------------------------------ */
/* 场景构造                                                            */
/* ------------------------------------------------------------------ */

function base(seed: string): GameState {
  return newGame(seed, calmOverrides(newGame(seed).map));
}

/** 沙漠沙尘暴：走到沙漠格并在抵达日强制沙尘暴 */
function sandstormPending(seed: string): GameState {
  let s = mutate(base(seed), (m) => {
    m.tents = mkTents(BASE);
    m.compasses = 0;
  });
  const target = nearestTileOf(s, 'DESERT');
  const path = pathTo(s, target);
  s = withWeather(s, target, path.length, 'SANDSTORM');
  if (path.length > 1) s = walk(s, path.slice(0, -1));
  s = performMove(s, path[path.length - 1]);
  return s;
}

/** 草地暴雨：走到草地格并在抵达日强制暴雨 */
function rainstormPending(seed: string): GameState {
  let s = mutate(base(seed), (m) => {
    m.tents = mkTents(BASE);
  });
  const target = nearestTileOf(s, 'GRASS');
  const path = pathTo(s, target);
  s = withWeather(s, target, path.length, 'RAINSTORM');
  if (path.length > 1) s = walk(s, path.slice(0, -1));
  s = performMove(s, path[path.length - 1]);
  return s;
}

/** 野外宿营：传送到野外（沙漠/草地/绿洲）后原地停留 */
function fieldCamp(seed: string, terrain: 'DESERT' | 'GRASS' | 'OASIS'): GameState {
  let s = base(seed);
  const target = Object.values(s.map.tiles).find((t) => t.terrain === terrain)!;
  return mutate(s, (m) => {
    m.tents = mkTents(BASE);
    m.position = target.id;
    if (!m.visitedOutbound.includes(target.id)) m.visitedOutbound.push(target.id);
    if (!m.explored.includes(target.id)) m.explored.push(target.id);
  });
}

/** 有水绿洲修整 */
function oasisRest(seed: string): GameState {
  let s = base(seed);
  const oasis = Object.values(s.map.tiles).find((t) => t.terrain === 'OASIS')!;
  return mutate(s, (m) => {
    m.tents = mkTents(BASE);
    m.stamina = 3;
    m.map.drought[oasis.id] = false;
    m.position = oasis.id;
    if (!m.visitedOutbound.includes(oasis.id)) m.visitedOutbound.push(oasis.id);
    if (!m.explored.includes(oasis.id)) m.explored.push(oasis.id);
  });
}

/** 矿区原地等待 */
function mineWait(seed: string): GameState {
  let s = base(seed);
  const mine = mineTile(s, 'A');
  return mutate(s, (m) => {
    m.tents = mkTents(BASE);
    m.position = mine;
    m.phase = 'MINING';
    m.mineEntranceId = mine;
    m.stats.outboundDays = m.daysUsed;
    if (!m.visitedOutbound.includes(mine)) m.visitedOutbound.push(mine);
  });
}

/* ------------------------------------------------------------------ */
/* 专项测试                                                            */
/* ------------------------------------------------------------------ */

describe('多顶帐篷专项 §3.2：沙漠沙尘暴', () => {
  for (const id of [TENT_A, TENT_B, TENT_C, TENT_D]) {
    it(`Tent ${LABEL[id]} 可被选中，只消耗它自己`, () => {
      const s = sandstormPending('tent4-storm');
      expect(s.pendingEvents[0].kind).toBe('SANDSTORM');
      expect(charges(s.tents)).toEqual(BASE); // 抵达时四顶完好
      const ev = s.pendingEvents[0];
      const after = resolvePendingEvent(s, ev.id, {
        kind: 'SANDSTORM',
        useTent: true,
        useCompass: false,
        tentId: id,
      });
      expectChargeConsumed(after.tents, id);
    });
  }

  it('四顶全部可被选中（引擎逐顶接受，不存在「第 3/4 顶无效」）', () => {
    const accepted: string[] = [];
    for (const id of ALL) {
      const s = sandstormPending(`tent4-storm-all-${LABEL[id]}`);
      const ev = s.pendingEvents[0];
      const after = resolvePendingEvent(s, ev.id, {
        kind: 'SANDSTORM',
        useTent: true,
        useCompass: false,
        tentId: id,
      });
      expect(after.pendingEvents.length).toBe(0);
      accepted.push(id);
    }
    expect(accepted).toEqual(ALL);
  });

  it('不选帐篷 / 传不存在或空 ID → 明确报错，不误消耗', () => {
    const s = sandstormPending('tent4-storm-err');
    const ev = s.pendingEvents[0];
    const noTent = () =>
      resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false });
    expect(noTent).toThrow(GameError);
    expect(() =>
      resolvePendingEvent(s, ev.id, { kind: 'SANDSTORM', useTent: true, useCompass: false, tentId: 'tent-999' }),
    ).toThrow(GameError);
    expect(charges(s.tents)).toEqual(BASE); // 原状态未被改动
  });
});

describe('多顶帐篷专项 §3.2：草地暴雨（整顶报废）', () => {
  for (const id of [TENT_A, TENT_B, TENT_C, TENT_D]) {
    it(`Tent ${LABEL[id]} 可被选中，且整顶报废`, () => {
      const s = rainstormPending('tent4-rain');
      expect(s.pendingEvents[0].kind).toBe('RAINSTORM');
      expect(charges(s.tents)).toEqual(BASE);
      const ev = s.pendingEvents[0];
      const after = resolvePendingEvent(s, ev.id, { kind: 'RAINSTORM', useTent: true, tentId: id });
      expectWholeTentLost(after.tents, id);
      expect(after.stamina).toBe(5); // 用帐篷不掉耐力
    });
  }
});

describe('多顶帐篷专项 §3.2：野外宿营（耐久 -1）', () => {
  for (const terrain of ['DESERT', 'GRASS', 'OASIS'] as const) {
    for (const id of [TENT_A, TENT_B, TENT_C, TENT_D]) {
      it(`${terrain} 宿营：选中 Tent ${LABEL[id]} 只扣它`, () => {
        const s = fieldCamp(`tent4-camp-${terrain}-${LABEL[id]}`, terrain);
        const after = performAction(s, { type: 'WAIT', tentId: id });
        expect(after.daysUsed).toBe(1);
        expectChargeConsumed(after.tents, id);
      });
    }
  }
});

describe('多顶帐篷专项 §3.2：有水绿洲修整（耐久 -1）', () => {
  for (const id of [TENT_A, TENT_B, TENT_C, TENT_D]) {
    it(`Tent ${LABEL[id]} 可被选中，只扣它`, () => {
      const s = oasisRest(`tent4-oasis-${LABEL[id]}`);
      const after = performAction(s, { type: 'REST', tentId: id });
      expect(after.stamina).toBe(4);
      expectChargeConsumed(after.tents, id);
    });
  }
});

describe('多顶帐篷专项 §3.2：矿区原地等待（耐久 -1）', () => {
  for (const id of [TENT_A, TENT_B, TENT_C, TENT_D]) {
    it(`Tent ${LABEL[id]} 可被选中，只扣它`, () => {
      const s = mineWait(`tent4-mine-${LABEL[id]}`);
      expect(s.phase).toBe('MINING');
      const after = performAction(s, { type: 'WAIT', tentId: id });
      expectChargeConsumed(after.tents, id);
      expect(after.gemsKg).toBe(0); // 等待不产出
    });
  }
});

describe('多顶帐篷专项 §3.2：稳定 ID 不错位（列表重排后仍指向正确的帐篷）', () => {
  it('连续消耗：C(1/3) 消失后，D(3/3) 的 ID 与耐久不变', () => {
    let s = mineWait('tent4-shift');
    s = performAction(s, { type: 'WAIT', tentId: TENT_C }); // C 整顶消失
    expect(tentIds(s.tents)).toEqual([TENT_A, TENT_B, TENT_D]);
    expect(charges(s.tents)).toEqual([3, 2, 3]);
    // D 原本是下标 3，现在变成下标 2 —— 用 ID 选它必须仍然正确
    s = performAction(s, { type: 'WAIT', tentId: TENT_D });
    expect(tentIds(s.tents)).toEqual([TENT_A, TENT_B, TENT_D]);
    expect(charges(s.tents)).toEqual([3, 2, 2]);
    // 已被消耗的 ID 不能再被消耗
    expect(() => performAction(s, { type: 'WAIT', tentId: TENT_C })).toThrow(GameError);
  });

  it('用「已被消耗的 ID」重放 → 抛出 TENT_NOT_FOUND（不会误扣别人）', () => {
    let s = mineWait('tent4-stale');
    s = performAction(s, { type: 'WAIT', tentId: TENT_C }); // C(1/3) 报废
    let code = '';
    try {
      performAction(s, { type: 'WAIT', tentId: TENT_C });
    } catch (e) {
      code = (e as GameError).code;
    }
    expect(['TENT_NOT_FOUND', 'NO_TENT_CAMP']).toContain(code);
    expect(charges(s.tents)).toEqual([3, 2, 3]); // 三顶完好，没有被误扣
  });

  it('帐篷 ID 单调递增且不复用（购买 4 顶 → 用尽 1 顶 → 再购买）', () => {
    let s = base('tent4-serial');
    for (let i = 0; i < 4; i++) s = performAction(s, { type: 'BUY', item: 'tent' });
    expect(tentIds(s.tents)).toEqual([TENT_A, TENT_B, TENT_C, TENT_D]);
    expect(charges(s.tents)).toEqual([3, 3, 3, 3]);
    expect(s.nextTentSerial).toBe(5);
    // 到野外把 C 用尽（3 次宿营）
    s = mutate(s, (m) => {
      m.position = Object.values(m.map.tiles).find((t) => t.terrain === 'GRASS')!.id;
      if (!m.visitedOutbound.includes(m.position)) m.visitedOutbound.push(m.position);
    });
    for (let i = 0; i < 3; i++) s = performAction(s, { type: 'WAIT', tentId: TENT_C });
    expect(tentIds(s.tents)).toEqual([TENT_A, TENT_B, TENT_D]);
    // 回城再买一顶：必须是 tent-005，绝不能复用 tent-003
    s = mutate(s, (m) => {
      m.position = m.map.cityId;
      m.phase = 'OUTBOUND';
      m.cash = 2000;
    });
    s = performAction(s, { type: 'BUY', item: 'tent' });
    expect(tentIds(s.tents)).toEqual([TENT_A, TENT_B, TENT_D, 'tent-005']);
  });
});
