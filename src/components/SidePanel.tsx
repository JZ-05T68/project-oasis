import {
  getCurrentWeather,
  getAvailableActions,
  starLabel,
  weatherNames,
} from '../game';
import { computeStarRating } from '../game/rules/routeScore';
import type { ActionInfo, GameState } from '../game/types';

interface Props {
  game: GameState;
  onAction: (action: ActionInfo['action']) => void;
}

export default function SidePanel({ game, onAction }: Props) {
  const node = game.map.nodes[game.position];
  const weather = getCurrentWeather(game);
  const actions = panelActions(game);

  return (
    <div>
      <div className="panel">
        <h3 className="panel-title">当前位置</h3>
        <div className="location-line">
          <span className="k">地点</span>
          <span>
            {node.name}（{TERRAIN_NAMES[node.terrain]}）
          </span>
        </div>
        <div className="location-line">
          <span className="k">今日天气</span>
          <span className={`wtag w-${weather.toLowerCase()}`}>{weatherNames[weather]}</span>
        </div>
        {game.routeScore !== null && (
          <div className="location-line">
            <span className="k">路线风险评级</span>
            <span>
              {starLabel(computeStarRating(game.routeScore))}（评分 {game.routeScore}，仅供统计）
            </span>
          </div>
        )}
        {game.baseGemPrice !== null && (
          <div className="location-line">
            <span className="k">宝石单价</span>
            <span>{game.gemPrice} 元/kg（进入矿区即锁定）</span>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">可执行行动</h3>
        {game.phase === 'RETURN' && actions.length === 0 && (
          <p className="modal-desc">沿蓝色虚线路线返回城市——不要重复去程走过的格子。</p>
        )}
        {actions.map((a) => (
          <button
            key={`${a.action.type}-${a.action.item ?? ''}`}
            className={`action-btn ${a.action.type === 'MINE' || a.action.type === 'START_RETURN' ? 'primary' : ''}`}
            disabled={a.disabled}
            onClick={() => onAction(a.action)}
          >
            {a.label}
            {a.hint && <span className="hint">{a.hint}</span>}
            {a.disabled && a.disabledReason && <span className="hint warn-text">{a.disabledReason}</span>}
          </button>
        ))}
        {game.phase === 'MINING' && (
          <p className="modal-desc" style={{ marginTop: 10 }}>
            宝库安全无天气。多挖一天多 2kg 宝石，但返程的时间与风险由你自己承担。
          </p>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">旅途日志</h3>
        <ul className="log-list">
          {game.log.map((entry, i) => (
            <li key={i} className={entry.kind}>
              <span className="log-day">D{entry.day}</span>
              {entry.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const TERRAIN_NAMES: Record<string, string> = {
  CITY: '城市',
  DESERT: '沙漠',
  GRASS: '草地',
  VILLAGE: '村庄',
  OASIS: '绿洲',
  MINE: '矿区入口',
};

/** 侧栏行动：挖矿/返程/休整/购买（来自引擎，附加面板可用性过滤） */
function panelActions(game: GameState): ActionInfo[] {
  const all = getAvailableActions(game);
  if (game.status !== 'ONGOING') return [];
  // 有待处理事件时行动全部冻结（Modal 会覆盖界面）
  if (game.pendingEvents.length > 0) {
    return all.map((a) => ({ ...a, disabled: true, disabledReason: '先处理当前事件' }));
  }
  return all;
}
