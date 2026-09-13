import {
  ActionInfo,
  CreateGameOptions,
  EventChoice,
  ForecastRow,
  ForecastView,
  GameAction,
  GameError,
  GameState,
  LogEntry,
  NodeId,
  PendingEvent,
  WeatherType,
} from '../types';
import { gameConfig } from '../config/gameConfig';
import { hashSeed, nextRandom } from '../random/rng';
import { generateWeatherTable, weatherForDay, weatherNames } from '../rules/weather';
import {
  encounterRollForDay,
  generateDroughtTable,
  generateEncounterRollTable,
  judgeEncounter,
} from '../rules/encounters';
import { consumeTentForRainstorm, consumeTentForSandstorm } from '../rules/equipment';
import { isTerrainKnown, revealIntelAround } from '../rules/reveal';
import {
  getLegalMoves,
  hasLegalReturnPath,
  isNormalTile,
} from '../rules/movement';
import {
  computeRouteScore,
  computeStarRating,
  estimatePriceBand,
  starLabel,
} from '../rules/routeScore';
import { worldMap } from '../map/worldMap';
import { GameMap } from '../types';

export { computeSettlement } from '../rules/settlement';
export { estimatePriceBand, starLabel, computeStarRating } from '../rules/routeScore';
export { weatherNames } from '../rules/weather';
export { getLegalMoves, hasLegalReturnPath } from '../rules/movement';
export { isTerrainKnown } from '../rules/reveal';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function pushLog(state: GameState, kind: LogEntry['kind'], text: string): void {
  state.log.push({ day: state.daysUsed, kind, text });
  if (state.log.length > gameConfig.logLimit) {
    state.log.splice(0, state.log.length - gameConfig.logLimit);
  }
}

function makeEventId(state: GameState, kind: PendingEvent['kind'], nodeId: NodeId | null): string {
  return `${kind}@${nodeId ?? '-'}#d${state.daysUsed}#${state.pendingEvents.length}`;
}

function enqueue(state: GameState, event: PendingEvent): void {
  state.pendingEvents.push(event);
}

/** 天数推进；超过上限立即判负。返回 false 表示游戏已结束 */
function addDays(state: GameState, n: number): boolean {
  state.daysUsed += n;
  if (state.daysUsed > gameConfig.maxDays) {
    defeat(state, 'TIMEOUT', `第 ${state.daysUsed} 天：超过 ${gameConfig.maxDays} 天期限，商队永远迷失在了荒野之中。`);
    return false;
  }
  return true;
}

/** 耐力损失；归零立即判负。返回 false 表示游戏已结束 */
function applyStaminaLoss(state: GameState, n: number): boolean {
  state.stamina = Math.max(0, state.stamina - n);
  if (state.stamina <= 0) {
    defeat(state, 'STAMINA_EXHAUSTED', '耐力耗尽，商队倒在了路上。');
    return false;
  }
  return true;
}

function defeat(state: GameState, reason: GameState['defeatReason'], message: string): void {
  state.status = 'DEFEAT';
  state.defeatReason = reason;
  state.phase = 'FINISHED';
  state.pendingEvents = [];
  pushLog(state, 'bad', message);
}

function assertOngoing(state: GameState): void {
  if (state.status !== 'ONGOING') {
    throw new GameError('GAME_OVER', '对局已结束');
  }
}

/** 移动 / 行动前：对局进行中，且没有等待决断的事件 */
function assertFreeToAct(state: GameState): void {
  assertOngoing(state);
  if (state.pendingEvents.length > 0) {
    throw new GameError('EVENT_PENDING', '有待处理的事件需要先做出选择');
  }
}

/* ------------------------------------------------------------------ */
/* 开局                                                                */
/* ------------------------------------------------------------------ */

