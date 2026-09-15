import {
  GameError,
} from '../types';
import type {
  ActionInfo,
  CreateGameOptions,
  EventChoice,
  ForecastCell,
  ForecastView,
  GameAction,
  GameState,
  GameStatus,
  LogEntry,
  ResourceChange,
  TentId,
  TentItem,
  TileId,
  WeatherType,
} from '../types';
import { gameConfig } from '../config/gameConfig';
import { generateWorld } from '../map/generate';
import { parseTileId, tileIdOf } from '../map/grid';
import { weatherForDay, weatherNames } from '../rules/weather';
import { pregeneratedEncounter } from '../rules/encounters';
import { consumeTentCharge, consumeTentForRainstorm, tentIdOf, tentName } from '../rules/equipment';
import { isTerrainKnown, revealIntelAround } from '../rules/reveal';
import { getLegalMoves, hasLegalReturnPath, isNormalTile } from '../rules/movement';
import { evaluateViability } from '../rules/viability';
import { computeRouteScore, computeStarRating, starLabel } from '../rules/routeScore';
import type { GameMap } from '../types';

export { computeSettlement } from '../rules/settlement';
export { starLabel, computeStarRating } from '../rules/routeScore';
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
  pushLogAt(state, state.daysUsed, kind, text);
}

/** 指定天数的日志写入（结算日志用「事件发生的当天」更贴近玩家直觉） */
function pushLogAt(state: GameState, day: number, kind: LogEntry['kind'], text: string): void {
  state.log.push({ day, kind, text });
  if (state.log.length > gameConfig.logLimit) {
    state.log.splice(0, state.log.length - gameConfig.logLimit);
  }
}

function makeEventId(state: GameState, kind: string, tileId: TileId | null): string {
  return `${kind}@${tileId ?? '-'}#d${state.daysUsed}#${state.pendingEvents.length}`;
}

function enqueue(state: GameState, event: GameState['pendingEvents'][number]): void {
  state.pendingEvents.push(event);
}

/* ------------------------------------------------------------------ */
/* 即时反馈：资源快照 → 变化前/变化后 → 统一结算结果                        */
/* 见 types/index.ts 的 EventResult / ResourceChange 说明。              */
/* ------------------------------------------------------------------ */

interface ResourceSnapshot {
  day: number;
  maxDays: number;
  stamina: number;
  cash: number;
  gemsKg: number;
  compasses: number;
  forecastCharges: number;
  tents: Map<TentId, number>;
}

function snapshot(s: GameState): ResourceSnapshot {
  return {
    day: s.daysUsed,
    maxDays: s.maxDays,
    stamina: s.stamina,
    cash: s.cash,
    gemsKg: s.gemsKg,
    compasses: s.compasses,
    forecastCharges: s.forecastCharges,
    tents: new Map(s.tents.map((t) => [t.id, t.charges])),
  };
}

const staminaText = (v: number): string => `${v}/${gameConfig.maxStamina}`;
const tentChargesText = (v: number): string => `${v}/${gameConfig.tentDesertCharges}`;
const dayText = (v: number): string => `第 ${v} 天`;
const dir = (d: number): ResourceChange['direction'] => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');

/** 对比快照，产出「变化前 → 变化后」列表（一次性覆盖本次结算的全部资源变化） */
function diffSnapshot(before: ResourceSnapshot, after: ResourceSnapshot): ResourceChange[] {
  const out: ResourceChange[] = [];

  // 帐篷：报废 / 耐久变化 / 新获得（逐顶对齐稳定 ID，不按数组下标）
  for (const [id, ch] of before.tents) {
    if (!after.tents.has(id)) {
      out.push({ key: 'tent', label: tentName(id), before: tentChargesText(ch), after: '报废', direction: 'down' });
    } else if (after.tents.get(id) !== ch) {
      const nv = after.tents.get(id)!;
      out.push({ key: 'tent', label: tentName(id), before: tentChargesText(ch), after: tentChargesText(nv), direction: dir(nv - ch) });
    }
  }
  for (const [id, ch] of after.tents) {
    if (!before.tents.has(id)) {
      out.push({ key: 'tent', label: `${tentName(id)}（新）`, before: '无', after: tentChargesText(ch), direction: 'up' });
    }
  }

  if (after.stamina !== before.stamina) {
    out.push({ key: 'stamina', label: '耐力', before: staminaText(before.stamina), after: staminaText(after.stamina), direction: dir(after.stamina - before.stamina) });
  }
  if (after.cash !== before.cash) {
    out.push({ key: 'cash', label: '金钱', before: `¥${before.cash}`, after: `¥${after.cash}`, direction: dir(after.cash - before.cash) });
  }
  if (after.gemsKg !== before.gemsKg) {
    out.push({ key: 'gemsKg', label: '宝石', before: `${before.gemsKg} kg`, after: `${after.gemsKg} kg`, direction: dir(after.gemsKg - before.gemsKg) });
  }
  if (after.compasses !== before.compasses) {
    out.push({ key: 'compass', label: '指南针', before: String(before.compasses), after: String(after.compasses), direction: dir(after.compasses - before.compasses) });
  }
  if (after.forecastCharges !== before.forecastCharges) {
    out.push({ key: 'forecast', label: '天气预报次数', before: String(before.forecastCharges), after: String(after.forecastCharges), direction: dir(after.forecastCharges - before.forecastCharges) });
  }
  if (after.maxDays !== before.maxDays) {
    out.push({ key: 'maxDays', label: '最大旅程天数', before: String(before.maxDays), after: String(after.maxDays), direction: dir(after.maxDays - before.maxDays) });
  }
  if (after.day !== before.day) {
    out.push({ key: 'day', label: '天数', before: dayText(before.day), after: dayText(after.day), direction: 'flat' });
  }
  return out;
}

