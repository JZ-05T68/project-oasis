import { describe, it, expect } from 'vitest';
import { createNewGame, performMove, performAction, resolvePendingEvent } from '../src/game';
import { buildFairView } from '../src/simulation/fairView';
import { runOne, runBatchSeeds, makeBotRng, type BotStrategy } from '../src/simulation/runner';
import { aggregateBot, aggregateEvents, aggregateNodeHeat, type RunResult } from '../src/simulation/metrics';
import { ALL_BOTS, randomBot, mineABot, mineBBot } from '../src/simulation/bots';
import { mkTents, TENT_A } from './helpers';
import { gameConfig } from '../src/game/config/gameConfig';

describe('v0.1.2 FairView 防作弊', () => {
  it('FairView 不暴露天气表 / 遭遇预生成表 / RNG / 未抵达绿洲的干涸状态', () => {
    const state = createNewGame('fair-1');
    const view = buildFairView(performMove(state, getLegalMovesOf(state)[0]));
    const keys = Object.keys(view);
    expect(keys).not.toContain('weather');
    expect(keys).not.toContain('encounters');
    expect(keys).not.toContain('rngState');
    expect(keys).not.toContain('oasisDrought');
    const oasisExplored = view.explored.filter((id) => state.map.tiles[id].terrain === 'OASIS');
    expect(Object.keys(view.knownOasisDrought).sort()).toEqual([...oasisExplored].sort());
  });

  it('未知地形在 FairView 中为 null（战争迷雾），矿区价格公开可见', () => {
    const state = createNewGame('fair-2');
    const view = buildFairView(state);
    const unknown = Object.values(view.map.tiles).find((t) => t.terrain === null)!;
    expect(unknown).toBeDefined();
    expect(view.map.tiles[state.map.cityId].terrain).toBe('CITY');
    for (const mine of view.map.mines) {
      expect(view.map.tiles[mine.tileId].terrain).toBe('MINE');
      expect(view.map.tiles[mine.tileId].minePrice).toBe(mine.gemPrice);
      expect(mine.gemPrice).toBeGreaterThanOrEqual(80);
      expect(mine.gemPrice).toBeLessThanOrEqual(320);
    }
  });

  it('所有 Bot 决策过程不访问禁用信息（Proxy 访问记录）', () => {
    const FORBIDDEN = new Set(['weather', 'encounters', 'rngState', 'oasisDrought', 'triggeredEncounters']);
    const state = createNewGame('fair-proxy');
    const raw = buildFairView(performMove(state, getLegalMovesOf(state)[0]));
    const accessed = new Set<string>();
    const proxy = new Proxy(raw, {
      get(target, prop) {
        accessed.add(String(prop));
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    });
    const rng = makeBotRng('fair-proxy', 'probe');
    for (const bot of ALL_BOTS) {
      try {
        bot.decide(proxy, rng);
      } catch {
        // 某 Bot 在该视图下可能无法决策，只关心是否窥探禁用信息
      }
    }
    for (const f of FORBIDDEN) {
      expect(accessed.has(f), `Bot 访问了禁用字段: ${f}`).toBe(false);
    }
  });
});

function getLegalMovesOf(state: Parameters<typeof performMove>[0]): string[] {
  const view = buildFairView(state);
  return view.legalMoves;
}

describe('Bot 合法性与可复现性', () => {
  it('全部 Bot × 多 Seed：无运行错误、结果状态合法（Bot 只执行合法 Action）', () => {
    const seeds = ['legal:0', 'legal:1', 'legal:2', 'legal:3', 'legal:4', 'legal:5'];
    for (const bot of ALL_BOTS) {
      const results = runBatchSeeds(bot, seeds, 0);
      for (const r of results) {
        expect(r.error, `${bot.name} seed=${r.seed} 出错: ${r.error}`).toBeNull();
        expect(['VICTORY', 'DEFEAT']).toContain(r.status);
        expect(r.daysUsed).toBeLessThanOrEqual(r.status === 'VICTORY' ? 46 : 50);
      }
    }
  }, 300_000);

  it('同 Seed + 同 Bot 完全可复现（含随机决策的 RandomBot）', () => {
    for (const bot of [randomBot, mineABot]) {
      const a = runOne(bot, 'repro:v012');
      const b = runOne(bot, 'repro:v012');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('RandomBot 的随机流由局 Seed 派生', () => {
    const a = makeBotRng('rng-test', 'RandomBot');
    const b = makeBotRng('rng-test', 'RandomBot');
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('矿区对照 Bot 到达各自的矿区且价格与地图情报一致', () => {
    const cases: Array<[BotStrategy, 'A' | 'B']> = [
      [mineABot, 'A'],
      [mineBBot, 'B'],
    ];
    let checked = 0;
    for (const [bot, slot] of cases) {
      for (const seed of ['controlled:v012', 'controlled:v012b', 'controlled:v012c', 'controlled:v012d']) {
        const r = runOne(bot, seed);
        expect(r.error, `${bot.name} seed=${seed} 出错: ${r.error}`).toBeNull();
        if (r.mineId === null) continue; // 途中失败（天气/事件）属正常对局
        // 只要真的进了矿，就必然是 Bot 指定的那个矿区
        const map = createNewGame(r.seed).map;
        const mine = map.mines.find((m) => m.tileId === r.mineId)!;
        expect(mine.slot).toBe(slot);
        if (r.gemPrice === null) continue; // 没回城 → 单价不公布（v0.1.2a 最终鉴定）
        // 价格 = 地图上该矿区的公开评估价（通过重建同 Seed 地图核对）
        expect(r.gemPrice).toBe(mine.gemPrice);
        checked += 1;
      }
    }
    // 至少有一次成功返城鉴定，避免测试空转
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('玩家行为不能刷矿价：绕路/受伤不会改变地图评估价', () => {
    // 同 Seed：无论 Bot 采取什么路线/遭遇什么，成交价 == 开局评估价
    for (const bot of ALL_BOTS) {
      const r = runOne(bot, 'price-fair:v012');
      if (r.mineId && r.gemPrice !== null) {
        const map = createNewGame(r.seed).map;
        const mine = map.mines.find((m) => m.tileId === r.mineId)!;
        expect(r.gemPrice).toBe(mine.gemPrice);
      }
    }
  }, 240_000);
});

describe('仿真统计正确性（合成数据）', () => {
  function fixture(): RunResult[] {
    const mk = (over: Partial<RunResult>): RunResult => ({
      seed: 'x',
      bot: 'T',
      status: 'VICTORY',
      defeatReason: null,
      error: null,
      mineId: '0:8',
      mineDifficulty: 40,
      mineJitter: 1,
      routeScore: 10,
      daysUsed: 13,
      outboundDays: 5,
      miningDays: 2,
      returnDays: 6,
      forecastPacks: 0,
      gemsKg: 4,
      gemPrice: 100,
      gemRevenue: 400,
      equipmentSpent: 0,
      cashRemaining: 2000,
      finalAssets: 2400,
      netProfit: 400,
      tentsBought: 0,
      compassesBought: 0,
      tentUses: 0,
      compassUses: 0,
      tentsChargesLeft: 0,
      compassesLeft: 0,
      events: [],
      nodeVisits: {},
      edgeUses: {},
      ...over,
    });
    return [
      mk({ seed: 'a', finalAssets: 2400, netProfit: 400 }),
      mk({ seed: 'b', finalAssets: 2600, netProfit: 600 }),
      mk({ seed: 'c', finalAssets: 2200, netProfit: 200 }),
      mk({ seed: 'd', status: 'DEFEAT', defeatReason: 'TIMEOUT', finalAssets: 1500, netProfit: -500, gemRevenue: 0, miningDays: 0 }),
      mk({ seed: 'e', status: 'DEFEAT', defeatReason: 'STAMINA_EXHAUSTED', finalAssets: 1600, netProfit: -400, gemRevenue: 0, miningDays: 0 }),
    ];
  }

  it('胜率、EV、分位数计算正确', () => {
    const s = aggregateBot(fixture());
    expect(s.runs).toBe(5);
    expect(s.wins).toBe(3);
    expect(s.winRate).toBe(60);
    expect(s.evNetProfitAllRuns).toBe(60);
    expect(s.avgNetProfitWins).toBe(400);
    expect(s.finalAssetsWins.median).toBe(2400);
    expect(s.finalAssetsWins.max).toBe(2600);
  });

  it('失败原因比例统计正确', () => {
    const s = aggregateBot(fixture());
    expect(s.failureRates.TIMEOUT).toBe(20);
    expect(s.failureRates.STAMINA_EXHAUSTED).toBe(20);
    expect(s.failureRates.RETURN_ROUTE_SEVERED).toBe(0);
  });

  it('事件聚合正确', () => {
    const results = fixture();
    results[0].events.push({ kind: 'THIEF', choice: 'CHASE', dayDelta: 1, cashDelta: 0 });
    results[1].events.push({ kind: 'THIEF', choice: 'GIVE_UP', dayDelta: 0, cashDelta: -300 });
    const ev = aggregateEvents(results);
    const thief = ev.find((e) => e.kind === 'THIEF')!;
    expect(thief.count).toBe(2);
    expect(thief.choiceRates['CHASE']).toBe(50);
    expect(thief.avgCashDelta).toBe(-150);
  });

  it('节点热度聚合正确', () => {
    const results = fixture();
    results[0].nodeVisits = { '7:0': { out: 1, ret: 0 }, '0:8': { out: 1, ret: 0 } };
    results[1].nodeVisits = { '7:0': { out: 1, ret: 0 }, '5:6': { out: 0, ret: 1 } };
    const heat = aggregateNodeHeat(results);
    const city = heat.find((h) => h.nodeId === '7:0')!;
    expect(city.outVisits).toBe(2);
    expect(city.runFraction).toBe(40);
  });
});

describe('引擎直接行为抽查（仿真等价路径）', () => {
  it('买预报包 + 使用 + 宿营 组合行为', () => {
    let s = newGameCalm('combo-v012');
    s = performAction(s, { type: 'BUY_FORECAST_PACK' });
    expect(s.maxDays).toBe(gameConfig.maxDays - 1);
    expect(s.forecastCharges).toBe(gameConfig.forecast.chargesPerPack - gameConfig.forecast.autoUseOnPurchase);
    s = performAction(s, { type: 'USE_FORECAST' });
    expect(s.forecastCharges).toBe(
      gameConfig.forecast.chargesPerPack - gameConfig.forecast.autoUseOnPurchase - 1,
    );
    s = mutate(s, (m) => {
      m.tents = mkTents([3]); // 野外宿营需要帐篷
    });
    const legal = buildFairView(s).legalMoves;
    s = performMove(s, legal[0]);
    s = performAction(s, { type: 'WAIT', tentId: TENT_A });
    expect(s.daysUsed).toBe(2);
  });

  it('遭遇每格一次 + 预生成（引擎状态一致性）', () => {
    let s = createNewGame('enc-pregen');
    const view = buildFairView(s);
    expect(view.map.mines.length).toBe(2);
    // 触发过的遭遇不会重复
    const legal = view.legalMoves[0];
    s = mutate(s, (m) => {
      m.map.encounters[legal] = 'CARAVAN';
    });
    s = performMove(s, legal);
    if (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      s = resolvePendingEvent(s, ev.id, { kind: 'CARAVAN', action: 'TAKE_INTEL' });
    }
    expect(s.triggeredEncounters).toContain(legal);
  });
});

function mutate(state: ReturnType<typeof createNewGame>, fn: (s: ReturnType<typeof createNewGame>) => void): ReturnType<typeof createNewGame> {
  const s = structuredClone(state);
  fn(s);
  return s;
}

/** 无天气/遭遇干扰的确定对局 */
function newGameCalm(seed: string): ReturnType<typeof createNewGame> {
  const base = createNewGame(seed);
  const weather: Record<string, string[]> = {};
  const encounters: Record<string, null> = {};
  const drought: Record<string, boolean> = {};
  for (const id of Object.keys(base.map.tiles)) {
    weather[id] = new Array(46).fill('SUNNY');
    encounters[id] = null;
    drought[id] = false;
  }
  const s = structuredClone(base);
  s.map.weather = weather as typeof s.map.weather;
  s.map.encounters = encounters;
  s.map.drought = drought;
  return s;
}
