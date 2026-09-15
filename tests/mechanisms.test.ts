import { describe, it, expect, afterEach } from 'vitest';
import { gameConfig } from '../src/game';
import { getAvailableActions, performAction, performMove } from '../src/game';
import { GameError, type GameState, type TileId } from '../src/game/types';
import {
  accidentChanceForMiningDay,
  desertExtraDaysForLoad,
  dropToRelieveKg,
  isOverloaded,
  rollMiningAccident,
  yieldForMiningDay,
} from '../src/game/rules/mining';
import { newGame, calmOverrides, mutate, findTiles, TENT_A, mkTents } from './helpers';

/**
 * Autonomous Mechanism Evolution Lab —— 机制回归测试。
 *
 * 最关键的一组断言是「**默认全部关闭时行为与落盘前逐位一致**」：
 * 机制代码进入了正式引擎，但默认关闭，因此生产游戏的规则、数值、UI 都不能变。
 */

type Mech = typeof gameConfig.mechanisms;
/** 机制配置的深部分覆盖（测试里只写关心的字段，其余保持默认） */
type MechPatch = { [K in keyof Mech]?: Partial<Mech[K]> };
const SNAPSHOT: Mech = structuredClone(gameConfig.mechanisms);

afterEach(() => {
  for (const k of Object.keys(SNAPSHOT) as Array<keyof Mech>) {
    Object.assign(gameConfig.mechanisms[k], SNAPSHOT[k]);
  }
});

function setMech(patch: MechPatch): void {
  for (const [k, v] of Object.entries(patch)) {
    Object.assign(gameConfig.mechanisms[k as keyof Mech], v);
  }
}

function allOff(): void {
  setMech({
    diminishingYield: { enabled: false },
    accidentRisk: { enabled: false },
    loadReturn: { enabled: false, surveyRadius: 0 },
    mineProductivity: { enabled: false },
  });
}