export function createNewGame(seed: string, opts: CreateGameOptions = {}): GameState {
  if (!seed) throw new GameError('BAD_SEED', 'Seed 不能为空');
  const map: GameMap = opts.map ?? worldMap;

  // 开局一次性预生成：天气表 → 遭遇表 → 绿洲干涸（顺序固定保证可复现）
  let rngState = hashSeed(seed);
  const weatherGen = generateWeatherTable(map, rngState);
  rngState = weatherGen.rngState;
  const encGen = generateEncounterRollTable(map, rngState);
  rngState = encGen.rngState;
  const droughtGen = generateDroughtTable(map, rngState);
  rngState = droughtGen.rngState;

  // 测试/调试注入覆盖
  const weather = { ...weatherGen.weather, ...(opts.weather ?? {}) };
  const encounterRolls = { ...encGen.rolls, ...(opts.encounters ?? {}) };
  const oasisDrought = { ...droughtGen.drought, ...(opts.drought ?? {}) };

  const state: GameState = {
    seed,
    rngState,
    map,
    daysUsed: 0,
    phase: 'OUTBOUND',
    status: 'ONGOING',
    defeatReason: null,
    cash: gameConfig.startCash,
    stamina: gameConfig.startStamina,
    gemsKg: 0,
    tents: [],
    compasses: 0,
    equipmentSpent: 0,
    position: map.cityId,
    mineEntranceId: null,
    routeScore: null,
    baseGemPrice: null,
    marketFactor: null,
    gemPrice: null,
    visitedOutbound: [map.cityId],
    visitedReturn: [],
    explored: [map.cityId, ...map.mineIds],
    intelKnown: [],
    oasisRestUsed: {},
    oasisDrought,
    weather,
    encounterRolls,
    pendingEvents: [],
    lastForecast: null,
    visitDiscount: false,
    turnFlags: { penaltyDay: false, forecastDay: false },
    stats: { forecastCount: 0, outboundDays: null, miningDays: 0, returnStartDay: null },
    log: [],
  };
  pushLog(state, 'system', `新的旅程开始。Seed: ${seed}`);
  pushLog(state, 'info', `你从城市出发，携带 ${gameConfig.startCash} 元。在 ${gameConfig.maxDays} 天内抵达宝库并沿新路线返回。`);
  return state;
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

export function getWeatherForDay(state: GameState, nodeId: NodeId, day: number): WeatherType {
  return weatherForDay(state.weather, nodeId, day);
}

export function getCurrentWeather(state: GameState): WeatherType {
  return getWeatherForDay(state, state.position, state.daysUsed);
}

export function getTerrainName(state: GameState, nodeId: NodeId): string {
  const node = state.map.nodes[nodeId];
  if (!node) return '?';
  if (!isTerrainKnown(state, nodeId)) return '未知';
  const names: Record<string, string> = {
    CITY: '城市',
    DESERT: '沙漠',
    GRASS: '草地',
    VILLAGE: '村庄',
    OASIS: '绿洲',
    MINE: '矿区入口',
  };
  return names[node.terrain] ?? node.terrain;
}

/* ------------------------------------------------------------------ */
/* 移动                                                                */
/* ------------------------------------------------------------------ */

export function performMove(state: GameState, toNodeId: NodeId): GameState {
  assertFreeToAct(state);
  if (state.phase !== 'OUTBOUND' && state.phase !== 'RETURN') {
    throw new GameError('PHASE_NO_MOVE', '当前阶段不能移动');
  }
  const legal = getLegalMoves(state);
  if (!legal.includes(toNodeId)) {
    throw new GameError('ILLEGAL_MOVE', `不允许移动到 ${toNodeId}`);
  }

  const s = clone(state);
  s.turnFlags = { penaltyDay: false, forecastDay: false };
  s.lastForecast = null;
  s.visitDiscount = false; // 离开村庄，市集折扣失效

  if (!addDays(s, 1)) return s; // 超时判负

  const node = s.map.nodes[toNodeId];
  s.position = toNodeId;
  if (!s.explored.includes(toNodeId)) s.explored.push(toNodeId);
  if (s.phase === 'OUTBOUND') {
    s.visitedOutbound.push(toNodeId);
  } else {
    s.visitedReturn.push(toNodeId);
  }
  pushLog(s, 'info', `第 ${s.daysUsed} 天：抵达「${node.name}」${terrainBadge(node.terrain)}，天气：${weatherNames[getWeatherForDay(s, toNodeId, s.daysUsed)]}。`);

  // 回城 = 胜利（仅可能发生在返程；天气不再结算）
  if (node.terrain === 'CITY') {
    s.phase = 'FINISHED';
    s.status = 'VICTORY';
    pushLog(s, 'good', `第 ${s.daysUsed} 天，你带着宝石回到了城市！准备结算。`);
    return s;
  }

  // 进入矿区入口 = 进入采矿阶段（宝库无天气无遭遇）
  if (node.terrain === 'MINE' && s.phase === 'OUTBOUND') {
    enterMine(s);
    if (s.status === 'ONGOING' && s.pendingEvents.length === 0) {
      finalizeTurn(s); // 进矿当天也是正常行动日，同样触发 20:00 询问
    }
    return s;
  }

  // 普通格：先天气后遭遇
  resolveArrivalWeather(s, node.id, s.daysUsed);
  if (s.status === 'ONGOING') {
    resolveArrivalEncounter(s, node.id, s.daysUsed);
  }
  if (s.status === 'ONGOING' && s.pendingEvents.length === 0) {
    // 无未决事件时立即收尾；否则由最后一个事件的处理负责收尾
    finalizeTurn(s);
  }
  return s;
}

function terrainBadge(terrain: string): string {
  const badges: Record<string, string> = {
    DESERT: '【沙漠】',
    GRASS: '【草地】',
    VILLAGE: '【村庄】',
    OASIS: '【绿洲】',
    MINE: '【矿区入口】',
    CITY: '【城市】',
  };
  return badges[terrain] ?? '';
}

function enterMine(s: GameState): void {
  const mineId = s.position;
  s.phase = 'MINING';
  s.mineEntranceId = mineId;
  s.stats.outboundDays = s.daysUsed;
  pushLog(s, 'event', `你抵达「${s.map.nodes[mineId].name}」，路线难度评定中……`);

  if (!hasLegalReturnPath(s)) {
    defeat(s, 'RETURN_ROUTE_SEVERED', '你的去程封死了所有归途——没有任何合法返城路线。宝库就在眼前，但一切都结束了。');
    return;
  }

  const result = computeRouteScore(s);
  s.routeScore = result.score;
  s.baseGemPrice = result.baseGemPrice;
  s.marketFactor = result.marketFactor;
  s.gemPrice = result.gemPrice;
  s.rngState = result.rngState;
  const [lo, hi] = estimatePriceBand(result.baseGemPrice);
  pushLog(s, 'good', `路线难度评分 ${result.score}（${starLabel(result.stars)}）。宝石基础估价 ${result.baseGemPrice} 元/kg，预计售价 ${lo}~${hi} 元/kg（市场行情结算时揭晓）。`);
  pushLog(s, 'info', `去程耗时 ${s.daysUsed} 天。从现在起每天可挖 ${gameConfig.gemPerMiningDay}kg 宝石，何时收手由你决定。`);
}

/* ------------------------------------------------------------------ */
/* 到达结算：天气 / 遭遇                                                 */
/* ------------------------------------------------------------------ */

function resolveArrivalWeather(s: GameState, nodeId: NodeId, day: number): void {
  const w = getWeatherForDay(s, nodeId, day);
  const terrain = s.map.nodes[nodeId].terrain;

  if (terrain === 'DESERT') {
    if (w === 'SANDSTORM') {
      pushLog(s, 'bad', '沙尘暴骤起，天地一片昏黄！');
      enqueue(s, { id: makeEventId(s, 'SANDSTORM', nodeId), kind: 'SANDSTORM', nodeId });
    } else if (w === 'HEAT') {
      pushLog(s, 'bad', `烈日炙烤（高温）：耐力 -${gameConfig.heatStaminaCost}。`);
      applyStaminaLoss(s, gameConfig.heatStaminaCost);
    }
    return;
  }
  if (terrain === 'GRASS') {
    if (w === 'RAINSTORM') {
      if (s.tents.length > 0) {
        pushLog(s, 'bad', '草原暴雨倾盆而下！');
        enqueue(s, { id: makeEventId(s, 'RAINSTORM', nodeId), kind: 'RAINSTORM', nodeId });
      } else {
        pushLog(s, 'bad', `暴雨倾盆而你无帐可依：耐力 -${gameConfig.rainstormStaminaCost}。`);
        applyStaminaLoss(s, gameConfig.rainstormStaminaCost);
      }
    } else if (w === 'MUD') {
      pushLog(s, 'bad', '陷入泥沼，挣扎出来白白耗掉了一整天。');
      s.turnFlags.penaltyDay = true;
      addDays(s, 1);
    }
    return;
  }
  if (terrain === 'OASIS') {
    if (s.oasisDrought[nodeId]) {
      pushLog(s, 'bad', '这里的绿洲已经干涸，只剩龟裂的泥地。');
    } else {
      pushLog(s, 'good', '清冽的绿洲——在此休整一天可以恢复 1 点耐力。');
    }
  }
}

function resolveArrivalEncounter(s: GameState, nodeId: NodeId, day: number): void {
  if (s.status !== 'ONGOING') return;
  const terrain = s.map.nodes[nodeId].terrain;
  const roll = encounterRollForDay(s.encounterRolls, nodeId, day);
  const { kind } = judgeEncounter(terrain, roll);

  switch (kind) {
    case 'CARAVAN':
      pushLog(s, 'event', '一支商队从沙雾中走来，招呼你做笔买卖。');
      enqueue(s, { id: makeEventId(s, 'CARAVAN', nodeId), kind: 'CARAVAN', nodeId });
      break;
    case 'THIEF': {
      const stolen = Math.min(gameConfig.thiefStealMax, s.cash);
      pushLog(s, 'bad', `盗贼夜袭！被抢走 ${stolen} 元。你可以追回，但要花上一整天。`);
      enqueue(s, { id: makeEventId(s, 'THIEF', nodeId), kind: 'THIEF', nodeId, stolen });
      break;
    }
    case 'MARKET':
      pushLog(s, 'event', '村里正逢繁荣市集，货物齐全、价格公道。');
      enqueue(s, { id: makeEventId(s, 'MARKET', nodeId), kind: 'MARKET', nodeId });
      break;
    case 'HERDSMAN': {
      const revealed = revealIntelAround(s, nodeId);
      if (revealed.length > 0) {
        const names = revealed.map((id) => `「${s.map.nodes[id].name}」${terrainBadge(s.map.nodes[id].terrain)}`);
        pushLog(s, 'good', `路遇牧民，热心指点了周边地形：${names.join('、')}。`);
      } else {
        pushLog(s, 'info', '路遇牧民，但周边地形你都已了然。');
      }
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 回合收尾：路线可行性 + 20:00 天气预报询问                              */
/* ------------------------------------------------------------------ */

function checkRouteViability(s: GameState): void {
  if (s.status !== 'ONGOING') return;
  if (s.phase === 'RETURN' && !hasLegalReturnPath(s)) {
    defeat(s, 'RETURN_ROUTE_SEVERED', '返程路线中断：去程与返程的足迹封死了所有归途，再也回不去城市了。');
    return;
  }
  if (s.phase === 'OUTBOUND' && !isNormalTile(s, s.position)) return;
  if (s.phase === 'OUTBOUND' && getLegalMoves(s).length === 0) {
    defeat(s, 'TRAPPED', '去程路线中断：四周都是你走过的脚印，进退无路。');
  }
}

function finalizeTurn(s: GameState): void {
  if (s.status !== 'ONGOING') return;
  checkRouteViability(s);
  if (s.status !== 'ONGOING') return;
  // 惩罚日与天气预报日不触发 20:00 询问（避免递归）
  if (s.turnFlags.penaltyDay || s.turnFlags.forecastDay) return;
  // 已经用到第 42 天：预报会把天数推到 43，必然失败，不再询问
  if (s.daysUsed >= gameConfig.maxDays) return;
  enqueue(s, { id: makeEventId(s, 'FORECAST_OFFER', null), kind: 'FORECAST_OFFER' });
}

/* ------------------------------------------------------------------ */
/* 行动                                                                */
/* ------------------------------------------------------------------ */

export function getAvailableActions(state: GameState): ActionInfo[] {
  if (state.status !== 'ONGOING') return [];
  const actions: ActionInfo[] = [];
  const node = state.map.nodes[state.position];

  if (state.phase === 'MINING') {
    actions.push({
      action: { type: 'MINE' },
      label: `挖矿（+${gameConfig.gemPerMiningDay}kg 宝石）`,
      hint: '消耗 1 天。宝库安全，无天气与耐力消耗。',
    });
    actions.push({
      action: { type: 'START_RETURN' },
      label: '停止挖矿，开始返程',
      hint: '不消耗时间。返程不能经过去程走过的普通格。',
    });
  }

  if (node.terrain === 'OASIS' && (state.phase === 'OUTBOUND' || state.phase === 'RETURN')) {
    const drought = state.oasisDrought[state.position];
    const used = !!state.oasisRestUsed[state.position];
    const full = state.stamina >= gameConfig.maxStamina;
    let disabled = false;
    let reason: string | undefined;
    if (drought) {
      disabled = true;
      reason = '这片绿洲已经干涸';
    } else if (used) {
      disabled = true;
      reason = '每个绿洲每局只能休整一次';
    } else if (full) {
      disabled = true;
      reason = '耐力已满';
    }
    actions.push({
      action: { type: 'REST' },
      label: '绿洲休整（+1 耐力）',
      hint: '消耗 1 天。',
      disabled,
      disabledReason: reason,
    });
  }

  if (node.terrain === 'CITY' || node.terrain === 'VILLAGE') {
    const discount = state.visitDiscount && node.terrain === 'VILLAGE';
    const tentPrice = discount ? gameConfig.marketDiscountTentPrice : gameConfig.tentPrice;
    const compassPrice = discount ? gameConfig.marketDiscountCompassPrice : gameConfig.compassPrice;
    actions.push({
      action: { type: 'BUY', item: 'tent' },
      label: `购买帐篷（${tentPrice} 元）`,
      price: tentPrice,
      hint: discount ? '市集八折！' : `每顶含 ${gameConfig.tentDesertCharges} 次沙漠耐久；暴雨会整顶消耗。`,
      disabled: state.cash < tentPrice,
      disabledReason: state.cash < tentPrice ? '现金不足' : undefined,
    });
    actions.push({
      action: { type: 'BUY', item: 'compass' },
      label: `购买指南针（${compassPrice} 元）`,
      price: compassPrice,
      hint: discount ? '市集八折！' : '单次消耗品，在沙尘暴中辨别方向。',
      disabled: state.cash < compassPrice,
      disabledReason: state.cash < compassPrice ? '现金不足' : undefined,
    });
  }

  return actions;
}

export function performAction(state: GameState, action: GameAction): GameState {
  assertFreeToAct(state);
  const s = clone(state);
  const node = s.map.nodes[s.position];

  switch (action.type) {
    case 'MINE': {
      if (s.phase !== 'MINING') throw new GameError('NOT_MINING', '只有在矿区入口才能挖矿');
      s.turnFlags = { penaltyDay: false, forecastDay: false };
      if (!addDays(s, 1)) return s;
      s.stats.miningDays += 1;
      s.gemsKg += gameConfig.gemPerMiningDay;
      pushLog(s, 'good', `第 ${s.daysUsed} 天：在矿脉中劳作一整天，收获 ${gameConfig.gemPerMiningDay}kg 宝石（累计 ${s.gemsKg}kg）。`);
      finalizeTurn(s);
      return s;
    }
    case 'START_RETURN': {
      if (s.phase !== 'MINING') throw new GameError('NOT_MINING', '只有采矿阶段可以开始返程');
      s.phase = 'RETURN';
      s.stats.returnStartDay = s.daysUsed;
      if (s.mineEntranceId) s.visitedReturn.push(s.mineEntranceId);
      pushLog(s, 'event', `你背起 ${s.gemsKg}kg 宝石，从「${s.map.nodes[s.mineEntranceId ?? s.position].name}」踏上归途。返程不能重复去程走过的普通格！`);
      if (!hasLegalReturnPath(s)) {
        defeat(s, 'RETURN_ROUTE_SEVERED', '返程路线中断：不存在任何合法回城路线。');
      }
      return s;
    }
    case 'REST': {
      if (node.terrain !== 'OASIS') throw new GameError('NOT_OASIS', '只有绿洲可以休整');
      if (s.oasisDrought[s.position]) throw new GameError('OASIS_DRY', '这片绿洲已经干涸');
      if (s.oasisRestUsed[s.position]) throw new GameError('OASIS_USED', '每个绿洲每局只能休整一次');
      if (s.stamina >= gameConfig.maxStamina) throw new GameError('STAMINA_FULL', '耐力已满');
      s.turnFlags = { penaltyDay: false, forecastDay: false };
      if (!addDays(s, 1)) return s;
      s.oasisRestUsed[s.position] = true;
      s.stamina = Math.min(gameConfig.maxStamina, s.stamina + 1);
      pushLog(s, 'good', `在绿洲休整一天，耐力恢复至 ${s.stamina}/${gameConfig.maxStamina}。`);
      finalizeTurn(s);
      return s;
    }
    case 'BUY': {
      if (node.terrain !== 'CITY' && node.terrain !== 'VILLAGE') {
        throw new GameError('NO_SHOP', '只有城市与村庄可以购买装备');
      }
      if (!action.item) throw new GameError('BAD_ACTION', '缺少购买物品');
      const discount = s.visitDiscount && node.terrain === 'VILLAGE';
      const price =
        action.item === 'tent'
          ? discount
            ? gameConfig.marketDiscountTentPrice
            : gameConfig.tentPrice
          : discount
            ? gameConfig.marketDiscountCompassPrice
            : gameConfig.compassPrice;
      if (s.cash < price) throw new GameError('NO_CASH', '现金不足');
      s.cash -= price;
      s.equipmentSpent += price;
      if (action.item === 'tent') {
        s.tents.push(gameConfig.tentDesertCharges);
        pushLog(s, 'info', `购买了一顶帐篷（-${price} 元，${discount ? '市集八折' : '原价'}）。现有 ${s.tents.length} 顶。`);
      } else {
        s.compasses += 1;
        pushLog(s, 'info', `购买了一只指南针（-${price} 元，${discount ? '市集八折' : '原价'}）。现有 ${s.compasses} 只。`);
      }
      return s; // 购买不消耗时间
    }
    default:
      throw new GameError('BAD_ACTION', '未知行动');
  }
}

/* ------------------------------------------------------------------ */
/* 事件解决                                                            */
/* ------------------------------------------------------------------ */

export function resolvePendingEvent(state: GameState, eventId: string, choice: EventChoice): GameState {
  assertOngoing(state);
  const current = state.pendingEvents[0];
  if (!current) throw new GameError('NO_PENDING_EVENT', '没有待处理事件');
  if (current.id !== eventId) throw new GameError('EVENT_MISMATCH', '事件顺序不匹配');

  const s = clone(state);
  s.pendingEvents.shift();

  switch (current.kind) {
    case 'SANDSTORM': {
      if (choice.kind !== 'SANDSTORM') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      const { useTent, useCompass } = choice;
      if (useTent && s.tents.length === 0) throw new GameError('NO_TENT', '没有帐篷');
      if (useCompass && s.compasses === 0) throw new GameError('NO_COMPASS', '没有指南针');
      applySandstorm(s, useTent, useCompass);
      break;
    }
    case 'RAINSTORM': {
      if (choice.kind !== 'RAINSTORM') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.useTent) {
        if (s.tents.length === 0) throw new GameError('NO_TENT', '没有帐篷');
        s.tents = consumeTentForRainstorm(s.tents);
        pushLog(s, 'bad', `你撑起帐篷硬扛暴雨。虽然保住了体力，但帐篷已彻底报废（剩 ${s.tents.length} 顶）。`);
      } else {
        pushLog(s, 'bad', `你冒雨赶路：耐力 -${gameConfig.rainstormStaminaCost}。`);
        if (!applyStaminaLoss(s, gameConfig.rainstormStaminaCost)) return s;
      }
      break;
    }
    case 'CARAVAN': {
      if (choice.kind !== 'CARAVAN') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'BUY_TENT') {
        if (s.cash < gameConfig.caravanTentPrice) throw new GameError('NO_CASH', '现金不足，无法购买二手帐篷');
        s.cash -= gameConfig.caravanTentPrice;
        s.equipmentSpent += gameConfig.caravanTentPrice;
        s.tents.push(gameConfig.caravanTentCharges);
        pushLog(s, 'info', `从商队购入一顶二手帐篷（-${gameConfig.caravanTentPrice} 元）。现有 ${s.tents.length} 顶。`);
      } else {
        const revealed = revealIntelAround(s, current.nodeId);
        if (revealed.length > 0) {
          const names = revealed.map((id) => `「${s.map.nodes[id].name}」${terrainBadge(s.map.nodes[id].terrain)}`);
          pushLog(s, 'good', `商队头人摊开地图为你指点周边：${names.join('、')}。`);
        } else {
          pushLog(s, 'info', '商队告诉你：周边的地形你都已经知道了。');
        }
      }
      break;
    }
    case 'THIEF': {
      if (choice.kind !== 'THIEF') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'GIVE_UP') {
        s.cash -= current.stolen;
        pushLog(s, 'bad', `你放弃了追逐，损失 ${current.stolen} 元。剩余 ${s.cash} 元。`);
      } else {
        s.turnFlags = { penaltyDay: false, forecastDay: false };
        pushLog(s, 'info', '你追了出去……');
        if (!addDays(s, 1)) return s;
        pushLog(s, 'good', `追回成功！被偷的 ${current.stolen} 元分文不少地回到了口袋（耗时 1 天）。`);
      }
      break;
    }
    case 'MARKET': {
      if (choice.kind !== 'MARKET') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'TAKE_DISCOUNT') {
        s.visitDiscount = true;
        pushLog(s, 'good', '你取得了市集商家的信任：本次停留期间帐篷 320 元、指南针 80 元。');
      } else {
        s.turnFlags = { penaltyDay: false, forecastDay: false };
        if (!addDays(s, 1)) return s;
        s.cash += gameConfig.workPay;
        pushLog(s, 'good', `在市集帮工一整天，赚得 ${gameConfig.workPay} 元（现金 ${s.cash} 元）。`);
      }
      break;
    }
    case 'FORECAST_OFFER': {
      if (choice.kind !== 'FORECAST_OFFER') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.accept) {
        s.turnFlags = { penaltyDay: false, forecastDay: true };
        if (!addDays(s, 1)) return s;
        s.stats.forecastCount += 1;
        s.lastForecast = buildForecastView(s);
        pushLog(s, 'info', `你花了一整天守在观测点，记下了未来 3 天的天气。`);
      } else {
        s.turnFlags = { penaltyDay: false, forecastDay: false };
        pushLog(s, 'info', '你决定赶路要紧，不去看天气预报。');
      }
      break;
    }
    default:
      throw new GameError('BAD_EVENT', '未知事件类型');
  }

  if (s.status === 'ONGOING' && s.pendingEvents.length === 0 && current.kind !== 'FORECAST_OFFER') {
    // 天气预报询问本身就是回合收尾的一部分：无论接受与否都不再重复询问
    finalizeTurn(s);
  }
  return s;
}

