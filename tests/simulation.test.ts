import { describe, it, expect } from 'vitest';
import { createNewGame, performMove } from '../src/game';
import { gameConfig } from '../src/game/config/gameConfig';
import { buildFairView } from '../src/simulation/fairView';
import { runOne, runBatchSeeds, makeBotRng, type BotStrategy } from '../src/simulation/runner';
import { aggregateBot, aggregateEvents, aggregateNodeHeat, type RunResult } from '../src/simulation/metrics';
import { ALL_BOTS, BOT_BY_NAME, randomBot, northMineBot, southMineBot } from '../src/simulation/bots';
import { worldMap } from '../src/game/map/worldMap';
import { calmOverrides, walk } from './helpers';

describe('v0.1.1 固定矿区定价', () => {
  it('三个矿区入口价格固定：南 100 / 中 180 / 北 280', () => {
    expect(gameConfig.mineBasePrice.SOUTH).toBe(100);
    expect(gameConfig.mineBasePrice.CENTRAL).toBe(180);
    expect(gameConfig.mineBasePrice.NORTH).toBe(280);
    expect(gameConfig.marketEnabled).toBe(false);
  });

  it('Bot 仿真中进入任意矿区，价格恒等于固定价，与路线/Seed 无关', () => {
    const seeds = ['fix:1', 'fix:2', 'fix:3', 'fix:4', 'fix:5'];
    for (const bot of [southMineBot, BOT_BY_NAME['MiddleMineBot'], northMineBot]) {
      for (const seed of seeds) {
        const r = runOne(bot, seed);
        if (r.mineId === 'mineS') expect(r.gemPrice).toBe(100);
        if (r.mineId === 'mineC') expect(r.gemPrice).toBe(180);
        if (r.mineId === 'mineN') expect(r.gemPrice).toBe(280);
      }
    }
  });

  it('路线风险评分与售价解耦：同一矿区不同路线 → 同价不同分', () => {
    const straight = walk(createNewGame('decouple-sim', calmOverrides(worldMap)), ['sg1', 'sv', 'so', 'sg2', 'mineS']);
    const detour = walk(createNewGame('decouple-sim', calmOverrides(worldMap)), ['mg1', 'md1', 'mv', 'mo', 'mg2', 'mineS']);
    expect(straight.phase).toBe('MINING');
    expect(detour.phase).toBe('MINING');
    // 同为南矿区：售价相同（100），路线风险评分不同
    expect(straight.gemPrice).toBe(100);
    expect(detour.gemPrice).toBe(100);
    expect(straight.routeScore).not.toBeNull();
    expect(detour.routeScore).not.toBeNull();
    expect(detour.routeScore).not.toBe(straight.routeScore);
  });
});

describe('FairView 防作弊', () => {
  it('FairView 不暴露天气表 / 事件 roll 表 / RNG / 未抵达绿洲的干涸状态', () => {
    const state = createNewGame('fair-1');
    // 让玩家走到任意位置后构建视图
    const view = buildFairView(performMove(state, 'sg1'));
    const keys = Object.keys(view);
    expect(keys).not.toContain('weather');
    expect(keys).not.toContain('encounterRolls');
    expect(keys).not.toContain('rngState');
    expect(keys).not.toContain('oasisDrought');
    // 干涸状态只含亲自探索过的绿洲
    const oasisExplored = view.explored.filter((id) => worldMap.nodes[id].terrain === 'OASIS');
    expect(Object.keys(view.knownOasisDrought).sort()).toEqual([...oasisExplored].sort());
  });

  it('未知地形在 FairView 中为 null（战争迷雾），已知地形可见', () => {
    const state = createNewGame('fair-2');
    const view = buildFairView(state);
    expect(view.map.nodes['sv'].terrain).toBeNull(); // 未探索
    expect(view.map.nodes['city'].terrain).toBe('CITY'); // 开局可见
    expect(view.map.nodes['mineN'].terrain).toBe('MINE'); // 开局可见
    expect(view.map.nodes['mineN'].minePrice).toBe(280); // 公开固定价
    const after = buildFairView(performMove(state, 'sg1'));
    expect(after.map.nodes['sg1'].terrain).toBe('GRASS'); // 亲自抵达后揭示
    expect(after.map.nodes['sv'].terrain).toBeNull(); // 邻居仍未揭示
  });

  it('所有 Bot 决策过程不访问禁用信息（Proxy 访问记录）', () => {
    const FORBIDDEN = new Set(['weather', 'encounterRolls', 'rngState', 'oasisDrought']);
    const state = createNewGame('fair-proxy');
    const raw = buildFairView(performMove(state, 'sg1'));
    const accessed = new Set<string>();
    const proxy = new Proxy(raw, {
      get(target, prop) {
        accessed.add(String(prop));
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      },
    });
    const rng = makeBotRng('fair-proxy', 'probe');
    // 所有 Bot 对该视图做几步决策
    for (const bot of ALL_BOTS) {
      try {
        bot.decide(proxy, rng);
      } catch {
        // 某些 bot 在该视图下可能抛错（例如无路可走），只关心是否窥探禁用信息
      }
    }
    for (const f of FORBIDDEN) {
      expect(accessed.has(f), `Bot 访问了禁用字段: ${f}`).toBe(false);
    }
  });
});

