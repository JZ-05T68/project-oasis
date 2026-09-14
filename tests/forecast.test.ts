import { describe, it, expect } from 'vitest';
import { performMove, performAction, getLegalMoves } from '../src/game';
import { GameError } from '../src/game/types';
import { bfsPath } from '../src/game/map/grid';
import { newGame, calmOverrides, mutate, walkTo, mkTents, TENT_A } from './helpers';

/** 天气预报（v0.1.2）：单日局部 + 可储存次数 */
describe('天气预报：购买机制', () => {
  it('首次购买：maxDays 42→41，获得 3 次，自动使用 1 次剩 2 次，并立即显示明天', () => {
    let s = newGame('fc-buy-1', calmOverrides(newGame('fc-buy-1').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(41);
    expect(s.daysUsed).toBe(0); // 购买不消耗当天
    expect(s.forecastCharges).toBe(2);
    expect(s.stats.forecastPacks).toBe(1);
    expect(s.lastForecast).not.toBeNull();
    expect(s.lastForecast!.day).toBe(1); // 明天
  });

  it('重复购买正确叠加：1 存量 + 3 - 1 自动 = 3', () => {
    let s = newGame('fc-buy-2', calmOverrides(newGame('fc-buy-2').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(1);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(40);
    expect(s.forecastCharges).toBe(3);
    expect(s.stats.forecastPacks).toBe(2);
  });

  it('购买后手动使用：不消耗 daysUsed、不再减少 maxDays', () => {
    let s = newGame('fc-use-1', calmOverrides(newGame('fc-use-1').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const before = { day: s.daysUsed, maxDays: s.maxDays };
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.daysUsed).toBe(before.day);
    expect(s.maxDays).toBe(before.maxDays);
    expect(s.forecastCharges).toBe(before.day === 0 ? 1 : 1); // 2 - 1
  });

  it('次数不能低于 0：无次数时使用抛错', () => {
    const s = newGame('fc-use-2');
    expect(s.forecastCharges).toBe(0);
    expect(() => performAction(s, { type: 'USE_FORECAST' })).toThrow(GameError);
  });

  it('储存次数不过期、不随移动消失', () => {
    let s = newGame('fc-save', calmOverrides(newGame('fc-save').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    // 连续移动多天
    for (let i = 0; i < 3; i++) {
      const legal = getLegalMoves(s);
      s = performMove(s, legal[0]);
    }
    expect(s.forecastCharges).toBe(2); // 不过期
  });

  it('天数推进后旧预报失效', () => {
    let s = newGame('fc-stale', calmOverrides(newGame('fc-stale').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast).not.toBeNull();
    const legal = getLegalMoves(s);
    s = performMove(s, legal[0]);
    expect(s.lastForecast).toBeNull(); // 移动一天后失效
  });

  it('daysUsed == maxDays 时购买会被必败检查禁止', () => {
    let s = newGame('fc-death');
    s = mutate(s, (m) => {
      m.daysUsed = 42;
      m.maxDays = 42;
    });
    // v0.1.2a：购买将导致剩余时间不足 → 后台禁止购买，不进入对局
    expect(() => performAction(s, { type: 'BUY_FORECAST_PACK' })).toThrow(GameError);
  });
});

describe('天气预报：空间范围（当前格 + 8 邻域）', () => {
  it('内部格：显示当前 + 8 = 9 格', () => {
    let s = newGame('fc-area-in', calmOverrides(newGame('fc-area-in').map));
    // 走到内部格：找一个四邻都在图内的格子
    const inner = Object.values(s.map.tiles).find(
      (t) => t.row > 0 && t.row < s.map.rows - 1 && t.col > 0 && t.col < s.map.cols - 1,
    )!;
    s = mutate(s, (m) => {
      m.position = inner.id;
      m.visitedOutbound.push(inner.id);
      m.explored.push(inner.id);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(9);
    expect(s.lastForecast!.cells.filter((c) => c.isCurrent).length).toBe(1);
  });

  it('边缘格：显示当前 + 5 = 6 格', () => {
    let s = newGame('fc-area-edge', calmOverrides(newGame('fc-area-edge').map));
    const edge = Object.values(s.map.tiles).find(
      (t) => t.col === 0 && t.row > 0 && t.row < s.map.rows - 1,
    )!;
    s = mutate(s, (m) => {
      m.position = edge.id;
      m.visitedOutbound.push(edge.id);
      m.explored.push(edge.id);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(6);
  });

  it('角落格：显示当前 + 3 = 4 格', () => {
    let s = newGame('fc-area-corner', calmOverrides(newGame('fc-area-corner').map));
    // 右上角 (0, cols-1)
    const corner = `0:${s.map.cols - 1}`;
    s = mutate(s, (m) => {
      m.position = corner;
      m.visitedOutbound.push(corner);
      m.explored.push(corner);
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.cells.length).toBe(4);
  });

  it('只显示下一天：day = daysUsed + 1', () => {
    let s = newGame('fc-oneday', calmOverrides(newGame('fc-oneday').map));
    const legal = getLegalMoves(s);
    s = performMove(s, legal[0]);
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.lastForecast!.day).toBe(s.daysUsed + 1);
    // 单日：视图无“后天”信息
    expect(Object.keys(s.lastForecast!)).toEqual(['day', 'cells']);
  });

  it('预报不受战争迷雾限制：未知格显示坐标与天气，但不永久揭示地形', () => {
    let s = newGame('fc-fog', calmOverrides(newGame('fc-fog').map));
    // 城市角落只有 4 格视野；全部未探索（除城市与矿区）
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const unknownCells = s.lastForecast!.cells.filter((c) => !c.terrainKnown);
    expect(unknownCells.length).toBeGreaterThan(0);
    for (const c of unknownCells) {
      expect(s.explored).not.toContain(c.tileId);
      expect(s.intelKnown).not.toContain(c.tileId);
      // 天气仍然可见（合法推断）
      expect(typeof c.weather).toBe('string');
    }
  });
});

describe('天气预报：等待避灾配合', () => {
  it('停留决策依赖预报：预报显示当前格明天沙尘暴时，玩家可提前得知', () => {
    let s = newGame('fc-wait-storm');
    s = mutate(s, (m) => {
      m.tents = mkTents([3]); // 野外宿营需要帐篷
    });
    const legal = getLegalMoves(s);
    const target = legal[0];
    s = performMove(s, target);
    // 强制当前格为沙漠并覆盖明天为沙尘暴
    s = mutate(s, (m) => {
      m.map.tiles[target].terrain = 'DESERT';
      m.map.weather[target][m.daysUsed] = 'SANDSTORM'; // 明天（1-based 索引 = daysUsed）
    });
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    const cell = s.lastForecast!.cells.find((c) => c.isCurrent)!;
    expect(cell.weather).toBe('SANDSTORM');
    // 玩家此时可以选择宿营避雨——宿营当天将触发沙尘暴 Modal
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.pendingEvents[0]?.kind ?? '').toBe('SANDSTORM');
  });

  it('预报次数用尽后无法再查看', () => {
    let s = newGame('fc-empty', calmOverrides(newGame('fc-empty').map));
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    s = performAction(s, { type: 'USE_FORECAST' });
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(0);
    expect(() => performAction(s, { type: 'USE_FORECAST' })).toThrow(GameError);
  });

  it('矿区内也可以购买与使用预报（为返程做准备）', () => {
    let s = newGame('fc-mine');
    // 走到更近的矿区，减少路途中的时间消耗
    const mineA = s.map.mines[0].tileId;
    const mineB = s.map.mines[1].tileId;
    const len = (id: string) => bfsLen(s, id);
    const target = len(mineA) <= len(mineB) ? mineA : mineB;
    s = walkTo(s, target);
    expect(s.status).toBe('ONGOING');
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.forecastCharges).toBe(2);
    expect(s.lastForecast).not.toBeNull();
  });
});

/** 计算从当前位置到目标的 BFS 距离 */
function bfsLen(s: ReturnType<typeof newGame>, target: string): number {
  const p = bfsPath(s.map, s.position, target, [], (id) =>
    s.map.mines.every((m) => m.tileId !== id || id === target),
  );
  return p ? p.length : 999;
}

/* ------------------------------------------------------------------ */
/* v0.1.2b 追加：预报必须按真实地图方位排布（3×3 局部天气地图）            */
/* ------------------------------------------------------------------ */

/** 把预报视图按 (dr, dc) 渲染成 3×3 文本，用于断言"方位不能被补位带跑偏" */
function renderLocal(view: { cells: Array<{ row: number; col: number; dr: number; dc: number; isCurrent: boolean }> }): string {
  const at = new Map(view.cells.map((c) => [`${c.dr},${c.dc}`, c]));
  const lines: string[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    const cells: string[] = [];
    for (let dc = -1; dc <= 1; dc += 1) {
      const c = at.get(`${dr},${dc}`);
      cells.push(c ? `${c.row},${c.col}${c.isCurrent ? '*' : ''}` : '空');
    }
    lines.push(cells.join(' | '));
  }
  return lines.join('\n');
}

/** 把玩家放到指定 (row, col) 并生成预报视图 */
function forecastAt(seed: string, row: number, col: number) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  const id = `${row}:${col}`;
  s = mutate(s, (m) => {
    m.position = id;
    m.visitedOutbound.push(id);
    m.explored.push(id);
  });
  s = performAction(s, { type: 'BUY_FORECAST_PACK' });
  return s.lastForecast!;
}

describe('v0.1.2b 预报方位：按 (dr, dc) 映射到 3×3，绝不按数组顺序补位', () => {
  it('内部格：完整 3×3 九宫格，方位与地图一致', () => {
    const view = forecastAt('fc-dir-in', 3, 4);
    expect(renderLocal(view)).toBe(
      ['2,3 | 2,4 | 2,5', '3,3 | 3,4* | 3,5', '4,3 | 4,4 | 4,5'].join('\n'),
    );
  });

  it('左下角（玩家 (7,0)，即真人试玩截图中的位置）：只有 N / NE / C / E，且位置正确', () => {
    const view = forecastAt('fc-dir-bl', 7, 0);
    expect(renderLocal(view)).toBe(
      ['空 | 6,0 | 6,1', '空 | 7,0* | 7,1', '空 | 空 | 空'].join('\n'),
    );
  });

  it('左上角：只有 C / E / S / SE，不多不少', () => {
    const view = forecastAt('fc-dir-tl', 0, 0);
    expect(renderLocal(view)).toBe(
      ['空 | 空 | 空', '空 | 0,0* | 0,1', '空 | 1,0 | 1,1'].join('\n'),
    );
  });

  it('右下角：只有 NW / N / W / C', () => {
    const view = forecastAt('fc-dir-br', 7, 8);
    expect(renderLocal(view)).toBe(
      ['6,7 | 6,8 | 空', '7,7 | 7,8* | 空', '空 | 空 | 空'].join('\n'),
    );
  });

  it('右上角：只有 NW / N / W / C（缺 NE / E / S / SE）', () => {
    const view = forecastAt('fc-dir-tr', 0, 8);
    expect(renderLocal(view)).toBe(
      ['空 | 空 | 空', '0,7 | 0,8* | 空', '1,7 | 1,8 | 空'].join('\n'),
    );
  });

  it('上边缘（中间列）：2×3，缺整行北向', () => {
    const view = forecastAt('fc-dir-top', 0, 4);
    expect(renderLocal(view)).toBe(
      ['空 | 空 | 空', '0,3 | 0,4* | 0,5', '1,3 | 1,4 | 1,5'].join('\n'),
    );
  });

  it('下边缘（中间列）：2×3，缺整行南向', () => {
    const view = forecastAt('fc-dir-bottom', 7, 4);
    expect(renderLocal(view)).toBe(
      ['6,3 | 6,4 | 6,5', '7,3 | 7,4* | 7,5', '空 | 空 | 空'].join('\n'),
    );
  });

  it('左边缘（中间行）：3×2，缺整列西向', () => {
    const view = forecastAt('fc-dir-left', 3, 0);
    expect(renderLocal(view)).toBe(
      ['空 | 2,0 | 2,1', '空 | 3,0* | 3,1', '空 | 4,0 | 4,1'].join('\n'),
    );
  });

  it('右边缘（中间行）：3×2，缺整列东向', () => {
    const view = forecastAt('fc-dir-right', 3, 8);
    expect(renderLocal(view)).toBe(
      ['2,7 | 2,8 | 空', '3,7 | 3,8* | 空', '4,7 | 4,8 | 空'].join('\n'),
    );
  });

  it('所有位置的不变量：dr/dc 与实际坐标一致、无重复、无地图外格、恰好一个当前格', () => {
    const positions: Array<[number, number]> = [
      [0, 0],
      [0, 4],
      [0, 8],
      [3, 0],
      [3, 4],
      [3, 8],
      [7, 0],
      [7, 4],
      [7, 8],
    ];
    for (const [r, c] of positions) {
      const view = forecastAt(`fc-dir-inv-${r}-${c}`, r, c);
      const keys = view.cells.map((x) => `${x.dr},${x.dc}`);
      expect(new Set(keys).size).toBe(keys.length); // 无重复方位
      expect(new Set(view.cells.map((x) => x.tileId)).size).toBe(view.cells.length); // 无重复格
      for (const cell of view.cells) {
        expect(cell.row).toBe(r + cell.dr);
        expect(cell.col).toBe(c + cell.dc);
        expect(cell.tileId).toBe(`${cell.row}:${cell.col}`);
        expect(Math.abs(cell.dr)).toBeLessThanOrEqual(1);
        expect(Math.abs(cell.dc)).toBeLessThanOrEqual(1);
        // 地图外格绝不下发
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(8);
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(9);
        // UI 放置用 1..3 的行列号，必须合法
        expect(cell.dr + 2).toBeGreaterThanOrEqual(1);
        expect(cell.dr + 2).toBeLessThanOrEqual(3);
        expect(cell.dc + 2).toBeGreaterThanOrEqual(1);
        expect(cell.dc + 2).toBeLessThanOrEqual(3);
      }
      const current = view.cells.filter((x) => x.isCurrent);
      expect(current).toHaveLength(1);
      expect(current[0].dr).toBe(0);
      expect(current[0].dc).toBe(0);
      // 恰好等于"图内方向"的交集：不能多，也不能少（少了就是被裁掉了）
      const rows = 8;
      const cols = 9;
      const validDr = (r > 0 ? 1 : 0) + 1 + (r < rows - 1 ? 1 : 0);
      const validDc = (c > 0 ? 1 : 0) + 1 + (c < cols - 1 ? 1 : 0);
      expect(view.cells.length).toBe(validDr * validDc);
      // 缺的方向必须恰好是"越界方向"，一个不多一个不少
      const present = new Set(keys);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const inBounds = r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols;
          expect(present.has(`${dr},${dc}`)).toBe(inBounds);
        }
      }
    }
  });

  it('预报不会永久揭示未知地形（方位修复不影响迷雾）', () => {
    const view = forecastAt('fc-dir-fog', 7, 0);
    expect(view.cells.some((c) => !c.terrainKnown)).toBe(true);
  });
});
