import { gameConfig } from '../config/gameConfig';
import { hashSeed, nextRandom } from '../random/rng';

/**
 * 采矿规则（Autonomous Mechanism Evolution Lab）。
 *
 * 本文件把「单个采矿日」的全部产量/事故规则收敛到一处，供引擎调用。
 * 三个机制全部由 `gameConfig.mechanisms.*.enabled` 控制，默认关闭，
 * 关闭时行为与落盘前**逐位一致**（产量恒为 gemPerMiningDay、事故恒为 0）。
 */

/** 第 1 个采矿日 = 1（1-based），与 state.stats.miningDays + 1 对齐 */
export function yieldForMiningDay(dayIndex: number, slot?: 'A' | 'B'): number {
  const base = baseYieldForMiningDay(dayIndex);
  return Math.round(base * productivityScale(slot) * 100) / 100;
}

/** 矿区生产力倍率（Candidate Family B；机制关闭或未提供 slot 时恒为 1） */
export function productivityScale(slot?: 'A' | 'B'): number {
  const cfg = gameConfig.mechanisms.mineProductivity;
  if (!cfg.enabled || !slot) return 1;
  return slot === 'A' ? cfg.scaleA : cfg.scaleB;
}

function baseYieldForMiningDay(dayIndex: number): number {
  const cfg = gameConfig.mechanisms.diminishingYield;
  if (!cfg.enabled) return gameConfig.gemPerMiningDay;
  if (dayIndex < 1) dayIndex = 1;
  if (cfg.mode === 'smooth') {
    const v = cfg.smoothBase * Math.pow(cfg.smoothDecay, dayIndex - 1);
    return Math.round(Math.max(cfg.smoothFloor, v) * 100) / 100;
  }
  // tier：线性扫描分段
  let idx = 0;
  for (let i = 0; i < cfg.tierStarts.length; i++) {
    if (dayIndex >= cfg.tierStarts[i]) idx = i + 1;
  }
  const y = cfg.tierYields[Math.min(idx, cfg.tierYields.length - 1)];
  return y;
}

/** 第 n 个采矿日当天发生事故的概率（机制关闭时恒为 0） */
export function accidentChanceForMiningDay(dayIndex: number): number {
  const cfg = gameConfig.mechanisms.accidentRisk;
  if (!cfg.enabled) return 0;
  if (dayIndex < 1) dayIndex = 1;
  const p = cfg.baseChance + (dayIndex - 1) * cfg.growthPerDay;
  return Math.min(cfg.capChance, Math.max(0, p));
}

/**
 * 确定性事故掷骰。
 *
 * 引擎的 `state.rngState` 自 v0.1.2 起在运行期不再被消耗（地图生成阶段一次性用掉），
 * 为了让「同一 Seed + 同一决策序列」永远得到同一结果，事故掷骰不使用状态 RNG，
 * 而是从 `seed + 采矿日 + 第几个采矿日` 派生独立随机流。
 * 这样：读档 / 重放 / 配对比较全部保持确定性，也不会污染任何既有随机序列。
 */
export function rollMiningAccident(seed: string, daysUsed: number, miningDayIndex: number): boolean {
  const p = accidentChanceForMiningDay(miningDayIndex);
  if (p <= 0) return false;
  const state = hashSeed(`${seed}|mine-accident|d${daysUsed}|n${miningDayIndex}`);
  const [v] = nextRandom(state);
  return v < p;
}

/**
 * 单格沙漠的额外天数（Candidate Family D 重设计；机制关闭或未超阈值时为 0）。
 *
 * 公式（全文只有这一条）：
 *   gemsKg <  thresholdKg            → 0
 *   否则                              → min(maxExtraPerDesertTile,
 *                                          1 + floor((gemsKg - thresholdKg) / stepKg))
 *
 * 为什么必须"分级"而不是"一刀切阈值"：
 *   一刀切（超阈值就恒定 +1）会让「丢货」变成全有或全无的巨额决策
 *   （必须一口气丢掉十几 kg 才有效），实测 dropRate = 0% —— 按钮变成死按钮。
 *   分级之后每多背 stepKg 就多 1 天，丢弃一小步就能立刻换回 1 天/格沙漠，
 *   边际权衡才真正存在。
 */
export function desertExtraDaysForLoad(gemsKg: number): number {
  const cfg = gameConfig.mechanisms.loadReturn;
  if (!cfg.enabled) return 0;
  if (gemsKg < cfg.thresholdKg) return 0;
  const steps = 1 + Math.floor((gemsKg - cfg.thresholdKg) / cfg.stepKg);
  return Math.min(cfg.maxExtraPerDesertTile, steps);
}

/** 返程负重惩罚：本次移动额外消耗的天数 */
export function returnMoveExtraDays(terrain: string, gemsKg: number): number {
  if (terrain !== 'DESERT') return 0;
  return desertExtraDaysForLoad(gemsKg);
}

/** 是否处于「负重惩罚生效」状态（供 UI / Bot 判断） */
export function isOverloaded(gemsKg: number): boolean {
  const cfg = gameConfig.mechanisms.loadReturn;
  if (!cfg.enabled) return false;
  return gemsKg >= cfg.thresholdKg;
}

/** 丢到「刚好不再超载」需要丢掉的 kg（按 dropStepKg 向上取整；已减负则为 0） */
export function dropToRelieveKg(gemsKg: number): number {
  const cfg = gameConfig.mechanisms.loadReturn;
  if (!cfg.enabled || !cfg.allowDrop) return 0;
  if (gemsKg < cfg.thresholdKg) return 0;
  const target = cfg.thresholdKg - cfg.dropStepKg; // 必须严格低于阈值
  const need = gemsKg - Math.max(0, target);
  const step = cfg.dropStepKg;
  return Math.min(gemsKg, Math.ceil(need / step) * step);
}