/**
 * 结算 + 即时反馈（唯一入口）。
 *
 * 同一处完成三件事，保证三者永不脱节：
 *  1. 执行结算逻辑（`mutate`）；
 *  2. 把本次**全部**资源变化合并成 **一个** EventResult 推入 `pendingResults`
 *     （同一次事件绝不会连弹三个弹窗）；
 *  3. 把同一事件写入历史日志（右下角日志继续保留，绝不只剩弹窗）。
 *
 * `force`：本次结算确实发生了玩家必须知道的结果、但没有数值变化
 * （例如获得地形情报、市集折扣），仍然需要告知玩家。
 *
 * 无资源变化且未 `force` 时只写日志、不弹窗 —— 这是「不要做成弹窗模拟器」的开关。
 */
function recordResult(
  s: GameState,
  meta: { title: string; message: string; kind: LogEntry['kind']; force?: boolean; logText?: string },
  mutate?: () => void,
): void {
  const before = snapshot(s);
  const logDay = s.daysUsed;
  if (mutate) mutate();
  const changes = diffSnapshot(before, snapshot(s));
  // 历史日志：与弹窗同源写入（Result Feedback + History Log 双记录）
  const logText = meta.logText ?? meta.message;
  pushLogAt(s, logDay, meta.kind, logText);
  const history = { day: logDay, text: logText, kind: meta.kind };
  const onlyDay = changes.length === 1 && changes[0].key === 'day';
  if ((changes.length === 0 || onlyDay) && !meta.force) return;
  const outcome: GameStatus | null = s.status === 'ONGOING' ? null : s.status;
  s.pendingResults.push({
    day: s.daysUsed,
    title: meta.title,
    message: meta.message,
    changes,
    kind: meta.kind,
    history,
    outcome,
    defeatReason: s.defeatReason,
  });
}

/** UI 消费掉队首的结算结果（纯函数，状态仍只由引擎产生） */
export function dismissPendingResult(state: GameState): GameState {
  if (state.pendingResults.length === 0) return state;
  const s = clone(state);
  s.pendingResults.shift();
  return s;
}

/** 发放一顶全新帐篷（ID 单调递增、绝不复用），返回该帐篷 */
function mintTent(s: GameState, charges: number = gameConfig.tentDesertCharges): TentItem {
  const tent: TentItem = { id: tentIdOf(s.nextTentSerial), charges };
  s.nextTentSerial += 1;
  s.tents.push(tent);
  return tent;
}

