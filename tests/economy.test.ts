import { describe, it, expect } from 'vitest';
import { computeGemPrice, generateWorld } from '../src/game/map/generate';
import { computeSettlement, performAction } from '../src/game';
import { gameConfig } from '../src/game/config/gameConfig';
import { runOne } from '../src/simulation/runner';
import { BOT_BY_NAME } from '../src/simulation/bots';
import { newGame, calmOverrides, mutate, mkTents, mineTile, walkTo } from './helpers';

/**
 * v0.1.2b 宝石经济回归（Human Playtest Fix Round 1）。
 *
 * 三条必须同时成立的性质：
 *  §7 合理成功远征具备明确正收益预期；
 *  §6 不合理玩法（只挖 1 天 / 不买装备 / 乱囤装备）仍然允许亏损 —— 绝无全局保底；
 *  §8 价格只由矿区客观危险程度决定，玩家实际路线无法刷价。
 */

const cfg = gameConfig.mineValuation;

/** 走到矿区 → 挖 N 天 → 直接返城，返回终局状态 */
function runExpedition(seed: string, miningDays: number, setup: (s: ReturnType<typeof newGame>) => void) {
  let s = newGame(seed, calmOverrides(newGame(seed).map));
  const mine = mineTile(s, 'A');
  s = mutate(s, setup);
  s = walkTo(s, mine);
  expect(s.phase).toBe('MINING');
  for (let i = 0; i < miningDays; i++) s = performAction(s, { type: 'MINE' });
  s = performAction(s, { type: 'START_RETURN' });
  s = walkTo(s, s.map.cityId);
  return s;
}

describe('§8 定价只由客观难度决定', () => {
  it('单价函数不接收任何玩家行为入参（纯函数）', () => {
    expect(computeGemPrice.length).toBeLessThanOrEqual(3);
    expect(computeGemPrice(40, 1)).toBe(computeGemPrice(40, 1));
  });

  it('玩家受伤 / 烧帐篷 / 绕路返回，都不会改变该矿区的成交单价', () => {
    const seed = 'econ-noflush';
    const map = generateWorld(seed);
    const mineA = map.mines.find((m) => m.slot === 'A')!;
    const s = runExpedition(seed, 1, (m) => {
      m.tents = mkTents([3, 3]);
      m.compasses = 1;
    });
    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.mineSlot).toBe('A');
    // 鉴定价 == 开局地图评估价（玩家行为无法抬价）
    expect(v.gemPrice).toBe(mineA.gemPrice);
    expect(generateWorld(seed).mines.map((m) => m.gemPrice)).toEqual(map.mines.map((m) => m.gemPrice));
  });
});

describe('§6 不合理玩法仍然可以亏损（不存在人工保底）', () => {
  it('只挖 1 天：2kg 收入无法覆盖常规装备支出', () => {
    const s = runExpedition('econ-1day', 1, (m) => {
      m.cash -= 900; // 常规装备：2 顶帐篷 + 1 只指南针
      m.equipmentSpent += 900;
      m.tents = mkTents([3, 3]);
      m.compasses = 1;
    });
    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.gemsKg).toBe(gameConfig.gemPerMiningDay);
    expect(v.gemRevenue).toBeLessThan(900);
    expect(v.netProfit).toBeLessThan(0);
  });

  it('全局无保底：把本金全砸在无用装备上、只挖 1 天 → 明确亏损', () => {
    const s = runExpedition('econ-noguarantee', 1, (m) => {
      m.cash = 0; // 2000 元全部买了 5 顶帐篷，一分钱不剩
      m.equipmentSpent = 2000;
      m.tents = mkTents([3, 3, 3, 3, 3]);
    });
    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.netProfit).toBeLessThan(-1200);
  });

  it('合理挖矿天数下，装备越奢侈净收益越低（支出没有被“保底”抹平）', () => {
    const lean = computeSettlement(
      runExpedition('econ-lux', 6, (m) => {
        m.tents = mkTents([3]);
        m.cash -= 400;
        m.equipmentSpent += 400;
      }),
    );
    const lavish = computeSettlement(
      runExpedition('econ-lux', 6, (m) => {
        m.cash -= 1800;
        m.equipmentSpent += 1800;
        m.tents = mkTents([3, 3, 3, 3]);
        m.compasses = 2;
      }),
    );
    expect(lean.netProfit).toBeGreaterThan(lavish.netProfit);
    expect(lean.netProfit - lavish.netProfit).toBeCloseTo(1400, 0);
  });

  it('失败局宝石无法出售 → 亏损', () => {
    const bot = BOT_BY_NAME['GreedyMinerBot'];
    let defeats = 0;
    for (let i = 0; i < 40; i++) {
      const r = runOne(bot, 'econ-fail-' + i);
      if (r.error) continue;
      if (r.status === 'DEFEAT') {
        defeats += 1;
        expect(r.gemRevenue).toBe(0);
        expect(r.netProfit).toBeLessThan(0);
      }
    }
    expect(defeats).toBeGreaterThan(0); // 冒险玩法确实会失败并亏损
  }, 120_000);
});

