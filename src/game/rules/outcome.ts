import { gameConfig } from '../config/gameConfig';
import { gridNeighbors, isNormalTile, manhattan } from '../map/grid';
import type { GameMap, GameState, TileId } from '../types';
import { isTerrainKnown } from './reveal';

/**
 * v0.2.0 Outcome & Mechanism Expansion Lab —— 四个新机制族的纯规则层。
 *
 * 与 `mining.ts` 同构：**全部由 `gameConfig.mechanisms.*.enabled` 控制且默认关闭**，
 * 关闭时行为与落盘前逐位一致。实验用 `OASIS_CONFIG_OVERRIDE` 打开，
 * 落盘 = 把默认值改成 true，回滚 = 改回 false。
 *
 * 四个族：
 *   E returnIntel     返程有限情报     —— 让「按地形选路」第一次有信息可用
 *   F villageService  村庄服务         —— 安全与经济交换节点（不得变成必停点）
 *   G surgeMining     矿区第二层决策   —— 一次性「深层采矿」机会
 *   H emergencyRescue 应急补救         —— 付出大代价把远征救回来
 */

/* ------------------------------------------------------------------ */
/* E. 返程有限情报                                                      */
/* ------------------------------------------------------------------ */

/** 朝城市方向的候选格（用于 returnCone：只揭示「返程起手那几步」） */
export function returnConeCandidates(map: GameMap, from: TileId, k: number): TileId[] {
  const city = map.cityId;
  const d0 = manhattan(from, city);
  // 只保留「朝城市方向缩短距离」的邻居，按缩短量降序；不足 k 个则用等高邻居补齐
  const scored = gridNeighbors(map, from)
    .filter((nb) => isNormalTile(map, nb))
    .map((nb) => ({ id: nb, gain: d0 - manhattan(nb, city) }))
    .sort((a, b) => b.gain - a.gain || a.id.localeCompare(b.id));
  const improving = scored.filter((s) => s.gain > 0);
  const pool = improving.length >= k ? improving : [...improving, ...scored.filter((s) => s.gain === 0)];
  return pool.slice(0, Math.max(0, k)).map((s) => s.id);
}

/**
 * returnCone 揭示：抵达矿区时，揭示「返程方向」的 k 个候选格。
 * 刻意只揭示这几格——不是全图揭露，而是刚好够做第一次路线取舍。
 */
export function revealReturnCone(state: GameState, from: TileId, k: number): TileId[] {
  const out: TileId[] = [];
  for (const id of returnConeCandidates(state.map, from, k)) {
    if (isTerrainKnown(state, id)) continue;
    state.intelKnown.push(id);
    out.push(id);
  }
  return out;
}

/**
 * survey1 揭示：矿区周围 radius 格（与上一轮 M13 一致，作为对照档保留）。
 */
