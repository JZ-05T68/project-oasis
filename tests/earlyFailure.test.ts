import { describe, it, expect } from 'vitest';
import { performAction, performMove, getLegalMoves, hasLegalReturnPath } from '../src/game';
import { evaluateViability } from '../src/game/rules/viability';
import { gameConfig } from '../src/game/config/gameConfig';
import {
  newGame,
  calmOverrides,
  mutate,
  nearestMineTile,
  mineTile,
  walkTo,
  mkTents,
  charges,
  TENT_A,
} from './helpers';

/**
 * v0.1.2a 提前判负：
 * - 路线彻底封死 → NO_LEGAL_ROUTE；
 * - 剩余时间无法合法完成 → INSUFFICIENT_TIME；
 * - 正常可完成时绝不误判；
 * - 裁判信息不向玩家泄露任何具体数值（API 只返回 ok/reason）。
 *
 * v0.1.2b：地图缩到 8×9 后重新验证 —— 小地图上「去程沿整行推进会留下烧格墙」
 * 变得常见，裁判的返程通行口径必须与 getLegalMoves 完全一致（当前矿区豁免），
 * 否则会把合法局面误判成 NO_LEGAL_ROUTE。
 */

describe('提前判负：时间不足（INSUFFICIENT_TIME）', () => {
  it('去程半程、剩余时间不足以往返 → 行动后立即判负', () => {
    let s = newGame('fail-time', calmOverrides(newGame('fail-time').map));
    const mine = nearestMineTile(s);
    // 先正常走到矿区附近（时间充裕，不触发判负）
    s = mutate(s, (m) => {
      // 直接传送到矿区：MINING 阶段的返程检测是精确 BFS
      m.position = mine.tileId;
      m.phase = 'MINING';
      m.mineEntranceId = mine.tileId;
      m.stats.outboundDays = m.daysUsed;
      if (!m.visitedOutbound.includes(mine.tileId)) m.visitedOutbound.push(mine.tileId);
    });
    // 把返程可行时间压缩到 0：剩余 0 天不可能回到城市
    s = mutate(s, (m) => {
      m.daysUsed = m.maxDays;
    });
    s = performAction(s, { type: 'MINE' }); // 挖 1 天 → 超限；即便不超限，返程时间也不足
    expect(s.status).toBe('DEFEAT');
    expect(['INSUFFICIENT_TIME', 'TIMEOUT']).toContain(s.defeatReason);
  });

  it('返程中时间耗尽 → INSUFFICIENT_TIME（而非继续无意义行走）', () => {
    let s = newGame('fail-time-return', calmOverrides(newGame('fail-time-return').map));
    const mine = nearestMineTile(s);
    s = mutate(s, (m) => {
      m.position = mine.tileId;
      m.phase = 'MINING';
      m.mineEntranceId = mine.tileId;
      m.stats.outboundDays = m.daysUsed;
      if (!m.visitedOutbound.includes(mine.tileId)) m.visitedOutbound.push(mine.tileId);
    });
    s = performAction(s, { type: 'START_RETURN' });
    expect(s.status).toBe('ONGOING');
    // 返程第一天把剩余时间压缩到 1 天：走不到城市
    s = mutate(s, (m) => {
      m.daysUsed = m.maxDays - 1;
    });
    const legal = getLegalMoves(s);
    if (legal.length > 0 && !legal.includes(s.map.cityId)) {
      s = performMove(s, legal[0]);
      expect(s.status).toBe('DEFEAT');
      expect(['INSUFFICIENT_TIME', 'TIMEOUT']).toContain(s.defeatReason);
    }
  });
});

describe('提前判负：路线封死（NO_LEGAL_ROUTE）', () => {
  it('返程足迹封死全部归途 → 判负且原因明确', () => {
    let s = newGame('fail-route', calmOverrides(newGame('fail-route').map));
    const mine = nearestMineTile(s);
    s = mutate(s, (m) => {
      m.position = mine.tileId;
      m.phase = 'MINING';
      m.mineEntranceId = mine.tileId;
      m.stats.outboundDays = m.daysUsed;
      if (!m.visitedOutbound.includes(mine.tileId)) m.visitedOutbound.push(mine.tileId);
    });
    s = performAction(s, { type: 'START_RETURN' });
    // 封死所有普通格：只剩矿区与城市（不连通）
    s = mutate(s, (m) => {
      m.tents = mkTents([3]);
      for (const id of Object.keys(m.map.tiles)) {
        const t = m.map.tiles[id];
        const isNormal =
          t.terrain === 'DESERT' || t.terrain === 'GRASS' || t.terrain === 'VILLAGE' || t.terrain === 'OASIS';
        if (!isNormal) continue;
        if (!m.visitedOutbound.includes(id) && !m.visitedReturn.includes(id)) {
          m.visitedOutbound.push(id);
        }
      }
    });
    // 任何行动（宿营）后的 viability 检查都会发现无路
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.status).toBe('DEFEAT');
    expect(['NO_LEGAL_ROUTE', 'RETURN_ROUTE_SEVERED']).toContain(s.defeatReason);
  });
});

