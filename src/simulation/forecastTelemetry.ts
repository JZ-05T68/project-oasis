import type { FairView } from './fairView';
import type { TileId, WeatherType } from '../game/types';
import { gameConfig } from '../game/config/gameConfig';

/**
 * 天气预报专项遥测（v0.1.3 现金计价）。
 *
 * 两个关键区分（本实验的核心指标）：
 *
 *  1. **有效预报（Decision-Useful Forecast）**
 *     玩家看了预报之后**真的改了行动**——改走别的格子、或因为当前格明天恶劣而原地停留。
 *  2. **仅供参考（Informational Only）**
 *     看了预报但执行原计划（移动目标与「无预报时会走的格子」一致）。
 *
 * 「无预报时会走的格子」由 Bot 的 `blindMove()` 给出（把 lastForecast 置空后重放同一决策骨架），
 * 因为预报只通过两条路径影响决策：路线权重与「当前格恶劣→停留」。其余分支与预报无关，
 * 所以这个对照是精确的，而不是拍脑袋的启发式。
 *
 * 另外提供一组**明确标注为估计值**的避免伤害量（`*Estimate`）：
 * 它们是「如果走了那个格子、按规则会付出什么代价」的上界估计，
 * 不考虑玩家当时是否真的会消耗对应资源。聚合报告中与
 * 「ForecastBot vs NoForecastBot 的实际 weatherHits / tentUses / endStamina 差异」交叉验证。
 */
export interface ForecastAccumulator {
  /** 购买包数 / 花掉的钱 / 发放与消耗的次数 */
  packsPurchased: number;
  moneySpent: number;
  chargesGranted: number;
  chargesUsed: number;
  chargesUnused: number;
  /** 出现过「有效预报窗口」（预报锚定明天）的回合数 */
  forecastWindowTurns: number;
  /** 有效预报出现时、本回合确实要做移动决策的次数（Decision 分母） */
  decisionOpportunities: number;
  /** 因预报改了行动：移动目标变化 或 因当前格明天恶劣而停留 */
  decisionUseful: number;
  /** 看了预报但执行原计划 */
  informationalOnly: number;
  /** 有效预报窗口内，可走邻格中存在「明天恶劣」的格子数（机会数） */
  severeOptionsSeen: number;
  /** 明知明天恶劣还是走了进去（预报被无视） */
  severeEntered: number;
  /** 存在恶劣选项但最终选了安全格（避免成功） */
  severeAvoided: number;
  /* --- 以下全部是 Estimate（估计值） --- */
  staminaLossAvoidedEstimate: number;
  daysLostAvoidedEstimate: number;
  tentDurabilitySavedEstimate: number;
  tentsDestroyedAvoidedEstimate: number;
  compassUsesAvoidedEstimate: number;
}

export function emptyForecastAcc(): ForecastAccumulator {
  return {
    packsPurchased: 0,
    moneySpent: 0,
    chargesGranted: 0,
    chargesUsed: 0,
    chargesUnused: 0,
    forecastWindowTurns: 0,
    decisionOpportunities: 0,
    decisionUseful: 0,
    informationalOnly: 0,
    severeOptionsSeen: 0,
    severeEntered: 0,
    severeAvoided: 0,
    staminaLossAvoidedEstimate: 0,
    daysLostAvoidedEstimate: 0,
    tentDurabilitySavedEstimate: 0,
    tentsDestroyedAvoidedEstimate: 0,
    compassUsesAvoidedEstimate: 0,
  };
}

export function isSevereWeather(w: WeatherType | string): boolean {
  return w === 'SANDSTORM' || w === 'RAINSTORM' || w === 'MUD';
}

/** 有效预报窗口：预报锚定「明天」且尚未过期 */
export function hasActiveForecast(view: FairView): boolean {
  return !!view.lastForecast && view.lastForecast.day === view.day + 1;
}

/** 预报窗口内某格明天的天气（无窗口/不在窗口内返回 null） */
export function forecastWeatherOf(view: FairView, tileId: TileId): WeatherType | null {
  if (!hasActiveForecast(view)) return null;
  const cell = view.lastForecast!.cells.find((c) => c.tileId === tileId);
  return cell ? cell.weather : null;
}

/** 可走邻格中「明天恶劣」的格子 */
export function severeOptions(view: FairView): TileId[] {
  if (!hasActiveForecast(view)) return [];
  return view.legalMoves.filter((id) => {
    const w = forecastWeatherOf(view, id);
    return !!w && isSevereWeather(w);
  });
}

/**
 * 记录一次「因为预报而避开恶劣格」的收益估计。
 * 用预报给出的天气反推玩家当时需要付出的代价（天气类型本身就隐含了地形）。
 */
export function recordAvoidance(acc: ForecastAccumulator, view: FairView, tileId: TileId): void {
  const w = forecastWeatherOf(view, tileId);
  if (!w || !isSevereWeather(w)) return;
  const hasTent = view.tents.length > 0;
  const hasCompass = view.compasses > 0;
  switch (w) {
    case 'SANDSTORM':
      // 沙漠沙尘暴：帐篷可挡，指南针可避免额外迷路 1 天
      if (hasTent) {
        acc.tentDurabilitySavedEstimate += 1;
        if (!hasCompass) acc.daysLostAvoidedEstimate += 1;
      } else if (hasCompass) {
        acc.compassUsesAvoidedEstimate += 1;
        acc.staminaLossAvoidedEstimate += gameConfig.weather.sandstorm.staminaCost;
      } else {
        acc.staminaLossAvoidedEstimate += gameConfig.weather.sandstorm.staminaCost;
        acc.daysLostAvoidedEstimate += 1;
      }
      break;
    case 'RAINSTORM':
      // 草地暴雨：有帐篷则整顶帐篷报废（代价最高），无帐篷则硬扛耐力 -2
      if (hasTent) {
        acc.tentsDestroyedAvoidedEstimate += 1;
        acc.tentDurabilitySavedEstimate += 1;
      } else {
        acc.staminaLossAvoidedEstimate += gameConfig.weather.grassRain.staminaLossWithoutTent;
      }
      break;
    case 'MUD':
      // 泥沼：白白耗掉一整天
      acc.daysLostAvoidedEstimate += 1;
      break;
    default:
      break;
  }
}

/** 记录「明知恶劣仍进入」的一次（用于计算预报被真正采纳的比例） */
export function recordEntry(acc: ForecastAccumulator, view: FairView, tileId: TileId): void {
  const w = forecastWeatherOf(view, tileId);
  if (w && isSevereWeather(w)) acc.severeEntered += 1;
}