/** 天数推进；超过当前上限立即判负。返回 false 表示游戏已结束 */
function addDays(state: GameState, n: number): boolean {
  state.daysUsed += n;
  state.lastForecast = null; // 预报锚定“明天”，天数推进后失效
  if (state.daysUsed > state.maxDays) {
    defeat(state, 'TIMEOUT', `第 ${state.daysUsed} 天：超过最大旅程天数 ${state.maxDays}，商队永远迷失在了荒野之中。`);
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
  const map: GameMap = generateWorld(seed);

  const weather = { ...map.weather, ...(opts.weather ?? {}) };
  const encounters = { ...map.encounters, ...(opts.encounters ?? {}) };
  const drought = { ...map.drought, ...(opts.drought ?? {}) };
  const maxDays = opts.maxDays ?? gameConfig.maxDays;

  const state: GameState = {
    seed,
    rngState: 0,
    map,
    daysUsed: 0,
    maxDays,
    phase: 'OUTBOUND',
    status: 'ONGOING',
    defeatReason: null,
    cash: gameConfig.startCash,
    stamina: gameConfig.startStamina,
    gemsKg: 0,
    tents: [],
    nextTentSerial: 1,
    compasses: 0,
    equipmentSpent: 0,
    forecastCharges: 0,
    forecastSpent: 0,
    position: map.cityId,
    mineEntranceId: null,
    gemPrice: null,
    routeScore: null,
    visitedOutbound: [map.cityId],
    visitedReturn: [],
    explored: [map.cityId, ...map.mines.map((m) => m.tileId)],
    intelKnown: [],
    triggeredEncounters: [],
    oasisRestUsed: {},
    pendingEvents: [],
    pendingResults: [],
    lastForecast: null,
    visitDiscount: false,
    stats: {
      forecastPacks: 0,
      forecastChargesGranted: 0,
      forecastChargesUsed: 0,
      outboundDays: null,
      miningDays: 0,
      returnStartDay: null,
    },
    log: [],
  };
  // 覆盖表写回（保持 opts 引用不被污染）
  state.map.weather = weather;
  state.map.encounters = encounters;
  state.map.drought = drought;

  const [a, b] = map.mines;
  pushLog(state, 'system', `新的随机远征开始。Seed: ${seed}`);
  pushLog(state, 'info', `你从城市出发，携带 ${gameConfig.startCash} 元。地图 ${map.rows}×${map.cols}，在 ${maxDays} 天内抵达矿区并沿新路线返回。`);
  pushLog(state, 'info', `矿区情报：Mine A (${a.row},${a.col})、Mine B (${b.row},${b.col})。宝石价格属于最终鉴定结果，成功返城后才会公布。`);
  return state;
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

export function getWeatherForDay(state: GameState, tileId: TileId, day: number): WeatherType {
  return weatherForDay(state.map.weather, tileId, day);
}

export function getCurrentWeather(state: GameState): WeatherType {
  return getWeatherForDay(state, state.position, state.daysUsed);
}

export function getTerrainName(state: GameState, tileId: TileId): string {
  const tile = state.map.tiles[tileId];
  if (!tile) return '?';
  if (!isTerrainKnown(state, tileId)) return '未知';
  const names: Record<string, string> = {
    CITY: '城市',
    DESERT: '沙漠',
    GRASS: '草地',
    VILLAGE: '村庄',
    OASIS: '绿洲',
    MINE: '矿区',
  };
  return names[tile.terrain] ?? tile.terrain;
}

/* ------------------------------------------------------------------ */
/* 移动                                                                */
/* ------------------------------------------------------------------ */

export function performMove(state: GameState, toTileId: TileId): GameState {
  assertFreeToAct(state);
  if (state.phase !== 'OUTBOUND' && state.phase !== 'RETURN') {
    throw new GameError('PHASE_NO_MOVE', '当前阶段不能移动');
  }
  if (!getLegalMoves(state).includes(toTileId)) {
    throw new GameError('ILLEGAL_MOVE', `不允许移动到 ${toTileId}`);
  }

  const s = clone(state);
  s.lastForecast = null;
  s.visitDiscount = false; // 离开村庄，市集折扣失效

  if (!addDays(s, 1)) return s; // 超时判负

  const tile = s.map.tiles[toTileId];
  s.position = toTileId;
  if (!s.explored.includes(toTileId)) s.explored.push(toTileId);
  if (s.phase === 'OUTBOUND') {
    s.visitedOutbound.push(toTileId);
  } else {
    s.visitedReturn.push(toTileId);
  }
  pushLog(s, 'info', `第 ${s.daysUsed} 天：抵达 (${tile.row},${tile.col}) ${terrainBadge(tile.terrain)}，天气：${weatherNames[getWeatherForDay(s, toTileId, s.daysUsed)]}。`);

  // 回城 = 胜利（仅可能发生在返程；天气不再结算）
  if (tile.terrain === 'CITY') {
    s.phase = 'FINISHED';
    s.status = 'VICTORY';
    // v0.1.2a：最终鉴定——成功返城后才公布该矿区宝石单价
    const mine = s.mineEntranceId ? s.map.mines.find((m) => m.tileId === s.mineEntranceId) : undefined;
    if (mine) s.gemPrice = mine.gemPrice;
    pushLog(s, 'good', mine
      ? `第 ${s.daysUsed} 天，你带着宝石回到了城市！鉴定师确认 Mine ${mine.slot} 的宝石单价为 ${mine.gemPrice} 元/kg。`
      : `第 ${s.daysUsed} 天，你回到了城市！`);
    return s;
  }

  // 进入矿区 = 进入采矿阶段（矿区无天气无遭遇）
  if (tile.terrain === 'MINE' && s.phase === 'OUTBOUND') {
    enterMine(s);
    if (s.status === 'ONGOING') finalizeTurn(s);
    return s;
  }

  // 普通格：先天气后遭遇
  resolveTileWeather(s, toTileId, s.daysUsed);
  if (s.status === 'ONGOING') {
    resolveArrivalEncounter(s, toTileId);
  }
  if (s.status === 'ONGOING' && s.pendingEvents.length === 0) {
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
    MINE: '【矿区】',
    CITY: '【城市】',
  };
  return badges[terrain] ?? '';
}

function enterMine(s: GameState): void {
  const tile = s.map.tiles[s.position];
  s.phase = 'MINING';
  s.mineEntranceId = s.position;
  s.stats.outboundDays = s.daysUsed;
  pushLog(s, 'event', `你抵达「${tile.mineSlot === 'A' ? 'Mine A' : 'Mine B'}」(${tile.row},${tile.col})，路线风险评定中……`);

  if (!hasLegalReturnPath(s)) {
    defeat(s, 'RETURN_ROUTE_SEVERED', '你的去程封死了所有归途——没有任何合法返城路线。矿脉就在眼前，但一切都结束了。');
    return;
  }

  // 路线风险评分：仅统计展示
  const result = computeRouteScore(s);
  s.routeScore = result.score;

  // v0.1.2a：价格属于最终鉴定结果，进矿不再展示/锁定展示
  pushLog(s, 'good', `已进入 ${tile.mineSlot === 'A' ? 'Mine A' : 'Mine B'}。宝石单价将在成功返城鉴定后公布。`);
  pushLog(s, 'info', `去程耗时 ${s.daysUsed} 天。从现在起每天可挖 ${gameConfig.gemPerMiningDay}kg 宝石，何时收手由你决定。`);
}

/* ------------------------------------------------------------------ */
/* 天气 / 遭遇结算（到达或停留的当天）                                     */
/* ------------------------------------------------------------------ */

function resolveTileWeather(s: GameState, tileId: TileId, day: number, emit = true): void {
  const w = getWeatherForDay(s, tileId, day);
  const terrain = s.map.tiles[tileId].terrain;

  if (terrain === 'DESERT') {
    if (w === 'SANDSTORM') {
      // 沙尘暴需要玩家先做选择：这里只报「发生了什么」，结算结果由选择后产生
      pushLog(s, 'bad', '沙尘暴骤起，天地一片昏黄！');
      enqueue(s, { id: makeEventId(s, 'SANDSTORM', tileId), kind: 'SANDSTORM', tileId });
    } else if (w === 'HEAT') {
      const cost = gameConfig.weather.heat.staminaCost;
      if (!emit) {
        pushLog(s, 'bad', `烈日炙烤（高温）：耐力 -${cost}。`);
        applyStaminaLoss(s, cost);
      } else {
        recordResult(
          s,
          {
            title: '沙漠高温',
            message: `烈日把沙子烤得发烫，硬走一天的代价是 ${cost} 点耐力。`,
            kind: 'bad',
            logText: `烈日炙烤（高温）：耐力 -${cost}。`,
          },
          () => {
            applyStaminaLoss(s, cost);
          },
        );
      }
    }
    return;
  }
  if (terrain === 'GRASS') {
    if (w === 'RAINSTORM') {
      if (s.tents.length > 0) {
        // 有帐篷 → 由玩家决定用哪一顶（或硬扛）；结算结果在事件解决时产生
        pushLog(s, 'bad', '草原暴雨倾盆而下！');
        enqueue(s, { id: makeEventId(s, 'RAINSTORM', tileId), kind: 'RAINSTORM', tileId });
      } else {
        const cost = gameConfig.weather.grassRain.staminaLossWithoutTent;
        if (!emit) {
          pushLog(s, 'bad', `暴雨倾盆而你无帐可依：耐力 -${cost}。`);
          applyStaminaLoss(s, cost);
        } else {
          recordResult(
            s,
            {
              title: '暴雨结算',
              message: '暴雨倾盆而下，而你无帐可依。你在雨中狼狈前行，体力受到严重消耗。',
              kind: 'bad',
              logText: `暴雨倾盆而你无帐可依：耐力 -${cost}。`,
            },
            () => {
              applyStaminaLoss(s, cost);
            },
          );
        }
      }
    } else if (w === 'MUD') {
      // 泥沼属于天气伤害（白白耗掉一整天）
      if (!emit) {
        pushLog(s, 'bad', '陷入泥沼，挣扎出来白白耗掉了一整天。');
        addDays(s, 1);
      } else {
        recordResult(
          s,
          {
            title: '陷入泥沼',
            message: '你陷进了泥沼，费力挣扎出来时，一整天已经过去了。',
            kind: 'bad',
            logText: '陷入泥沼，挣扎出来白白耗掉了一整天。',
            // 泥沼属于天气伤害：唯一的变化是「天数」，但仍然需要明确告诉玩家
            force: true,
          },
          () => {
            addDays(s, 1);
          },
        );
      }
    }
    return;
  }
  if (terrain === 'OASIS') {
    if (s.map.drought[tileId]) {
      pushLog(s, 'bad', '这里的绿洲已经干涸，只剩龟裂的泥地。');
    } else {
      pushLog(s, 'good', '清冽的绿洲——在此休整一天可以恢复 1 点耐力。');
    }
  }
}

function resolveArrivalEncounter(s: GameState, tileId: TileId): void {
  if (s.status !== 'ONGOING') return;
  const kind = pregeneratedEncounter(s.map, tileId);
  if (!kind || s.triggeredEncounters.includes(tileId)) return; // 每格每局最多一次
  s.triggeredEncounters.push(tileId);

  switch (kind) {
    case 'CARAVAN':
      pushLog(s, 'event', '一支商队从沙雾中走来，招呼你做笔买卖。');
      enqueue(s, { id: makeEventId(s, 'CARAVAN', tileId), kind: 'CARAVAN', tileId });
      break;
    case 'THIEF': {
      const stolen = Math.min(gameConfig.thiefStealMax, s.cash);
      pushLog(s, 'bad', `盗贼夜袭！被抢走 ${stolen} 元。你可以追回，但要花上一整天。`);
      enqueue(s, { id: makeEventId(s, 'THIEF', tileId), kind: 'THIEF', tileId, stolen });
      break;
    }
    case 'MARKET':
      pushLog(s, 'event', '村里正逢繁荣市集，货物齐全、价格公道。');
      enqueue(s, { id: makeEventId(s, 'MARKET', tileId), kind: 'MARKET', tileId });
      break;
    case 'HERDSMAN': {
      const revealed = revealIntelAround(s, tileId);
      if (revealed.length > 0) {
        const names = revealed.map((id) => {
          const t = s.map.tiles[id];
          return `(${t.row},${t.col})${terrainBadge(t.terrain)}`;
        });
        recordResult(s, {
          title: '路遇牧民',
          message: `热心的牧民指点了周边地形：${names.join('、')}。`,
          kind: 'good',
          force: true,
        });
      } else {
        recordResult(s, {
          title: '路遇牧民',
          message: '你遇到了牧民，但周边地形你都已了然。',
          kind: 'info',
          force: true,
        });
      }
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* 回合收尾：路线可行性与提前判负                                          */
/* ------------------------------------------------------------------ */

function checkRouteViability(s: GameState): void {
  if (s.status !== 'ONGOING') return;
  if (s.phase === 'RETURN' && !hasLegalReturnPath(s)) {
    defeat(s, 'RETURN_ROUTE_SEVERED', '返程路线已被切断：当前已不存在符合"去程与返程不得重复普通格"规则的返城路线。');
    return;
  }
  if (s.phase === 'OUTBOUND' && isNormalTile(s.map, s.position) && getLegalMoves(s).length === 0) {
    defeat(s, 'TRAPPED', '去程路线中断：四周都是你走过的脚印，进退无路。');
    return;
  }
  // v0.1.2a 提前判负：数学上已不可能完成旅程时立即结束，不让玩家玩死局
  const verdict = evaluateViability(s);
  if (!verdict.ok) {
    if (verdict.reason === 'NO_LEGAL_ROUTE') {
      defeat(
        s,
        'NO_LEGAL_ROUTE',
        s.phase === 'OUTBOUND'
          ? '远征路线已被切断：以当前足迹，已不存在任何合法抵达矿区并返城的路线。'
          : '返程路线已被切断：当前已不存在符合"去程与返程不得重复普通格"规则的返城路线。',
      );
    } else {
      defeat(
        s,
        'INSUFFICIENT_TIME',
        '无法按时完成远征：根据当前剩余时间与已经使用的路线，本局已经无法在时限内合法完成旅程。',
      );
    }
  }
}

function finalizeTurn(s: GameState): void {
  if (s.status !== 'ONGOING') return;
  checkRouteViability(s);
}

/* ------------------------------------------------------------------ */
/* 行动                                                                */
/* ------------------------------------------------------------------ */

export function getAvailableActions(state: GameState): ActionInfo[] {
  if (state.status !== 'ONGOING') return [];
  const actions: ActionInfo[] = [];
  const tile = state.map.tiles[state.position];
  /** 宿营类行为（野外/矿区/绿洲停留与修整）是否需要帐篷 */
  const needsTentHere =
    tile.terrain !== 'CITY' && tile.terrain !== 'VILLAGE' ? true : false;
  const hasTent = state.tents.length > 0;
  const addWait = () => actions.push(waitActionInfo(state, needsTentHere, hasTent));

  if (state.phase === 'MINING') {
    actions.push({
      action: { type: 'MINE' },
      label: `挖矿（+${gameConfig.gemPerMiningDay}kg 宝石）`,
      hint: '消耗 1 天。矿区安全，无天气与耐力消耗，不消耗帐篷。',
    });
    actions.push({
      action: { type: 'START_RETURN' },
      label: '停止挖矿，开始返程',
      hint: '不消耗时间。返程不能经过去程走过的格子。',
    });
    // 矿区原地等待 = 野外宿营（需要帐篷）
    addWait();
  }

  if (tile.terrain === 'OASIS' && (state.phase === 'OUTBOUND' || state.phase === 'RETURN')) {
    const drought = state.map.drought[state.position];
    const used = !!state.oasisRestUsed[state.position];
    const full = state.stamina >= gameConfig.maxStamina;
    let disabled = false;
    let reason: string | undefined;
    if (drought) {
      disabled = true;
      reason = '这片绿洲已经干涸，无法修整';
    } else if (used) {
      disabled = true;
      reason = '每个绿洲每局只能有效修整一次';
    } else if (full) {
      disabled = true;
      reason = '耐力已满';
    } else if (!hasTent) {
      disabled = true;
      reason = '修整需要正常宿营：没有帐篷';
    }
    actions.push({
      action: { type: 'REST' },
      label: '绿洲修整（+1 耐力）',
      hint: `消耗 1 天；修整需要宿营：${hasTent ? '需选择一顶帐篷（耐久 -1）' : '需要帐篷'}。`,
      disabled,
      disabledReason: reason,
      needsTent: true,
    });
    // 绿洲也允许普通停留（不恢复耐力）
    addWait();
  }

  if (tile.terrain === 'CITY' || tile.terrain === 'VILLAGE') {
    const discount = state.visitDiscount && tile.terrain === 'VILLAGE';
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
    // 城市/村庄免费等待（安全住宿点，不消耗帐篷）
    addWait();
  }

  // 天气预报包（v0.1.3 现金计价：cash -= packPrice；最大旅程天数不变）
  const forecastPrice = gameConfig.forecast.packPrice;
  const forecastPack = gameConfig.forecast.chargesPerPack;
  const forecastAuto = gameConfig.forecast.autoUseOnPurchase;
  const canAffordForecast = state.cash >= forecastPrice;
  actions.push({
    action: { type: 'BUY_FORECAST_PACK' },
    label: `购买天气预报包（${forecastPrice} 元）`,
    price: forecastPrice,
    hint: `获得 ${forecastPack} 次预报并立即使用 ${forecastAuto} 次（显示明天：当前格+邻域）。只预测自然天气，无法预测人为事件。不消耗天数。`,
    disabled: !canAffordForecast,
    disabledReason: !canAffordForecast ? '资金不足' : undefined,
  });
  // 手动使用储存的预报
  actions.push({
    action: { type: 'USE_FORECAST' },
    label: `使用天气预报（剩余 ${state.forecastCharges} 次）`,
    hint: '不消耗天数与金钱。显示明天的当前格+邻域天气。',
    disabled: state.forecastCharges <= 0,
    disabledReason: state.forecastCharges <= 0 ? '没有剩余预报次数' : undefined,
  });

  // 原地停留（仅在尚未提供过 WAIT 的场合补充：野外 OUTBOUND/RETURN）
  if (
    (state.phase === 'OUTBOUND' || state.phase === 'RETURN') &&
    !actions.some((a) => a.action.type === 'WAIT')
  ) {
    addWait();
  }

  return actions;
}

/** 构造「原地停留」行动描述：城市/村庄免费；野外/矿区/绿洲需帐篷宿营 */
function waitActionInfo(_state: GameState, needsTent: boolean, hasTent: boolean): ActionInfo {
  const camping = needsTent;
  const disabled = camping && !hasTent;
  return {
    action: { type: 'WAIT' },
    label: camping ? '原地宿营 1 天（帐篷耐久 -1）' : '原地停留 1 天',
    hint: camping
      ? hasTent
        ? '野外宿营：消耗 1 天并选择一顶帐篷（耐久 -1）。当天天气仍会正常结算。'
        : '野外宿营需要帐篷；没有帐篷不能在野外停留。'
      : '安全地点：不需要帐篷，不产生收益。每天仍正常消耗时间。',
    disabled,
    disabledReason: disabled ? '野外宿营需要帐篷' : undefined,
    needsTent: camping && hasTent,
  };
}

/** 校验宿营帐篷选择，返回合法的 TentId（不合法直接抛 GameError） */
function assertCampTent(state: GameState, tentId: TentId | undefined, actionName: string): TentId {
  if (state.tents.length === 0) {
    throw new GameError('NO_TENT_CAMP', `${actionName}需要帐篷，而你没有帐篷`);
  }
  if (tentId === undefined || typeof tentId !== 'string' || tentId === '') {
    throw new GameError('TENT_REQUIRED', `${actionName}必须先选择一顶具体帐篷`);
  }
  if (!state.tents.some((t) => t.id === tentId)) {
    throw new GameError('TENT_NOT_FOUND', `${actionName}指定的帐篷 ${tentId} 不存在（可能已被消耗或报废）`);
  }
  return tentId;
}

export function performAction(state: GameState, action: GameAction): GameState {
  assertFreeToAct(state);
  const s = clone(state);
  const tile = s.map.tiles[s.position];

  switch (action.type) {
    case 'MINE': {
      if (s.phase !== 'MINING') throw new GameError('NOT_MINING', '只有在矿区入口才能挖矿');
      recordResult(
        s,
        {
          title: '挖矿收获',
          message: `你在矿脉中劳作一整天，敲下 ${gameConfig.gemPerMiningDay}kg 宝石。`,
          kind: 'good',
          logText: `在矿脉中劳作一整天，收获 ${gameConfig.gemPerMiningDay}kg 宝石。`,
        },
        () => {
          if (!addDays(s, 1)) return;
          s.stats.miningDays += 1;
          s.gemsKg += gameConfig.gemPerMiningDay;
        },
      );
      finalizeTurn(s);
      return s;
    }
    case 'START_RETURN': {
      if (s.phase !== 'MINING') throw new GameError('NOT_MINING', '只有采矿阶段可以开始返程');
      s.phase = 'RETURN';
      s.stats.returnStartDay = s.daysUsed;
      if (s.mineEntranceId) s.visitedReturn.push(s.mineEntranceId);
      pushLog(s, 'event', `你背起 ${s.gemsKg}kg 宝石，从 Mine ${s.map.tiles[s.mineEntranceId ?? s.position].mineSlot} 踏上归途。返程不能重复去程走过的格子！`);
      if (!hasLegalReturnPath(s)) {
        defeat(s, 'RETURN_ROUTE_SEVERED', '返程路线中断：不存在任何合法回城路线。');
      }
      return s;
    }
    case 'REST': {
      if (tile.terrain !== 'OASIS') throw new GameError('NOT_OASIS', '只有绿洲可以修整');
      if (s.map.drought[s.position]) throw new GameError('OASIS_DRY', '这片绿洲已经干涸，无法修整');
      if (s.oasisRestUsed[s.position]) throw new GameError('OASIS_USED', '每个绿洲每局只能有效修整一次');
      if (s.stamina >= gameConfig.maxStamina) throw new GameError('STAMINA_FULL', '耐力已满');
      // v0.1.2a：修整需要正常宿营——必须消耗一顶指定帐篷的 1 点耐久
      const tentId = assertCampTent(s, action.tentId, '绿洲修整');
      recordResult(
        s,
        {
          title: '绿洲修整完成',
          message: '你在绿洲边扎营休整，喝饱了水，体力恢复了一些。',
          kind: 'good',
          logText: `在绿洲修整一天（宿营消耗 ${tentName(tentId)} 1 点耐久）。`,
        },
        () => {
          if (!addDays(s, 1)) return;
          s.tents = consumeTentCharge(s.tents, tentId);
          s.oasisRestUsed[s.position] = true;
          s.stamina = Math.min(gameConfig.maxStamina, s.stamina + 1);
        },
      );
      finalizeTurn(s);
      return s;
    }
    case 'BUY': {
      if (tile.terrain !== 'CITY' && tile.terrain !== 'VILLAGE') {
        throw new GameError('NO_SHOP', '只有城市与村庄可以购买装备');
      }
      if (!action.item) throw new GameError('BAD_ACTION', '缺少购买物品');
      const discount = s.visitDiscount && tile.terrain === 'VILLAGE';
      const price =
        action.item === 'tent'
          ? discount
            ? gameConfig.marketDiscountTentPrice
            : gameConfig.tentPrice
          : discount
            ? gameConfig.marketDiscountCompassPrice
            : gameConfig.compassPrice;
      if (s.cash < price) throw new GameError('NO_CASH', '现金不足');
      const itemName = action.item === 'tent' ? '一顶帐篷' : '一只指南针';
      recordResult(
        s,
        {
          title: '购买完成',
          message: `你买下了${itemName}${discount ? '（市集八折）' : ''}。`,
          kind: 'info',
          logText: `购买${itemName}（-${price} 元，${discount ? '市集八折' : '原价'}）。`,
        },
        () => {
          s.cash -= price;
          s.equipmentSpent += price;
          if (action.item === 'tent') {
            mintTent(s);
          } else {
            s.compasses += 1;
          }
        },
      );
      return s; // 购买不消耗时间
    }
    case 'BUY_FORECAST_PACK': {
      // v0.1.3 现金计价：唯一成本是 packPrice 元现金；maxDays 完全不受影响。
      const price = gameConfig.forecast.packPrice;
      if (s.cash < price) {
        throw new GameError(
          'NO_CASH',
          `资金不足：购买天气预报包需要 ${price} 元，你只有 ${s.cash} 元。`,
        );
      }
      const pack = gameConfig.forecast.chargesPerPack;
      const auto = gameConfig.forecast.autoUseOnPurchase;
      const remaining = s.forecastCharges + pack - auto;
      recordResult(
        s,
        {
          title: '天气预报已购买',
          message: `支付 ${price} 元买下天气预报包，获得 ${pack} 次天气观测，其中 ${auto} 次已自动使用。`,
          kind: 'info',
          logText: `购买天气预报包（-${price} 元），获得 ${pack} 次并自动使用 ${auto} 次，剩余 ${remaining} 次。`,
        },
        () => {
          s.cash -= price;
          s.forecastSpent += price;
          s.stats.forecastPacks += 1;
          s.stats.forecastChargesGranted += pack;
          s.forecastCharges += pack;
          s.forecastCharges -= auto;
          s.stats.forecastChargesUsed += auto;
          s.lastForecast = buildForecastView(s);
        },
      );
      return s; // 现金支付，不消耗当天
    }
    case 'USE_FORECAST': {
      if (s.forecastCharges <= 0) throw new GameError('NO_FORECAST', '没有剩余预报次数');
      recordResult(
        s,
        {
          title: '天气预报已使用',
          message: '观测完成：明天当前格与邻域的天气已经记录下来了。',
          kind: 'info',
          logText: `观测完成：明天（第 ${s.daysUsed + 1} 天）当前格与邻域的天气已记录。`,
        },
        () => {
          s.forecastCharges -= 1;
          s.stats.forecastChargesUsed += 1;
          s.lastForecast = buildForecastView(s);
        },
      );
      return s; // 成本已在购买时支付
    }
    case 'WAIT': {
      if (s.phase !== 'OUTBOUND' && s.phase !== 'RETURN' && s.phase !== 'MINING') {
        throw new GameError('BAD_PHASE', '当前阶段不能原地停留');
      }
      const terrain = s.map.tiles[s.position].terrain;
      // v0.1.2a：城市/村庄为安全住宿点（免费）；野外/矿区/绿洲宿营必须消耗帐篷
      if (terrain !== 'CITY' && terrain !== 'VILLAGE') {
        const tentId = assertCampTent(s, action.tentId, '野外宿营');
        recordResult(
          s,
          {
            title: '野外宿营完成',
            message: `你在野外扎营过夜，${tentName(tentId)} 替你挡了一夜风沙。`,
            kind: 'info',
            logText: `原地宿营一天（${tentName(tentId)} 耐久 -1）。当天天气：${weatherNames[getWeatherForDay(s, s.position, s.daysUsed + 1)]}。`,
          },
          () => {
            s.tents = consumeTentCharge(s.tents, tentId);
            if (!addDays(s, 1)) return;
            // 停留日的天气仍正常结算（不触发遭遇、不刷新探索、不自动恢复）；
            // 其结果并入本次宿营的综合结果，不再单独弹第二个弹窗。
            resolveTileWeather(s, s.position, s.daysUsed, false);
          },
        );
      } else {
        // 安全地点停留只推进时间，没有其它资源变化 → 不打扰玩家（只更新 HUD 与日志）
        recordResult(
          s,
          {
            title: '原地停留',
            message: `你在${terrain === 'CITY' ? '城市' : '村庄'}安心停留了一天。`,
            kind: 'info',
            logText: `在${terrain === 'CITY' ? '城市' : '村庄'}安心停留一天（无需帐篷）。`,
          },
          () => {
            addDays(s, 1);
          },
        );
      }
      if (s.status === 'ONGOING' && s.pendingEvents.length === 0) {
        finalizeTurn(s);
      }
      return s;
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
      const { useTent, useCompass, tentId } = choice;
      if (useTent && s.tents.length === 0) throw new GameError('NO_TENT', '没有帐篷');
      if (useCompass && s.compasses === 0) throw new GameError('NO_COMPASS', '没有指南针');
      if (useTent) assertCampTent(s, tentId, '沙尘暴');
      const message = useTent
        ? useCompass
          ? `${tentName(tentId!)} 挡住了狂沙，指南针指明了方向——你和商队安全穿过了风暴。`
          : `${tentName(tentId!)} 挡住了狂风，但在昏黄的风沙里迷失了方向，白白多走一天。`
        : useCompass
          ? '没有帐篷遮蔽，你眯着眼靠指南针辨认方向，硬扛着穿过了风沙。'
          : '无帐无针，你和商队在沙暴里狼狈挣扎，还彻底迷了路。';
      recordResult(
        s,
        {
          title: '沙尘暴结算',
          message,
          kind: useTent ? 'info' : 'bad',
          logText: useTent
            ? `${tentName(tentId!)} 挡住沙暴（耐久 -1）${useCompass ? '，指南针指明方向。' : '，但迷失方向额外损失 1 天。'}`
            : `没有帐篷遮蔽${useCompass ? '，靠指南针辨认方向' : '，且迷失方向额外损失 1 天'}。`,
        },
        () => {
          applySandstorm(s, useTent, useCompass, tentId);
        },
      );
      break;
    }
    case 'RAINSTORM': {
      if (choice.kind !== 'RAINSTORM') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.useTent) {
        if (s.tents.length === 0) throw new GameError('NO_TENT', '没有帐篷');
        const tentId = assertCampTent(s, choice.tentId, '暴雨');
        recordResult(
          s,
          {
            title: '暴雨结算',
            message: `你钻进 ${tentName(tentId)} 躲过了暴雨。体力没受影响，但这顶帐篷已经被彻底淋透，再也用不了了。`,
            kind: 'bad',
            logText: `${tentName(tentId)} 替你硬扛暴雨：帐篷整体报废，体力无损。`,
          },
          () => {
            s.tents = consumeTentForRainstorm(s.tents, tentId);
          },
        );
      } else {
        const cost = gameConfig.weather.grassRain.staminaLossWithoutTent;
        recordResult(
          s,
          {
            title: '暴雨结算',
            message: '你在暴雨中狼狈前行，体力受到严重消耗。',
            kind: 'bad',
            logText: `你冒雨赶路：耐力 -${cost}。`,
          },
          () => {
            applyStaminaLoss(s, cost);
          },
        );
      }
      break;
    }
    case 'CARAVAN': {
      if (choice.kind !== 'CARAVAN') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'BUY_TENT') {
        if (s.cash < gameConfig.caravanTentPrice) throw new GameError('NO_CASH', '现金不足，无法购买二手帐篷');
        recordResult(
          s,
          {
            title: '商队交易完成',
            message: `你用 ${gameConfig.caravanTentPrice} 元从商队换来一顶二手帐篷。`,
            kind: 'info',
            logText: `从商队购入一顶二手帐篷（-${gameConfig.caravanTentPrice} 元）。`,
          },
          () => {
            s.cash -= gameConfig.caravanTentPrice;
            s.equipmentSpent += gameConfig.caravanTentPrice;
            mintTent(s, gameConfig.caravanTentCharges);
          },
        );
      } else {
        const revealed = revealIntelAround(s, current.tileId);
        const names = revealed.map((id) => {
          const t = s.map.tiles[id];
          return `(${t.row},${t.col})${terrainBadge(t.terrain)}`;
        });
        recordResult(s, {
          title: '商队情报',
          message:
            revealed.length > 0
              ? `商队头人摊开地图，为你指点周边地形：${names.join('、')}。`
              : '商队告诉你：周边的地形你都已经知道了。',
          kind: revealed.length > 0 ? 'good' : 'info',
          force: true,
        });
      }
      break;
    }
    case 'THIEF': {
      if (choice.kind !== 'THIEF') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'GIVE_UP') {
        recordResult(
          s,
          {
            title: '盗贼夜袭',
            message: `你放弃了追逐，被抢走的 ${current.stolen} 元再也拿不回来了。`,
            kind: 'bad',
            logText: `放弃追逐，被抢走 ${current.stolen} 元。`,
          },
          () => {
            s.cash -= current.stolen;
          },
        );
      } else {
        recordResult(
          s,
          {
            title: '追回成功',
            message: `你追了出去，被偷的 ${current.stolen} 元分文不少地回到了口袋——代价是整整一天。`,
            kind: 'good',
            logText: `追回被偷的 ${current.stolen} 元（耗时 1 天）。`,
            // 唯一变化是「天数」，但这是玩家主动选择的结果，必须明确反馈
            force: true,
          },
          () => {
            addDays(s, 1);
          },
        );
      }
      break;
    }
    case 'MARKET': {
      if (choice.kind !== 'MARKET') throw new GameError('BAD_CHOICE', '选择类型不匹配');
      if (choice.action === 'TAKE_DISCOUNT') {
        recordResult(s, {
          title: '市集折扣到手',
          message: `你取得了市集商家的信任：本次停留期间帐篷 ${gameConfig.marketDiscountTentPrice} 元、指南针 ${gameConfig.marketDiscountCompassPrice} 元。`,
          kind: 'good',
          force: true,
        }, () => {
          s.visitDiscount = true;
        });
      } else {
        recordResult(
          s,
          {
            title: '市集打工',
            message: `你在市集帮工一整天，赚得 ${gameConfig.workPay} 元。`,
            kind: 'good',
            logText: `在市集帮工一整天，赚得 ${gameConfig.workPay} 元。`,
          },
          () => {
            if (!addDays(s, 1)) return;
            s.cash += gameConfig.workPay;
          },
        );
      }
      break;
    }
    default:
      throw new GameError('BAD_EVENT', '未知事件类型');
  }

  if (s.status === 'ONGOING' && s.pendingEvents.length === 0) {
    finalizeTurn(s);
  }
  return s;
}

/** 沙尘暴结算（纯状态变更；通知文本由 recordResult 统一生成，日志与弹窗同源） */
function applySandstorm(s: GameState, useTent: boolean, useCompass: boolean, tentId?: TentId): void {
  if (useTent) {
    s.tents = consumeTentCharge(s.tents, tentId);
    if (useCompass) {
      s.compasses -= 1;
    } else {
      addDays(s, 1);
    }
  } else {
    if (useCompass) {
      s.compasses -= 1;
      applyStaminaLoss(s, gameConfig.weather.sandstorm.staminaCost);
    } else {
      if (!applyStaminaLoss(s, gameConfig.weather.sandstorm.staminaCost)) return;
      addDays(s, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 天气预报视图（单日：当前格 + 8 邻域）                                  */
/* ------------------------------------------------------------------ */

/**
 * 天气预报视图（单日：当前格与其 8 邻域 = 标准 3×3 局部天气地图）。
 *
 * 每格都带 `dr` / `dc`（相对玩家的行/列偏移，取值 -1 / 0 / +1），
 * UI 依此把卡片放到固定的 3×3 位置：
 *
 *   (-1,-1) NW   (-1,0) N   (-1,+1) NE
 *   ( 0,-1) W    ( 0,0) C   ( 0,+1) E
 *   (+1,-1) SW   (+1,0) S   (+1,+1) SE
 *
 * 地图边界外的格子**直接不下发**（既不是 null 也不是占位），
 * 因此 UI 不需要、也不允许做"自动补位"。
 */
export function buildForecastView(s: GameState): ForecastView {
  const day = s.daysUsed + 1;
  const { row, col } = parseTileId(s.position);
  const radius = gameConfig.forecast.neighborhoodRadius;
  const cells: ForecastCell[] = [];
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius; c <= col + radius; c++) {
      if (r < 0 || r >= s.map.rows || c < 0 || c >= s.map.cols) continue;
      const id = tileIdOf(r, c);
      cells.push({
        tileId: id,
        row: r,
        col: c,
        dr: r - row,
        dc: c - col,
        isCurrent: id === s.position,
        terrainKnown: isTerrainKnown(s, id),
        weather: getWeatherForDay(s, id, day),
      });
    }
  }
  return { day, cells };
}

/** 路线风险评分的展示信息 */
export function getRouteSummary(state: GameState): string | null {
  if (state.routeScore === null) return null;
  return `路线风险评分 ${state.routeScore}（${starLabel(computeStarRating(state.routeScore))}）`;
}
