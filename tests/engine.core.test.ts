import { describe, it, expect } from 'vitest';
import {
  getLegalMoves,
  performMove,
  performAction,
  getAvailableActions,
} from '../src/game';
import { GameError } from '../src/game/types';
import { newGame, newMiniGame, calmOverrides, walk, act, mutate } from './helpers';
import { worldMap } from '../src/game/map/worldMap';
import { gameConfig } from '../src/game/config/gameConfig';

describe('核心引擎：初始状态', () => {
  it('初始状态符合规则', () => {
    const s = newGame('init-seed');
    expect(s.cash).toBe(2000);
    expect(s.stamina).toBe(5);
    expect(s.daysUsed).toBe(0);
    expect(s.phase).toBe('OUTBOUND');
    expect(s.status).toBe('ONGOING');
    expect(s.position).toBe(worldMap.cityId);
    expect(s.gemsKg).toBe(0);
    expect(s.tents).toEqual([]);
    expect(s.compasses).toBe(0);
    expect(s.visitedOutbound).toEqual([worldMap.cityId]);
    expect(s.visitedReturn).toEqual([]);
    expect(s.mineEntranceId).toBeNull();
    // 城市与矿区开局已知
    expect(s.explored).toContain(worldMap.cityId);
    for (const m of worldMap.mineIds) expect(s.explored).toContain(m);
    expect(s.seed).toBe('init-seed');
  });

  it('开局即可在城市购买装备（不消耗时间）', () => {
    let s = newGame('buy-city');
    s = performAction(s, { type: 'BUY', item: 'tent' });
    s = performAction(s, { type: 'BUY', item: 'compass' });
    expect(s.tents).toEqual([gameConfig.tentDesertCharges]);
    expect(s.compasses).toBe(1);
    expect(s.cash).toBe(2000 - 400 - 100);
    expect(s.equipmentSpent).toBe(500);
    expect(s.daysUsed).toBe(0);
  });

  it('现金不足时购买被禁用并抛错', () => {
    const s = mutate(newGame('buy-broke'), (m) => {
      m.cash = 50;
    });
    const actions = getAvailableActions(s);
    expect(actions.find((a) => a.action.item === 'tent')?.disabled).toBe(true);
    expect(() => performAction(s, { type: 'BUY', item: 'tent' })).toThrow(GameError);
  });
});

describe('核心引擎：去程移动规则', () => {
  it('只能移动到相邻合法格，非法移动抛错', () => {
    const s = newGame('move-illegal', calmOverrides(worldMap));
    expect(() => performMove(s, 'mineS')).toThrow(GameError); // 不相邻
    expect(() => performMove(s, 'sv')).toThrow(GameError); // 不相邻
  });

  it('去程不允许重新进入城市', () => {
    let s = newGame('city-ban', calmOverrides(worldMap));
    s = walk(s, ['sg1']);
    expect(getLegalMoves(s)).not.toContain('city');
    expect(() => performMove(s, 'city')).toThrow(GameError);
  });

  it('去程普通格不可重复经过', () => {
    let s = newGame('repeat-ban', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv']);
    // 从 sv 出发：sg1 已在去程走过，不再合法
    expect(getLegalMoves(s)).not.toContain('sg1');
    expect(() => performMove(s, 'sg1')).toThrow(GameError);
  });

  it('进入矿区入口后进入 MINING 阶段且不能移动', () => {
    let s = newGame('mining-lock', calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    expect(s.phase).toBe('MINING');
    expect(s.mineEntranceId).toBe('mineS');
    expect(getLegalMoves(s)).toEqual([]);
    expect(() => performMove(s, 'mg2')).toThrow(GameError);
  });
});

describe('核心引擎：返程规则', () => {
  function gotoSouthMine(seed: string) {
    let s = newGame(seed, calmOverrides(worldMap));
    s = walk(s, ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    s = act(s, { type: 'MINE' });
    s = performAction(s, { type: 'START_RETURN' });
    return s;
  }

  it('返程不得经过去程走过的普通格', () => {
    const s = gotoSouthMine('return-ban');
    expect(getLegalMoves(s)).not.toContain('sg2'); // 去程用过
    expect(() => performMove(s, 'sg2')).toThrow(GameError);
  });

  it('返程自身也不得重复普通格', () => {
    let s = gotoSouthMine('return-self-ban');
    s = walk(s, ['mg2', 'mo']);
    expect(getLegalMoves(s)).not.toContain('mg2');
    expect(() => performMove(s, 'mg2')).toThrow(GameError);
  });

  it('去返程交叉被禁止：返程路线必须与去程完全不重合', () => {
    let s = gotoSouthMine('cross-ban');
    s = walk(s, ['mg2', 'mo', 'mv']);
    // sv 在去程用过，返程从 mv 不允许走 sv
    expect(getLegalMoves(s)).not.toContain('sv');
    expect(() => performMove(s, 'sv')).toThrow(GameError);
  });

  it('矿区入口（宝库格）在返程中豁免：不会被当作重复格禁止进入', () => {
    let s = gotoSouthMine('mine-exempt');
    s = walk(s, ['mg2']);
    // mineS 虽在返程中已到过，但作为宝库格依然合法（豁免）——不会因“重复”被禁
    expect(getLegalMoves(s)).toContain('mineS');
  });

  it('返程走回矿区入口耗尽归途 → 被判定路线中断（豁免格也会被困死）', () => {
    let s = gotoSouthMine('mine-trap');
    s = walk(s, ['mg2']);
    s = performMove(s, 'mineS'); // 合法移动，但从这里已无任何归途（sg2 去程已用、mg2 返程已用）
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });

  it('返程抵达城市即胜利', () => {
    let s = gotoSouthMine('victory-12');
    s = walk(s, ['mg2', 'mo', 'mv', 'md1', 'mg1', 'city']);
    expect(s.status).toBe('VICTORY');
    expect(s.phase).toBe('FINISHED');
    expect(s.daysUsed).toBe(12); // 去程 5 + 挖矿 1 + 返程 6
  });
});

describe('核心引擎：路线中断（迷你地图）', () => {
  it('去程走进死路 → 立即判负（TRAPPED）', () => {
    // city - a - b，b 是死胡同
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS' },
      [
        ['city', 'a'],
        ['a', 'b'],
      ],
    );
    s = walk(s, ['a', 'b']);
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('TRAPPED');
  });

  it('去程封死矿区入口的所有归途 → 进矿即判负（RETURN_ROUTE_SEVERED）', () => {
    // city - a - m 与 city - a - b - m：走 a、b 进矿后 m 的两个出口全部已用
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
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });

  it('返程中途走入断头路 → 立即判负（RETURN_ROUTE_SEVERED）', () => {
    // city-a-m；返程 m-b-city 可行，但 b-d 是断头支路：走进 d 即被封死
    let s = newMiniGame(
      { city: 'CITY', a: 'GRASS', b: 'GRASS', d: 'GRASS', m: 'MINE' },
      [
        ['city', 'a'],
        ['a', 'm'],
        ['m', 'b'],
        ['b', 'city'],
        ['b', 'd'],
      ],
    );
    s = walk(s, ['a', 'm']);
    expect(s.status).toBe('ONGOING'); // 进矿时仍存在 b→city 归途
    s = performAction(s, { type: 'START_RETURN' });
    s = walk(s, ['b']);
    expect(s.status).toBe('ONGOING'); // b 仍有 city 归途
    s = performMove(s, 'd');
    expect(s.status).toBe('DEFEAT');
    expect(s.defeatReason).toBe('RETURN_ROUTE_SEVERED');
  });
});
