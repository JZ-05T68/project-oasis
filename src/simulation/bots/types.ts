import type { BotDecision, BotRng } from '../runner';
import type { FairView } from '../fairView';
import type { TileId } from '../../game/types';

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
  /**
   * 【仅遥测，不参与决策】忽略预报时本回合会走的格子。
   * 用于把「有效预报（Decision-Useful）」与「只看不改（Informational Only）」分开：
   * 返回 null 表示该回合本来就不做移动决策（事件/采矿/买装备/修整），不计入分母。
   */
  blindMove?(view: FairView): TileId | null;
}