describe('Bot 合法性与可复现性', () => {
  it('全部 Bot × 多 Seed：无运行错误、结果状态合法（Bot 只执行合法 Action）', () => {
    for (const bot of ALL_BOTS) {
      const results = runBatchSeeds(bot, ['legal:0', 'legal:1', 'legal:2', 'legal:3', 'legal:4'], 0);
      for (const r of results) {
        expect(r.error, `${bot.name} seed=${r.seed} 出错: ${r.error}`).toBeNull();
        expect(['VICTORY', 'DEFEAT']).toContain(r.status);
        expect(r.daysUsed).toBeLessThanOrEqual(46);
      }
    }
  }, 120_000);

  it('同 Seed + 同 Bot 完全可复现（含随机决策的 RandomBot）', () => {
    for (const bot of [randomBot, northMineBot]) {
      const a = runOne(bot, 'repro:sim');
      const b = runOne(bot, 'repro:sim');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('RandomBot 的随机流由局 Seed 派生（同 seed 同 rng 序列）', () => {
    const a = makeBotRng('rng-test', 'RandomBot');
    const b = makeBotRng('rng-test', 'RandomBot');
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
    expect(makeBotRng('other', 'RandomBot')()).not.toBe(a());
  });
});

describe('仿真统计正确性（合成数据）', () => {
  function fixture(): RunResult[] {
    const mk = (over: Partial<RunResult>): RunResult => ({
      seed: 'x',
      bot: 'T',
      status: 'VICTORY',
      defeatReason: null,
      error: null,
      mineId: 'mineS',
      routeScore: 10,
      daysUsed: 13,
      outboundDays: 5,
      miningDays: 2,
      returnDays: 6,
      forecastCount: 0,
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
    // EV = (400 + 600 + 200 - 500 - 400) / 5 = 60
    expect(s.evNetProfitAllRuns).toBe(60);
    // 胜局净收益均值 = (400+600+200)/3 = 400
    expect(s.avgNetProfitWins).toBe(400);
    // 胜局资产分布
    expect(s.finalAssetsWins.median).toBe(2400);
    expect(s.finalAssetsWins.min).toBe(2200);
    expect(s.finalAssetsWins.max).toBe(2600);
    expect(s.finalAssetsWins.p90).toBe(2600);
    expect(s.finalAssetsWins.p10).toBe(2200);
  });

  it('失败原因比例统计正确', () => {
    const s = aggregateBot(fixture());
    expect(s.failureRates.TIMEOUT).toBe(20);
    expect(s.failureRates.STAMINA_EXHAUSTED).toBe(20);
    expect(s.failureRates.RETURN_ROUTE_SEVERED).toBe(0);
    expect(s.failureRates.TRAPPED).toBe(0);
  });

  it('事件聚合：选项比例与平均影响正确', () => {
    const results = fixture();
    results[0].events.push({ kind: 'THIEF', choice: 'CHASE', dayDelta: 1, cashDelta: 0 });
    results[1].events.push({ kind: 'THIEF', choice: 'GIVE_UP', dayDelta: 0, cashDelta: -300 });
    const ev = aggregateEvents(results);
    const thief = ev.find((e) => e.kind === 'THIEF')!;
    expect(thief.count).toBe(2);
    expect(thief.choiceRates['CHASE']).toBe(50);
    expect(thief.choiceRates['GIVE_UP']).toBe(50);
    expect(thief.avgDayDelta).toBe(0.5);
    expect(thief.avgCashDelta).toBe(-150);
  });

  it('节点热度聚合正确', () => {
    const results = fixture();
    results[0].nodeVisits = { sg1: { out: 1, ret: 0 }, mineS: { out: 1, ret: 0 } };
    results[1].nodeVisits = { sg1: { out: 1, ret: 0 }, mg2: { out: 0, ret: 1 } };
    const heat = aggregateNodeHeat(results);
    const sg1 = heat.find((h) => h.nodeId === 'sg1')!;
    expect(sg1.outVisits).toBe(2);
    expect(sg1.retVisits).toBe(0);
    expect(sg1.runFraction).toBe(40); // 5 局中 2 局
  });
});

describe('矿区对照 Bot 的受控性', () => {
  it('三个矿区对照 Bot 到达各自的矿区且价格正确（对照实验有效性）', () => {
    const cases: Array<[BotStrategy, string, number]> = [
      [southMineBot, 'mineS', 100],
      [BOT_BY_NAME['MiddleMineBot'], 'mineC', 180],
      [northMineBot, 'mineN', 280],
    ];
    for (const [bot, mineId, price] of cases) {
      const r = runOne(bot, 'controlled:0');
      expect(r.error, `${bot.name} 出错: ${r.error}`).toBeNull();
      expect(r.mineId, `${bot.name} 应到达 ${mineId}`).toBe(mineId);
      expect(r.gemPrice).toBe(price);
    }
  }, 60_000);
});
