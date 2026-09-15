/**
 * 诊断：求援机制到底有没有机会被触发？Bot 有没有真的用上？
 *
 * sim-balance-lab 陷阱 A：在得出"机制不行"之前，必须先证明 Bot 把机制用到了极致。
 * 本脚本逐局逐回合统计三类量：
 *   1) 引擎层面：EMERGENCY_RESCUE 这个 Action 有多少个回合是 enabled 的（机会数）
 *   2) 触发条件：timeTight / staminaLow 各出现多少回合
 *   3) Bot 层面：Bot 实际执行了多少次求援、为什么放弃
 */
import { createNewGame, performAction, performMove, resolvePendingEvent } from '../../src/game';
import { buildFairView } from '../../src/simulation/fairView';
import { econBot } from '../../src/simulation/bots/econBots';
import { eventChoice, botTentId, plannedPurchase, wantsRest, planOutboundStep } from '../../src/simulation/bots/utils';
import { dropDecision, planLoadAwareReturnStep } from '../../src/simulation/bots/mechanismBots';
import { minReturnCostLoadAware, minReturnDays } from '../../src/simulation/simGraph';
import type { GameAction } from '../../src/game/types';
import type { BotDecision, BotRng } from '../../src/simulation/runner';
import type { FairView } from '../../src/simulation/fairView';

const N = Number(process.argv[2] ?? 60);
const PREFIX = process.argv[3] ?? 'econ-train';

const equip = { wantTents: 2, wantCompasses: 2, cashReserve: 0 };
let opportunities = 0;
let timeTightTurns = 0;
let staminaLowTurns = 0;
let executed = 0;
let guardedNoSave = 0;
let evDeclined = 0;
let runsWithOpp = 0;
const samples: string[] = [];
let phases: Record<string, number> = {};

const bot = econBot('EconMasterBot')!;
const decide = bot.decide;

const inner = (view: FairView, rng: BotRng): BotDecision => {
  if (view.pendingEvent) {
    const c = eventChoice(view, 'default');
    if (c) return { type: 'EVENT', choice: c };
  }
  const purchase = plannedPurchase(view, equip);
  if (purchase) return { type: 'ACTION', action: purchase.action };
  if (wantsRest(view)) return { type: 'ACTION', action: { type: 'REST', tentId: botTentId(view) } };
  return { type: 'MOVE', toTileId: view.phase === 'OUTBOUND' ? planOutboundStep(view, { kind: 'NEAREST' }, 'SHORTEST', rng) : planLoadAwareReturnStep(view, 'SHORTEST') };
};

for (let i = 0; i < N; i++) {
  const seed = `${PREFIX}:${i}`;
  let state = createNewGame(seed);
  let s = 0;
  const rng = (() => { let v = 0.5; return () => (v = (v * 9301 + 49297) % 233280 / 233280); })();
  let oppThisRun = 0;
  let turns = 0;
  while (state.status === 'ONGOING' && turns++ < 500) {
    const view = buildFairView(state);
    const cfg = view.rules.emergencyRescue;
    const eta = cfg.expectedReturnDays;
    const daysLeft = view.daysRemaining;
    const tt = daysLeft - eta < cfg.triggerMarginDays;
    const sl = view.stamina <= 2;
    if (tt) timeTightTurns += 1;
    if (sl) staminaLowTurns += 1;
    const act = view.availableActions.find((a) => a.action.type === 'EMERGENCY_RESCUE');
    if (act && !act.disabled) {
      opportunities += 1;
      oppThisRun += 1;
      phases[view.phase] = (phases[view.phase] ?? 0) + 1;
      // 复算 Bot 的守卫条件
      const returnCost = minReturnCostLoadAware(view) ?? minReturnDays(view) ?? eta;
      if (daysLeft + cfg.extraDays - returnCost < 0) guardedNoSave += 1;
      if (samples.length < 8) {
        const gross = Math.round(view.gemsKg * (view.gemPrice ?? 0));
        const slackReal = daysLeft - returnCost;
        let p0 = Math.max(0.05, Math.min(0.92, 0.5 + 0.15 * slackReal));
        if (view.stamina <= 1) p0 *= 0.5;
        const p1 = Math.min(0.96, p0 + 0.35);
        const fee = view.rules.rescueSettlement.enabled
          ? Math.max(0, Math.round(view.rules.rescueSettlement.deferredDebt)) +
            Math.max(0, Math.round(view.rules.rescueSettlement.revenueShare * gross))
          : 0;
        samples.push(
          `seed=${seed} phase=${view.phase} day=${view.day}/${view.maxDays} gems=${view.gemsKg} price=${view.gemPrice} ` +
          `gross=${gross} eta=${eta} retCost=${returnCost} slackReal=${slackReal} stam=${view.stamina} ` +
          `p0=${p0.toFixed(2)} p1=${p1.toFixed(2)} fee=${fee} imm=${cfg.cost} ` +
          `evR=${(p1 * (gross - fee - cfg.cost)).toFixed(0)} evN=${(p0 * gross).toFixed(0)}`,
        );
      }
    }
    let d: BotDecision;
    try {
      d = decide(view, rng);
    } catch {
      d = inner(view, rng);
    }
    if (d.type === 'ACTION' && (d.action as GameAction).type === 'EMERGENCY_RESCUE') {
      executed += 1;
      if (act && act.disabled) evDeclined += 1;
    }
    if (d.type === 'MOVE') state = performMove(state, d.toTileId);
    else if (d.type === 'ACTION') state = performAction(state, d.action);
    else {
      const ev = state.pendingEvents[0];
      if (ev) state = resolvePendingEvent(state, ev.id, d.choice);
    }
    s += 1;
  }
  if (oppThisRun > 0) runsWithOpp += 1;
  void s;
}

console.log(`样本 ${N} 局（${PREFIX}）`);
console.log(`  EMERGENCY_RESCUE 可点回合数      : ${opportunities}`);
console.log(`  出现过可点机会的局数             : ${runsWithOpp} (${((runsWithOpp / N) * 100).toFixed(1)}%)`);
console.log(`  timeTight 回合数                 : ${timeTightTurns}`);
console.log(`  staminaLow 回合数                : ${staminaLowTurns}`);
console.log(`  Bot 实际执行求援次数             : ${executed}`);
console.log(`  被"求援也救不回来"守卫挡掉       : ${guardedNoSave}`);
console.log(`  可点机会出现的阶段分布           : ${JSON.stringify(phases)}`);
void inner;
for (const s of samples) console.log("  · " + s);
