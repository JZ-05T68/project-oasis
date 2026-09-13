import { gameConfig, tentLabel } from '../game';
import type { GameState } from '../game/types';

const PHASE_NAMES: Record<GameState['phase'], string> = {
  OUTBOUND: '去程',
  MINING: '采矿',
  RETURN: '返程',
  FINISHED: '结束',
};

export default function TopBar({ game, onOpenRules }: { game: GameState; onOpenRules?: () => void }) {
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