function applySandstorm(s: GameState, useTent: boolean, useCompass: boolean): void {
  if (useTent) {
    s.tents = consumeTentForSandstorm(s.tents);
    if (useCompass) {
      s.compasses -= 1;
      pushLog(s, 'info', `你扎起帐篷躲过沙暴，指南针指明方向。帐篷耐久 -1（剩 ${s.tents.length} 顶），指南针 -1（剩 ${s.compasses} 只）。体力无损，继续前行。`);
    } else {
      pushLog(s, 'bad', `帐篷挡住了风沙（耐久 -1，剩 ${s.tents.length} 顶），但在昏黄的风中迷失了方向：额外损失 1 天。`);
      s.turnFlags.penaltyDay = true;
      addDays(s, 1);
    }
  } else {
    if (useCompass) {
      s.compasses -= 1;
      pushLog(s, 'bad', `没有帐篷遮蔽，你顶着风沙辨认方向：耐力 -${gameConfig.sandstormStaminaCost}，指南针 -1（剩 ${s.compasses} 只）。`);
      applyStaminaLoss(s, gameConfig.sandstormStaminaCost);
    } else {
      pushLog(s, 'bad', `无帐无针，你在沙暴中狼狈挣扎：耐力 -${gameConfig.sandstormStaminaCost}，且迷失方向：额外损失 1 天。`);
      s.turnFlags.penaltyDay = true;
      if (!applyStaminaLoss(s, gameConfig.sandstormStaminaCost)) return;
      addDays(s, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 天气预报视图                                                         */
/* ------------------------------------------------------------------ */

export function buildForecastView(s: GameState): ForecastView {
  const dayNumbers = [s.daysUsed + 1, s.daysUsed + 2, s.daysUsed + 3];
  const rows: ForecastRow[] = Object.keys(s.map.nodes).map((nodeId) => {
    const known = isTerrainKnown(s, nodeId);
    return {
      nodeId,
      terrainKnown: known,
      values: known
        ? dayNumbers.map((d) => getWeatherForDay(s, nodeId, d))
        : (['UNKNOWN', 'UNKNOWN', 'UNKNOWN'] as Array<WeatherType | 'UNKNOWN'>),
    };
  });
  return { dayNumbers, rows };
}

/** 路线难度评分的展示信息 */
export function getRouteSummary(state: GameState): string | null {
  if (state.routeScore === null) return null;
  const [lo, hi] = estimatePriceBand(state.baseGemPrice ?? 0);
  return `评分 ${state.routeScore}（${starLabel(computeStarRating(state.routeScore))}），预计售价 ${lo}~${hi} 元/kg`;
}

/* ------------------------------------------------------------------ */
/* rng 直接访问（测试/调试）                                            */
/* ------------------------------------------------------------------ */

export function drawRandom(state: GameState): [number, GameState] {
  const s = clone(state);
  const [value, rngState] = nextRandom(s.rngState);
  s.rngState = rngState;
  return [value, s];
}