/* ------------------------------------------------------------------ */
/* 1. 默认关闭 = 与落盘前逐位一致                                        */
/* ------------------------------------------------------------------ */
describe('机制默认值（v0.1.4 正式落盘状态）', () => {
  it('只有 loadReturn 被正式开启，其余候选机制保持关闭', () => {
    // 通过 Promotion Gate 并落盘的唯一机制
    expect(SNAPSHOT.loadReturn.enabled).toBe(true);
    expect(SNAPSHOT.loadReturn.thresholdKg).toBe(24);
    expect(SNAPSHOT.loadReturn.stepKg).toBe(6);
    expect(SNAPSHOT.loadReturn.maxExtraPerDesertTile).toBe(1);
    expect(SNAPSHOT.loadReturn.allowDrop).toBe(true);
    expect(SNAPSHOT.loadReturn.surveyRadius).toBe(0);
    // 未通过 Gate 的候选必须保持关闭（代码留在引擎里，但默认不生效）
    expect(SNAPSHOT.diminishingYield.enabled).toBe(false);
    expect(SNAPSHOT.accidentRisk.enabled).toBe(false);
    expect(SNAPSHOT.mineProductivity.enabled).toBe(false);
  });

  it('落盘后帐篷单价为 625（3 顶买得起 / 4 顶买不起）', () => {
    expect(gameConfig.tentPrice).toBe(625);
    expect(3 * gameConfig.tentPrice).toBeLessThanOrEqual(gameConfig.startCash);
    expect(4 * gameConfig.tentPrice).toBeGreaterThan(gameConfig.startCash);
  });

  it('全部机制关闭时：产量恒为 gemPerMiningDay，事故概率恒为 0', () => {
    allOff();
    for (let n = 1; n <= 30; n++) {
      expect(yieldForMiningDay(n)).toBe(gameConfig.gemPerMiningDay);
      expect(yieldForMiningDay(n, 'A')).toBe(gameConfig.gemPerMiningDay);
      expect(accidentChanceForMiningDay(n)).toBe(0);
      expect(rollMiningAccident('s', n, n)).toBe(false);
    }
    expect(desertExtraDaysForLoad(999)).toBe(0);
    expect(isOverloaded(999)).toBe(false);
  });

  it('挖矿只加固定产量、只消耗 1 天；没有丢弃宝石按钮', () => {
    allOff();
    const s0 = newGame('mech-default');
    const s1 = mutate(s0, (s) => {
      s.phase = 'MINING';
      s.position = s.map.mines[0].tileId;
      s.mineEntranceId = s.map.mines[0].tileId;
      s.cash = 0;
    });
    const before = { day: s1.daysUsed, gems: s1.gemsKg };
    const s2 = performAction(s1, { type: 'MINE' });
    expect(s2.daysUsed).toBe(before.day + 1);
    expect(s2.gemsKg).toBe(before.gems + gameConfig.gemPerMiningDay);
    expect(s2.stats.miningAccidents).toBe(0);
    const acts = getAvailableActions(s2);
    expect(acts.some((a) => a.action.type === 'DROP_GEMS')).toBe(false);
  });

  it('机制关闭时 DROP_GEMS 是非法行动（抛 GameError）', () => {
    allOff();
    const s = mutate(newGame('mech-drop-off'), (x) => {
      x.phase = 'RETURN';
      x.gemsKg = 30;
      x.mineEntranceId = x.map.mines[0].tileId;
    });
    expect(() => performAction(s, { type: 'DROP_GEMS', dropKg: 4 })).toThrow(GameError);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Candidate Family A —— 递减产量                                     */
/* ------------------------------------------------------------------ */
describe('M01 diminishing-yield（分段）', () => {
  it('2.5 / 2.0 / 1.5 三段，边界正确', () => {
    allOff();
    setMech({ diminishingYield: { enabled: true, mode: 'tier', tierYields: [2.5, 2.0, 1.5], tierStarts: [4, 8] } });
    expect([1, 2, 3].map((n) => yieldForMiningDay(n))).toEqual([2.5, 2.5, 2.5]);
    expect([4, 5, 6, 7].map((n) => yieldForMiningDay(n))).toEqual([2.0, 2.0, 2.0, 2.0]);
    expect([8, 12, 30].map((n) => yieldForMiningDay(n))).toEqual([1.5, 1.5, 1.5]);
  });

  it('平滑模式单调不增且不低于下限', () => {
    allOff();
    setMech({ diminishingYield: { enabled: true, mode: 'smooth', smoothBase: 2.6, smoothDecay: 0.88, smoothFloor: 1.1 } });
    let prev = Infinity;
    for (let n = 1; n <= 40; n++) {
      const y = yieldForMiningDay(n);
      expect(y).toBeLessThanOrEqual(prev);
      expect(y).toBeGreaterThanOrEqual(1.1);
      prev = y;
    }
  });

  it('引擎按递减产量结算：连挖 8 天 = 3×2.5 + 4×2.0 + 1×1.5', () => {
    allOff();
    setMech({ diminishingYield: { enabled: true, mode: 'tier', tierYields: [2.5, 2.0, 1.5], tierStarts: [4, 8] } });
    const s = mutate(newGame('mech-dim'), (x) => {
      x.phase = 'MINING';
      x.position = x.map.mines[0].tileId;
      x.mineEntranceId = x.map.mines[0].tileId;
      x.maxDays = 99;
    });
    let cur = s;
    for (let i = 0; i < 8; i++) cur = performAction(cur, { type: 'MINE' });
    expect(cur.gemsKg).toBeCloseTo(3 * 2.5 + 4 * 2.0 + 1 * 1.5, 2);
    expect(cur.stats.miningDays).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Candidate Family C —— 递增事故风险                                 */
/* ------------------------------------------------------------------ */
describe('M03/M04 accident-risk', () => {
  it('概率随采矿天数线性上升并被上限截断', () => {
    allOff();
    setMech({ accidentRisk: { enabled: true, baseChance: 0.05, growthPerDay: 0.025, capChance: 0.3 } });
    expect(accidentChanceForMiningDay(1)).toBeCloseTo(0.05, 6);
    expect(accidentChanceForMiningDay(5)).toBeCloseTo(0.15, 6);
    expect(accidentChanceForMiningDay(99)).toBeCloseTo(0.3, 6);
  });

  it('掷骰确定性：同 seed + 同天数 + 同采矿日 → 永远同结果；不同 seed 会产生差异', () => {
    allOff();
    setMech({ accidentRisk: { enabled: true, baseChance: 0.3, growthPerDay: 0.05, capChance: 0.6 } });
    for (const seed of ['a', 'b', 'c']) {
      const r1 = rollMiningAccident(seed, 5, 2);
      const r2 = rollMiningAccident(seed, 5, 2);
      expect(r1).toBe(r2);
    }
    const outcomes = new Set<boolean>();
    for (let i = 0; i < 400; i++) outcomes.add(rollMiningAccident(`seed-${i}`, 5, 3));
    expect(outcomes.size).toBe(2); // 既有命中也有未命中 → 不是恒真/恒假
  });

  it('事故会损失当日产量并额外消耗天数（不走耐力通道）', () => {
    allOff();
    setMech({
      accidentRisk: { enabled: true, baseChance: 1, growthPerDay: 0, capChance: 1, yieldLossFraction: 0.5, extraDays: 1, cargoLossFraction: 0 },
    });
    const s = mutate(newGame('mech-acc'), (x) => {
      x.phase = 'MINING';
      x.position = x.map.mines[0].tileId;
      x.mineEntranceId = x.map.mines[0].tileId;
      x.stamina = 5;
      x.maxDays = 99;
    });
    const out = performAction(s, { type: 'MINE' });
    expect(out.gemsKg).toBeCloseTo(gameConfig.gemPerMiningDay * 0.5, 2);
    expect(out.daysUsed).toBe(1 + 1); // 挖 1 天 + 事故额外 1 天
    expect(out.stamina).toBe(5); // 事故不扣耐力
    expect(out.stats.miningAccidents).toBe(1);
    expect(out.stats.miningAccidentLostKg).toBeCloseTo(gameConfig.gemPerMiningDay * 0.5, 2);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Candidate Family D（重设计）—— 返程负重 + 主动丢货                 */
/* ------------------------------------------------------------------ */
describe('M05/M11 load-return', () => {
  it('负重惩罚分级：低于阈值 0；每多背 stepKg 多 1 天；被上限截断', () => {
    allOff();
    setMech({ loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, maxExtraPerDesertTile: 2 } });
    expect(desertExtraDaysForLoad(0)).toBe(0);
    expect(desertExtraDaysForLoad(19.99)).toBe(0);
    expect(desertExtraDaysForLoad(20)).toBe(1);
    expect(desertExtraDaysForLoad(23.9)).toBe(1);
    expect(desertExtraDaysForLoad(24)).toBe(2);
    expect(desertExtraDaysForLoad(40)).toBe(2); // 上限
    expect(isOverloaded(20)).toBe(true);
    expect(isOverloaded(19)).toBe(false);
  });

  it('dropToRelieveKg 返回「刚好降到阈值以下」所需的 kg（按步长向上取整）', () => {
    allOff();
    setMech({ loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, dropStepKg: 4 } });
    expect(dropToRelieveKg(20)).toBe(4); // 20 → 16
    expect(dropToRelieveKg(24)).toBe(8); // 24 → 16
    expect(dropToRelieveKg(19)).toBe(0);
  });

  it('只在载重超阈值时，返程进入沙漠才额外耗天', () => {
    allOff();
    setMech({ loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, maxExtraPerDesertTile: 2, allowDrop: true, dropStepKg: 4 } });
    const base = newGame('mech-load', calmOverrides(newGame('mech-load').map));
    const sand = findTiles(base, 'DESERT');
    expect(sand.length).toBeGreaterThan(0);
    // 找到一块「非城市/非矿区」的格子，它有一个沙漠邻居
    let from: TileId | null = null;
    let to: TileId | null = null;
    for (const id of Object.keys(base.map.tiles)) {
      const t = base.map.tiles[id];
      if (t.terrain === 'CITY' || t.terrain === 'MINE') continue;
      for (const nb of [
        `${t.row - 1}:${t.col}`,
        `${t.row + 1}:${t.col}`,
        `${t.row}:${t.col - 1}`,
        `${t.row}:${t.col + 1}`,
      ]) {
        if (base.map.tiles[nb]?.terrain === 'DESERT') {
          from = id;
          to = nb;
          break;
        }
      }
      if (from) break;
    }
    expect(from).not.toBeNull();

    const mkState = (gemsKg: number): GameState =>
      mutate(base, (x) => {
        x.phase = 'RETURN';
        x.position = from!;
        x.mineEntranceId = x.map.mines[0].tileId;
        x.visitedOutbound = [x.map.cityId];
        x.visitedReturn = [x.map.mines[0].tileId];
        x.gemsKg = gemsKg;
        x.daysUsed = 0;
        x.maxDays = 99;
      });

    // 轻装：进入沙漠只花 1 天
    const light = performMove(mkState(10), to!);
    expect(light.daysUsed).toBe(1);
    expect(light.stats.loadPenaltyDays).toBe(0);

    // 重载 24kg：额外 2 天
    const heavy = performMove(mkState(24), to!);
    expect(heavy.daysUsed).toBe(1 + 2);
    expect(heavy.stats.loadPenaltyDays).toBe(2);
  });

  it('DROP_GEMS 只减宝石、不消耗时间，并累计遥测', () => {
    allOff();
    setMech({ loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, allowDrop: true, dropStepKg: 4 } });
    const s = mutate(newGame('mech-drop'), (x) => {
      x.phase = 'RETURN';
      x.gemsKg = 24;
      x.mineEntranceId = x.map.mines[0].tileId;
    });
    const out = performAction(s, { type: 'DROP_GEMS', dropKg: 4 });
    expect(out.gemsKg).toBe(20);
    expect(out.daysUsed).toBe(s.daysUsed);
    expect(out.cash).toBe(s.cash);
    expect(out.stats.droppedKg).toBe(4);
    const acts = getAvailableActions(out);
    expect(acts.some((a) => a.action.type === 'DROP_GEMS')).toBe(true);
  });

  it('勘察半径 >0 时，抵达矿区会揭示周边地形', () => {
    allOff();
    setMech({ loadReturn: { enabled: true, surveyRadius: 1 } });
    const s0 = newGame('mech-survey');
    const mine = s0.map.mines[0].tileId;
    const beforeIntel = s0.intelKnown.length;
    const path = (() => {
      // 直接放到矿区旁边一格再进入矿区，避免长程行走
      const t = s0.map.tiles[mine];
      const nbs = [
        `${t.row - 1}:${t.col}`,
        `${t.row + 1}:${t.col}`,
        `${t.row}:${t.col - 1}`,
        `${t.row}:${t.col + 1}`,
      ].filter((id) => s0.map.tiles[id]);
      return nbs[0];
    })();
    const s1 = mutate(s0, (x) => {
      x.position = path;
      x.visitedOutbound = [x.map.cityId, path];
    });
    const s2 = performMove(s1, mine);
    expect(s2.phase).toBe('MINING');
    expect(s2.intelKnown.length).toBeGreaterThan(beforeIntel);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Candidate Family B —— 矿区生产力                                  */
/* ------------------------------------------------------------------ */
describe('M07 mine-productivity', () => {
  it('A/B 各自倍率生效，且不影响事故/时间', () => {
    allOff();
    setMech({ mineProductivity: { enabled: true, scaleA: 1.3, scaleB: 0.7 } });
    expect(yieldForMiningDay(1, 'A')).toBeCloseTo(gameConfig.gemPerMiningDay * 1.3, 2);
    expect(yieldForMiningDay(1, 'B')).toBeCloseTo(gameConfig.gemPerMiningDay * 0.7, 2);
    expect(yieldForMiningDay(1)).toBe(gameConfig.gemPerMiningDay); // 未指定 slot = 中性
    expect(accidentChanceForMiningDay(5)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. 组合机制不得互相覆盖                                              */
/* ------------------------------------------------------------------ */
describe('机制组合', () => {
  it('递减 + 事故 + 负重 + 生产力可以同时启用，且各自生效', () => {
    allOff();
    setMech({
      diminishingYield: { enabled: true, mode: 'tier', tierYields: [2.5, 2.0, 1.5], tierStarts: [4, 8] },
      accidentRisk: { enabled: true, baseChance: 0.05, growthPerDay: 0.025, capChance: 0.3 },
      loadReturn: { enabled: true, thresholdKg: 20, stepKg: 4, maxExtraPerDesertTile: 2 },
      mineProductivity: { enabled: true, scaleA: 1.3, scaleB: 0.7 },
    });
    expect(yieldForMiningDay(1, 'A')).toBeCloseTo(2.5 * 1.3, 2);
    expect(yieldForMiningDay(9, 'B')).toBeCloseTo(1.5 * 0.7, 2);
    expect(accidentChanceForMiningDay(1)).toBeCloseTo(0.05, 6);
    expect(desertExtraDaysForLoad(24)).toBe(2);
  });

  it('帐篷耐久常量未受机制影响（控制变量核对）', () => {
    expect(gameConfig.tentDesertCharges).toBe(3);
    expect(mkTents([3]).length).toBe(1);
    expect(TENT_A).toBe('tent-001');
  });
});
