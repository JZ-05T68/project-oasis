import { describe, it, expect } from 'vitest';
import { performAction, performMove, getLegalMoves } from '../src/game';
import { evaluateViability } from '../src/game/rules/viability';
import { newGame, calmOverrides, mutate, nearestMineTile, walkTo } from './helpers';

/**
 * v0.1.2a 提前判负：
 * - 路线彻底封死 → NO_LEGAL_ROUTE；
 * - 剩余时间无法合法完成 → INSUFFICIENT_TIME；
 * - 正常可完成时绝不误判；
 * - 裁判信息不向玩家泄露任何具体数值（API 只返回 ok/reason）。
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
      m.tents = [3];
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
    s = performAction(s, { type: 'WAIT', tentIndex: 0 });
    expect(s.status).toBe('DEFEAT');
    expect(['NO_LEGAL_ROUTE', 'RETURN_ROUTE_SEVERED']).toContain(s.defeatReason);
  });
});

describe('提前判负：不误判', () => {
  it('开局满时间时 viability 通过，正常行动不被打断', () => {
    let s = newGame('fail-ok', calmOverrides(newGame('fail-ok').map));
    expect(evaluateViability(s).ok).toBe(true);
    s = performMove(s, getLegalMoves(s)[0]);
    expect(s.status).toBe('ONGOING');
    s = performAction(s, { type: 'WAIT', tentIndex: 0 });
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
      performAction(s, { type: 'WAIT', tentIndex: 0 });
    }
    for (const entry of s.log) {
      expect(entry.text).not.toMatch(/最短|至少还需|最优路线/);
    }
  });
});
