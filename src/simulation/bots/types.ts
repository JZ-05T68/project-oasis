import type { BotDecision, BotRng } from '../runner';
import type { FairView } from '../fairView';

export type { BotDecision, BotRng };

/**
 * Bot 策略接口。
 * 约定：decide 每回合调用一次，必须返回一个「当前合法」的决策；
 * 合法性由引擎二次校验，非法决策会抛错（视为框架 Bug 而不是策略输赢）。
 * Bot 只能访问 FairView（玩家视角），不得接触原始 GameState。
 */
export interface BotStrategy {
  readonly name: string;
  decide(view: FairView, rng: BotRng): BotDecision;
}