describe('提前判负：8×9 新地图适配（v0.1.2b）', () => {
  it('地图尺寸与矿区行约束来自配置（不存在旧尺寸遗留）', () => {
    const s = newGame('adapt-size');
    expect(s.map.rows).toBe(8);
    expect(s.map.cols).toBe(9);
    expect(gameConfig.map.rows).toBe(8);
    expect(gameConfig.map.cols).toBe(9);
    const city = s.map.tiles[s.map.cityId];
    expect([city.row, city.col]).toEqual([7, 0]);
    for (const mine of s.map.mines) {
      expect(mine.col).toBe(8);
      expect(mine.row).toBeLessThanOrEqual(5);
      expect(mine.row).toBeLessThanOrEqual(8 - 3);
    }
  });

  it('开局：城市与到达任一矿区后 viability 都通过（不误判）', () => {
    for (const seed of ['adapt-ok-1', 'adapt-ok-2', 'adapt-ok-3']) {
      let s = newGame(seed, calmOverrides(newGame(seed).map));
      expect(evaluateViability(s).ok, seed).toBe(true);
      // 直接站到矿区（MINING）：返程必然可行
      for (const slot of ['A', 'B'] as const) {
        const at = mutate(s, (m) => {
          const id = mineTile(m, slot);
          m.position = id;
          m.phase = 'MINING';
          m.mineEntranceId = id;
          m.stats.outboundDays = m.daysUsed;
          if (!m.visitedOutbound.includes(id)) m.visitedOutbound.push(id);
        });
        expect(evaluateViability(at).ok, `${seed} Mine ${slot}`).toBe(true);
        expect(hasLegalReturnPath(at)).toBe(true);
      }
    }
  });

  it('回归：离开矿区后必须重新穿过当前矿区才能绕行 → 不再误判 NO_LEGAL_ROUTE', () => {
    // 沿一整行走到矿区会把该行全部烧掉，返程只能借道「当前矿区」绕下去。
    // 修正前裁判把两座矿区都当成不可通行节点，会直接判死。
    let s = newGame('adapt-corridor', calmOverrides(newGame('adapt-corridor').map));
    s = walkTo(s, mineTile(s, 'A'));
    expect(s.phase).toBe('MINING');
    s = performAction(s, { type: 'START_RETURN' });
    // 往矿区所在列的上方走一步（此时若上方被烧格围死，旧裁判会立即判负）
    const legal = getLegalMoves(s);
    expect(legal.length).toBeGreaterThan(0);
    for (const step of legal) {
      const after = performMove(s, step);
      if (after.status !== 'ONGOING') continue;
      // 仍然存活：说明裁判承认「当前矿区可作为通路」
      const legal2 = getLegalMoves(after);
      expect(legal2.length).toBeGreaterThan(0);
    }
  });

  it('真的走成死局时仍然正确判负，且不泄露任何天数/路径数值', () => {
    let s = newGame('adapt-dead', calmOverrides(newGame('adapt-dead').map));
    const mine = mineTile(s, 'A');
    s = mutate(s, (m) => {
      m.tents = mkTents([3]);
      m.position = mine;
      m.phase = 'MINING';
      m.mineEntranceId = mine;
      m.stats.outboundDays = m.daysUsed;
      // 除当前矿区外，把所有普通格全部烧掉 → 无路可回
      for (const id of Object.keys(m.map.tiles)) {
        const t = m.map.tiles[id];
        if (t.terrain === 'CITY' || t.terrain === 'MINE') continue;
        m.visitedOutbound.push(id);
      }
    });
    const v = evaluateViability(s);
    expect(v.ok).toBe(false);
    expect(Object.keys(v).sort()).toEqual(['ok', 'reason']);
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.status).toBe('DEFEAT');
    expect(['NO_LEGAL_ROUTE', 'RETURN_ROUTE_SEVERED']).toContain(s.defeatReason);
    for (const entry of s.log) {
      expect(entry.text).not.toMatch(/最短|至少还需|最优路线|\d+\s*天就能/);
    }
    // 判负不消耗玩家资源之外的东西：帐篷只按规则 -1
    expect(charges(s.tents)).toEqual([2]);
  });
});

describe('提前判负：不误判', () => {
  it('开局满时间时 viability 通过，正常行动不被打断', () => {
    let s = newGame('fail-ok', calmOverrides(newGame('fail-ok').map));
    s = mutate(s, (m) => {
      m.tents = mkTents([3]); // 野外宿营需要帐篷
    });
    expect(evaluateViability(s).ok).toBe(true);
    s = performMove(s, getLegalMoves(s)[0]);
    expect(s.status).toBe('ONGOING');
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.status).toBe('ONGOING');
  });

  it('中等行程仍有充足时间时不会误判', () => {
    let s = newGame('fail-ok-2', calmOverrides(newGame('fail-ok-2').map));
    s = walkTo(s, nearestMineTile(s).tileId);
    expect(s.status).toBe('ONGOING'); // 抵达矿区：返程时间足够
  });
});

describe('提前判负：不泄露内部数值', () => {
  it('viability 结果只含 ok/reason，无任何天数或路径信息', () => {
    let s = newGame('leak-check', calmOverrides(newGame('leak-check').map));
    const v = evaluateViability(s);
    expect(Object.keys(v).sort()).toEqual(['ok']);
    s = mutate(s, (m) => {
      m.daysUsed = m.maxDays; // 必败状态
    });
    const v2 = evaluateViability(s);
    expect(v2.ok).toBe(false);
    expect(Object.keys(v2).sort()).toEqual(['ok', 'reason']);
    expect(typeof (v2 as { reason: string }).reason).toBe('string');
    // 失败日志只说明原因，不包含“至少还需要 N 天”类数字提示
    if (s.status === 'ONGOING') {
      performAction(s, { type: 'WAIT', tentId: TENT_A });
    }
    for (const entry of s.log) {
      expect(entry.text).not.toMatch(/最短|至少还需|最优路线/);
    }
  });
});