describe('§7 合理成功远征有明确正收益预期（v0.3.0 已重写：不再要求"几乎全部盈利"）', () => {
  /**
   * v0.3.0 之前这条断言是「成功局 >90% 盈利」——那正是本轮要解决的 P0 问题
   * （ProfitAmongCompleted ≈ 99.83%，生还与赚钱高度绑定）。
   * 落盘「远征运营成本 + 延期求援债务」之后，成功局**应该**出现相当比例的亏损。
   * 因此这里改为断言**新的健康结构**：
   *   - 成功局盈利占比落在 50~80%（既不是 100% 绑定，也不是普遍亏本）；
   *   - 中位净收益仍明显为正（能规划好的玩家赚得到钱）；
   *   - 确实存在"活着回来却亏了"的局（§5 SURVIVED_UNPROFITABLE 必须真实存在）。
   */
  it('成功局不再几乎全部盈利：出现真实的"成功但亏损"分层', () => {
    const bot = BOT_BY_NAME['ReasonablePlayerBot'];
    const runs = Array.from({ length: 40 }, (_, i) => `econ-reasonable:probe:${i}`)
      .map((seed) => runOne(bot, seed))
      .filter((r) => !r.error);
    const wins = runs.filter((r) => r.status === 'VICTORY');
    expect(wins.length).toBeGreaterThan(20); // 该策略胜率应当很高

    const profits = wins.map((r) => r.netProfit).sort((a, b) => a - b);
    const profitableShare = profits.filter((v) => v > 0).length / profits.length;
    // 生还与赚钱必须解耦：既不能 100% 绑定，也不能普遍亏本
    expect(profitableShare).toBeGreaterThan(0.45);
    expect(profitableShare).toBeLessThan(0.85);
    // 「成功返城但亏损」这一层必须真实存在
    expect(profits.filter((v) => v <= 0).length).toBeGreaterThan(0);
    const median = profits[Math.floor(profits.length / 2)];
    expect(median).toBeGreaterThan(300); // 中位净收益仍为正（能规划好就赚得到）

    const avgRevenue = wins.reduce((a, r) => a + r.gemRevenue, 0) / wins.length;
    const avgSpend = wins.reduce((a, r) => a + r.equipmentSpent, 0) / wins.length;
    expect(avgRevenue).toBeGreaterThan(avgSpend * 2);
  }, 180_000);

  it('新标定下 2000 张地图的单价不再挤在下限（旧配置 39.5% 触底）', () => {
    let atFloor = 0;
    let atCeil = 0;
    let n = 0;
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const m = generateWorld('econ-floor-' + i);
      for (const mine of m.mines) {
        n += 1;
        sum += mine.gemPrice;
        if (mine.gemPrice === cfg.clampMin) atFloor += 1;
        if (mine.gemPrice === cfg.clampMax) atCeil += 1;
      }
    }
    expect(sum / n).toBeGreaterThan(150); // 旧配置平均只有 ~100
    expect(atFloor / n).toBeLessThan(0.05); // 旧配置 39.5%
    expect(atCeil / n).toBeLessThan(0.05);
  }, 180_000);
});
