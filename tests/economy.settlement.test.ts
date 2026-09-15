import { describe, it, expect } from 'vitest';
import { computeSettlement, performAction } from '../src/game';
import { gameConfig } from '../src/game/config/gameConfig';
import { newGame, calmOverrides, walkTo, mutate, nearestMineTile, act } from './helpers';
import {
  operatingCost,
  lateSaleLossOf,
  rescueSettlementFee,
} from '../src/game/rules/settlement';
import { rescueImmediateCost } from '../src/game/rules/outcome';
import { runBatchSeeds } from '../src/simulation/runner';
import { econBot } from '../src/simulation/bots/econBots';

/**
 * v0.3.0 Economic Independence Lab —— 经济结算层回归闸门。
 *
 * 这里只测**正式代码路径**（src/game/rules/settlement.ts），不测实验脚本。
 * 机制默认全部关闭，因此本文件的断言同时充当「默认关闭时行为与 v0.2.0 逐元一致」的闸门。
 */

describe('v0.3.0 经济结算：正式落盘状态（Promotion 后）', () => {
  it('落盘了 2 个机制：延期求援 + 远征运营成本；另 2 个候选保持关闭', () => {
    expect(gameConfig.mechanisms.rescueSettlement.enabled).toBe(true);
    expect(gameConfig.mechanisms.upkeep.enabled).toBe(true);
    // 未通过 Gate 的候选：代码留在引擎里，但默认不生效
    expect(gameConfig.mechanisms.tradeCost.enabled).toBe(false);
    expect(gameConfig.mechanisms.lateSale.enabled).toBe(false);
  });

  it('逾期折价候选保持关闭（代码在，默认不生效）', () => {
    const s = newGame('econ-late', calmOverrides(newGame('econ-late').map));
    expect(gameConfig.mechanisms.lateSale.enabled).toBe(false);
    expect(lateSaleLossOf(mutate(s, (x) => { x.daysUsed = 41; }), 5000, true)).toBe(0);
  });

  it('延期求援：当场 0 元，回城结算时偿还 2800 元债务', () => {
    expect(rescueImmediateCost()).toBe(0);
    expect(gameConfig.mechanisms.rescueSettlement.deferredDebt).toBe(2800);
    // 债务只对「求援过且成功返城」的局生效（§36：失败局宝石归零，债务不成立）
    expect(rescueSettlementFee(5000, true, false).total).toBe(0);
    expect(rescueSettlementFee(5000, false, true).total).toBe(0);
    expect(rescueSettlementFee(5000, true, true).total).toBe(2800);
  });

  it('远征运营成本：前 22 天免费，之后每天 160 元，且只在成功返城后结算', () => {
    const s = newGame('econ-upkeep', calmOverrides(newGame('econ-upkeep').map));
    const withDays = (d: number, victory: boolean) =>
      mutate(s, (x) => {
        x.daysUsed = d;
      }) && operatingCost(mutate(s, (x) => { x.daysUsed = d; }), victory);
    expect(withDays(10, true)).toBe(0);
    expect(withDays(22, true)).toBe(0);
    expect(withDays(23, true)).toBe(160);
    expect(withDays(32, true)).toBe(1600);
    // 失败局不计运营费（§36）
    expect(withDays(32, false)).toBe(0);
  });

  it('落盘后的结算仍然逐元可对账：finalCash = 现金 + 宝石净收入 − 结算期费用', () => {
    let s = newGame('econ-formula', calmOverrides(newGame('econ-formula').map));
    const mine = nearestMineTile(s);
    s = walkTo(s, mine.tileId);
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'START_RETURN' });
    s = walkTo(s, s.map.cityId);
    expect(s.status).toBe('VICTORY');
    const v = computeSettlement(s);
    expect(v.settlementExpenses).toBe(v.operatingCost);
    expect(v.finalAssets).toBe(s.cash + v.gemRevenue - v.settlementExpenses);
    expect(v.finalCash).toBe(v.finalAssets);
    expect(v.grossGemRevenue).toBe(v.gemRevenue);
    expect(v.accountingOk).toBe(true);
    expect(v.accountingResidual).toBe(0);
  });
});