export function revealSurveyRing(state: GameState, from: TileId, radius: number): TileId[] {
  const out: TileId[] = [];
  for (const id of Object.keys(state.map.tiles)) {
    if (manhattan(from, id) > radius) continue;
    if (!isNormalTile(state.map, id)) continue;
    if (isTerrainKnown(state, id)) continue;
    state.intelKnown.push(id);
    out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * 抵达矿区时按机制档位揭示返程情报。返回揭示的格数（0 = 无）。
 * mode='compass' 时不做自动揭示——那是一个需要玩家主动花的资源。
 */
export function applyArrivalIntel(state: GameState, from: TileId): number {
  const cfg = gameConfig.mechanisms.returnIntel;
  if (!cfg.enabled) return 0;
  if (cfg.mode === 'survey1') return revealSurveyRing(state, from, 1).length;
  if (cfg.mode === 'returnCone') return revealReturnCone(state, from, cfg.coneCandidates).length;
  // compass 模式：抵达时不白送，玩家需要花指南针主动侦察
  return 0;
}

/**
 * compass 模式：侦察前方（曼哈顿半径内的未知普通格）。
 * 返回揭示的格数；-1 表示本次未被允许（指南针不足 / 阶段不允许）。
 */
export function canScout(state: GameState): boolean {
  const cfg = gameConfig.mechanisms.returnIntel;
  if (!cfg.enabled || cfg.mode !== 'compass') return false;
  if (!cfg.allowScoutDuringReturn && state.phase === 'RETURN') return false;
  if (state.phase !== 'RETURN' && state.phase !== 'MINING' && state.phase !== 'OUTBOUND') return false;
  return state.compasses >= cfg.compassCostPerScout;
}

export function scoutAhead(state: GameState): number {
  if (!canScout(state)) return -1;
  const cfg = gameConfig.mechanisms.returnIntel;
  const revealed = revealSurveyRing(state, state.position, cfg.scoutRadius);
  state.compasses -= cfg.compassCostPerScout;
  return revealed.length;
}

/* ------------------------------------------------------------------ */
/* F. 村庄服务                                                          */
/* ------------------------------------------------------------------ */

export interface VillageServiceOption {
  kind: 'REST' | 'INTEL' | 'SELL';
  /** 现金成本 */
  cost: number;
  /** 时间成本（天） */
  days: number;
  /** 依据配置是否可用 */
  enabled: boolean;
  /** 玩家可读的一句话说明 */
  label: string;
}

/** 村庄当前提供的服务列表（未启用机制时返回空数组） */
export function villageServices(state: GameState): VillageServiceOption[] {
  const cfg = gameConfig.mechanisms.villageService;
  if (!cfg.enabled) return [];
  const out: VillageServiceOption[] = [];
  const full = state.stamina >= gameConfig.maxStamina;

  out.push({
    kind: 'REST',
    cost: cfg.restCostPerStamina,
    days: cfg.restCostsDay ? 1 : 0,
    enabled: !full,
    label: `花钱恢复 1 点耐力（${cfg.restCostPerStamina} 元${cfg.restCostsDay ? ' + 1 天' : ''}）`,
  });
  out.push({
    kind: 'INTEL',
    cost: cfg.intelPrice,
    days: 0,
    enabled: true,
    label: `购买返程情报（${cfg.intelPrice} 元，揭示 ${cfg.intelTiles} 格）`,
  });
  if (cfg.sellEnabled) {
    out.push({
      kind: 'SELL',
      cost: 0,
      days: 0,
      enabled: state.gemsKg > 0,
      label: `卖出 ${cfg.sellStepKg}kg 宝石减负（单价的 ${Math.round(cfg.sellPriceRatio * 100)}%，远低于回城鉴定价）`,
    });
  }
  return out;
}

/**
 * 村庄卖价：刻意低于回城鉴定价，因此它是「减负止损」而不是「更优变现」。
 * 矿区未知价时（未成功返城过的矿）用一个保守兜底单价估计。
 */
export function villageSellUnitPrice(state: GameState): number {
  const cfg = gameConfig.mechanisms.villageService;
  const mine = state.mineEntranceId
    ? state.map.mines.find((m) => m.tileId === state.mineEntranceId)
    : undefined;
  const base = state.gemPrice ?? mine?.gemPrice ?? 0;
  return Math.round(base * cfg.sellPriceRatio);
}

/** 村庄情报：朝城市方向揭示 intelTiles 格 */
export function buyVillageIntel(state: GameState): number {
  const cfg = gameConfig.mechanisms.villageService;
  if (!cfg.enabled) return 0;
  const revealed = revealReturnCone(state, state.position, cfg.intelTiles);
  state.stats.villageIntelBought += 1;
  return revealed.length;
}

/* ------------------------------------------------------------------ */
/* G. 矿区第二层决策（深层采矿）                                          */
/* ------------------------------------------------------------------ */

/** 深层采矿是否可用（一次性 + 机制开启 + 采矿阶段） */
export function canSurgeMine(state: GameState): boolean {
  const cfg = gameConfig.mechanisms.surgeMining;
  if (!cfg.enabled) return false;
  if (state.phase !== 'MINING') return false;
  if (cfg.oncePerRun && state.stats.surgeMiningUses > 0) return false;
  return true;
}

/** 深层采矿的产量（= 当日正常产量 × 倍率） */
export function surgeYield(baseYield: number): number {
  const cfg = gameConfig.mechanisms.surgeMining;
  return Math.round(baseYield * cfg.yieldMultiplier * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* H. 应急补救（求援）                                                   */
/* ------------------------------------------------------------------ */

/**
 * 求援可用性（刻意做窄）：
 *   ① 机制开启且未超过每局次数上限；
 *   ② 现金足够；
 *   ③ 处于困局——「剩余天数 − 返程期望天数 < triggerMarginDays」或「耐力 ≤ 2」。
 *
 * 第 ③ 条是关键：只有真的走投无路时才允许花钱买命，否则它就会退化成
 * 「多花 400 元买 5 天」的常规加速手段（那就不是补救，而是支配策略）。
 */
/**
 * 求援的**当场**现金支出。
 *
 * v0.3.0：如果 `rescueSettlement` 打开，求援改为延期结算，当场支出 = immediateCost
 * （可以为 0）——这正是绕开上一轮「可负担性悬崖（手上最多 550 元）」的关键。
 * 机制关闭时恒等于 emergencyRescue.cost，行为与 v0.2.0 逐元一致。
 */
export function rescueImmediateCost(): number {
  const rs = gameConfig.mechanisms.rescueSettlement;
  const base = gameConfig.mechanisms.emergencyRescue;
  if (!rs.enabled) return base.cost;
  return Math.max(0, Math.round(rs.immediateCost));
}

export function canEmergencyRescue(state: GameState, returnEta: number): boolean {
  const cfg = gameConfig.mechanisms.emergencyRescue;
  if (!cfg.enabled) return false;
  if (state.status !== 'ONGOING') return false;
  if (state.phase !== 'OUTBOUND' && state.phase !== 'RETURN' && state.phase !== 'MINING') return false;
  if (state.stats.emergencyRescues >= cfg.maxUses) return false;
  if (state.cash < rescueImmediateCost()) return false;
  const daysLeft = state.maxDays - state.daysUsed;
  const timeTight = daysLeft - returnEta < cfg.triggerMarginDays;
  const staminaLow = state.stamina <= 2;
  return timeTight || staminaLow;
}

/**
 * 返程期望天数（公开、可解释的估计，不含任何隐藏信息）：
 *   剩余最短跳数 + 每格沙漠的负重额外天数。
 *
 * 用于「求援是否已到绝境」的判定，也供 UI/Bot 显示。
 * 注意这里走的是「城市到当前位置」的曼哈顿距离下界——它是**乐观**估计，
 * 因此 `daysLeft − eta` 偏乐观 ⇒ 求援会更晚触发，符合「只在真的走投无路时」的设计意图。
 */
export function expectedReturnDays(state: GameState): number {
  const hops = manhattan(state.position, state.map.cityId);
  const gems = state.gemsKg;
  const extraPerTile = (() => {
    const cfg = gameConfig.mechanisms.loadReturn;
    if (!cfg.enabled) return 0;
    if (gems < cfg.thresholdKg) return 0;
    const steps = 1 + Math.floor((gems - cfg.thresholdKg) / cfg.stepKg);
    return Math.min(cfg.maxExtraPerDesertTile, steps);
  })();
  // 沙漠占比未知（迷雾），用「最坏情况全是沙漠」的一半作为期望惩罚——保守但可解释
  const desertHops = Math.floor(hops / 2);
  return hops + desertHops * extraPerTile;
}
