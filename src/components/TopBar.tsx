import { gameConfig, tentLabel } from '../game';
import type { GameState } from '../game/types';

const PHASE_NAMES: Record<GameState['phase'], string> = {
  OUTBOUND: '去程',
  MINING: '采矿',
  RETURN: '返程',
  FINISHED: '结束',
};

export default function TopBar({ game, onOpenRules }: { game: GameState; onOpenRules?: () => void }) {
  /** v0.3.0：运营成本必须让玩家**随时看得见**，否则它只是一条藏在结算里的税（§14/§50） */
  const accruedUpkeep = (() => {
    const u = gameConfig.mechanisms.upkeep;
    if (!u.enabled) return 0;
    if (u.mode === 'perDay') return Math.round(game.daysUsed * u.costPerDay);
    if (u.mode === 'miningDay') return Math.round(game.stats.miningDays * u.costPerDay);
    return Math.round(Math.max(0, game.daysUsed - u.freeDays) * u.overtimeCostPerDay);
  })();
  return (
    <div className="topbar">
      <div className="stat">
        <span className="label">天数</span>
        <span className="value">
          第 {game.daysUsed} / {game.maxDays} 天
        </span>
      </div>
      <div className="stat">
        <span className="label">现金</span>
        <span className="value">{game.cash} 元</span>
      </div>
      <div className="stat">
        <span className="label">耐力</span>
        <span className="stamina-dots">
          {Array.from({ length: gameConfig.maxStamina }, (_, i) => (
            <span key={i} className={`stamina-dot ${i < game.stamina ? 'on' : ''}`} />
          ))}
        </span>
      </div>
      <div className="stat">
        <span className="label">帐篷</span>
        <span className="value">{tentLabel(game.tents)}</span>
      </div>
      <div className="stat">
        <span className="label">指南针</span>
        <span className="value">{game.compasses}</span>
      </div>
      <div className="stat">
        <span className="label">宝石</span>
        <span className="value">{game.gemsKg} kg</span>
      </div>
      <div className="stat">
        <span className="label">预报次数</span>
        <span className="value">{game.forecastCharges}</span>
      </div>
      {/* v0.2.0：新机制状态明确展示（§45 不依赖玩家猜隐藏数字） */}
      {gameConfig.mechanisms.surgeMining.enabled && (
        <div className="stat" title="深层采矿每局只有一次机会">
          <span className="label">深层采矿</span>
          <span className="value">{game.stats.surgeMiningUses > 0 ? '已使用' : '可用 ×1'}</span>
        </div>
      )}
      {gameConfig.mechanisms.emergencyRescue.enabled && (
        <div
          className="stat"
          title={
            gameConfig.mechanisms.rescueSettlement.enabled
              ? `求援当场不收钱，回城结算时付 ${gameConfig.mechanisms.rescueSettlement.deferredDebt} 元${
                  gameConfig.mechanisms.rescueSettlement.revenueShare > 0
                    ? ` + 宝石收入 ${Math.round(gameConfig.mechanisms.rescueSettlement.revenueShare * 100)}%`
                    : ''
                }；每局最多 ${gameConfig.mechanisms.emergencyRescue.maxUses} 次`
              : `求援 ${gameConfig.mechanisms.emergencyRescue.cost} 元（当场付），每局最多 ${gameConfig.mechanisms.emergencyRescue.maxUses} 次`
          }
        >
          <span className="label">求援</span>
          <span className="value">
            {game.stats.emergencyRescues >= gameConfig.mechanisms.emergencyRescue.maxUses
              ? '已用过'
              : gameConfig.mechanisms.rescueSettlement.enabled
                ? '可赊账'
                : '可用'}
          </span>
        </div>
      )}
      {gameConfig.mechanisms.upkeep.enabled && (
        <div
          className="stat"
          title={
            gameConfig.mechanisms.upkeep.mode === 'overtime'
              ? `前 ${gameConfig.mechanisms.upkeep.freeDays} 天免费，之后每天 ${gameConfig.mechanisms.upkeep.overtimeCostPerDay} 元，回城结算`
              : `每天 ${gameConfig.mechanisms.upkeep.costPerDay} 元，回城结算`
          }
        >
          <span className="label">累计运营费</span>
          <span className="value">{accruedUpkeep} 元</span>
        </div>
      )}
      {gameConfig.mechanisms.returnIntel.enabled && game.stats.returnIntelTiles > 0 && (
        <div className="stat" title="抵达矿区时揭示的返程候选格数量">
          <span className="label">返程情报</span>
          <span className="value">{game.stats.returnIntelTiles} 格</span>
        </div>
      )}
      {gameConfig.mechanisms.villageService.enabled && (
        <div className="stat" title="本局在村庄消费总额">
          <span className="label">村庄支出</span>
          <span className="value">{game.stats.villageServiceSpent} 元</span>
        </div>
      )}
      <div className="stat">
        <span className="label">Seed</span>
        <span className="value">{game.seed}</span>
      </div>
      <div className="phase-badge">{PHASE_NAMES[game.phase]}</div>
      {onOpenRules && (
        <button type="button" className="btn rules-btn" onClick={onOpenRules}>
          规则
        </button>
      )}
    </div>
  );
}