describe('v0.3.0 会计恒等式（§35）', () => {
  it('每一局都能逐元对账：finalCash = 初始资金 + 途中现金变动 + 毛收入 − 逾期折价 − 结算费用', () => {
    const bot = econBot('EconMasterBot')!;
    const seeds = Array.from({ length: 60 }, (_, i) => `econ-accounting:${i}`);
    const rs = runBatchSeeds(bot, seeds);
    expect(rs.length).toBe(60);
    for (const r of rs) {
      expect(r.error).toBeNull();
      const identity =
        2000 +
        (r.tripCashFlow ?? 0) +
        (r.grossGemRevenue ?? 0) -
        (r.lateSaleLoss ?? 0) -
        (r.settlementExpenses ?? 0);
      expect(r.accountingOk).toBe(true);
      expect(r.accountingResidual).toBe(0);
      expect(r.finalCash).toBe(identity);
      // 任何一笔钱都不能凭空出现或消失
      expect(r.settlementExpenses ?? 0).toBeGreaterThanOrEqual(0);
      expect(r.grossGemRevenue ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('失败局按 §36 处理：宝石收入为 0，且不再叠加运营/交易费用', () => {
    const bot = econBot('EconMasterBot')!;
    const seeds = Array.from({ length: 60 }, (_, i) => `econ-accounting:${i}`);
    const rs = runBatchSeeds(bot, seeds).filter((r) => r.status === 'DEFEAT');
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) {
      expect(r.grossGemRevenue).toBe(0);
      expect(r.gemRevenue).toBe(0);
      expect(r.netProfit).toBeLessThan(2000); // 失败必然亏（现金不可能超过初始+打工收益）
    }
  });
});

describe('v0.3.0 紧急求援：extraDays 的语义是「延长时限」而不是「倒扣天数」', () => {
  /**
   * 这是一条**回归闸门**：v0.2.0 里引擎调用的是 addDays(s, extraDays)，
   * 而 addDays 推进的是**已用天数**，于是「求援换回 5 天」被实际执行成「倒扣 5 天」，
   * 与 UI 文案、规则页、Bot 判据三方全部相反。本轮修正为 s.maxDays += extraDays。
   */
  it('求援后 maxDays 增加 extraDays，daysUsed 不受影响', () => {
    let s = newGame('econ-rescue', calmOverrides(newGame('econ-rescue').map));
    const mine = nearestMineTile(s);
    s = walkTo(s, mine.tileId);
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'START_RETURN' });

    // 构造「时间真的不够」的绝境：把已用天数推到接近上限
    s = mutate(s, (x) => {
      x.daysUsed = x.maxDays - 1;
      x.cash = 2000;
    });
    const before = { maxDays: s.maxDays, daysUsed: s.daysUsed, cash: s.cash };
    s = performAction(s, { type: 'EMERGENCY_RESCUE' });

    const cfg = gameConfig.mechanisms.emergencyRescue;
    expect(s.stats.emergencyRescues).toBe(1);
    expect(s.maxDays).toBe(before.maxDays + cfg.extraDays);
    expect(s.daysUsed).toBe(before.daysUsed); // 不消耗已用天数
    expect(s.cash).toBe(before.cash - rescueImmediateCost()); // v0.3.0 延期：当场 0 元
    expect(s.stats.emergencyRescueCost).toBe(rescueImmediateCost());
  });

  it('求援费用在结算页里单列，且没有任何一笔钱说不清', () => {
    let s = newGame('econ-rescue2', calmOverrides(newGame('econ-rescue2').map));
    const mine = nearestMineTile(s);
    s = walkTo(s, mine.tileId);
    s = act(s, { type: 'MINE' });
    s = act(s, { type: 'START_RETURN' });
    s = mutate(s, (x) => {
      x.daysUsed = x.maxDays - 1;
      x.cash = 2000;
    });
    s = performAction(s, { type: 'EMERGENCY_RESCUE' });
    const v = computeSettlement(s);
    expect(v.rescueImmediateSpend).toBe(0); // 延期求援：当场不收钱
    // 还没回到城 ⇒ 债务尚未到期（债务只在成功返城结算时成立，§36）
    expect(v.rescueSettlement).toBe(0);
    expect(v.accountingOk).toBe(true);
    expect(v.netProfit).toBe(v.finalCash - 2000);
  });
});

describe('v0.3.0 盈利判定口径锁定（§5）', () => {
  it('盈亏只由 finalCash > initialCash(2000) 决定，不存在任何虚拟残值', () => {
    const bot = econBot('EconMasterBot')!;
    const seeds = Array.from({ length: 60 }, (_, i) => `econ-accounting:${i}`);
    const rs = runBatchSeeds(bot, seeds);
    for (const r of rs) {
      const profitable = (r.finalCash ?? r.finalAssets) > 2000;
      expect(profitable).toBe(r.netProfit > 0);
      // 剩余帐篷 / 指南针不计价
      expect(r.netProfit).toBe((r.finalCash ?? r.finalAssets) - 2000);
    }
  });
});
