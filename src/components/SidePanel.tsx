import {
  getCurrentWeather,
  getAvailableActions,
  starLabel,
  tentName,
  weatherNames,
  gameConfig,
} from '../game';
import { computeStarRating } from '../game/rules/routeScore';
import type { ActionInfo, GameState, TentItem } from '../game/types';

interface Props {
  game: GameState;
  onAction: (action: ActionInfo['action']) => void;
}

const TERRAIN_NAMES: Record<string, string> = {
  CITY: '城市',
  DESERT: '沙漠',
  GRASS: '草地',
  VILLAGE: '村庄',
  OASIS: '绿洲',
  MINE: '矿区',
};

export default function SidePanel({ game, onAction }: Props) {
  const tile = game.map.tiles[game.position];
  const weather = getCurrentWeather(game);
  const actions = panelActions(game);
  const lockedMine = game.mineEntranceId
    ? game.map.mines.find((m) => m.tileId === game.mineEntranceId)
    : null;

  return (
    <div>
      <div className="panel">
        <h3 className="panel-title">矿区情报（开局已知）</h3>
        {game.map.mines.map((m) => (
          <div className="location-line" key={m.slot}>
            <span className="k">
              Mine {m.slot} ({m.row},{m.col})
            </span>
            <span>{lockedMine?.slot === m.slot ? '已抵达 · 待鉴定' : '价格返城后鉴定'}</span>
          </div>
        ))}
        <p className="modal-desc">矿区的客观开采难度会影响最终宝石价值，但精确单价只有成功返城后才会公布。</p>
      </div>

      <div className="panel">
        <h3 className="panel-title">当前位置</h3>
        <div className="location-line">
          <span className="k">地点</span>
          <span>
            ({tile.row},{tile.col}) {game.position === game.map.cityId ? '城市' : TERRAIN_NAMES[tile.terrain] ?? ''}
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
        {game.gemsKg > 0 && (
          <div className="location-line">
            <span className="k">宝石</span>
            <span>{game.gemsKg} kg（返城后鉴定单价）</span>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">可执行行动</h3>
        {actions.length === 0 && <p className="modal-desc">沿蓝色虚线轨迹返回城市。</p>}
        {actions.flatMap((a, ai) => {
          const keyBase = `${a.action.type}-${a.action.item ?? ''}-${ai}`;
          // 需要帐篷的行动：逐顶展开，由玩家选择使用哪一顶。
          // v0.1.2b：按钮回传帐篷稳定 ID（tentId），不再用 array index —— 帐篷会被
          // 消耗/报废导致列表重排，下标会指向错误的帐篷。
          if (a.needsTent && !a.disabled && game.tents.length > 0) {
            return [
              <div className="tent-choice-list panel-tent-list" key={`${keyBase}-tents`}>
                <div className="tent-choice-head">
                  {a.label}
                  {a.hint && <span className="hint">{a.hint}</span>}
                </div>
                {game.tents.map((t) => (
                  <TentChoiceButton key={`${keyBase}-${t.id}`} tent={t} action={a} onAction={onAction} />
                ))}
              </div>,
            ];
          }
          return [
            <button
              key={keyBase}
              type="button"
              className={`action-btn ${a.action.type === 'MINE' || a.action.type === 'START_RETURN' ? 'primary' : ''}`}
              disabled={a.disabled}
              onClick={() => onAction(a.action)}
            >
              {a.label}
              {a.hint && <span className="hint">{a.hint}</span>}
              {a.disabled && a.disabledReason && <span className="hint warn-text">{a.disabledReason}</span>}
            </button>,
          ];
        })}
        {game.phase === 'MINING' && (
          <p className="modal-desc" style={{ marginTop: 10 }}>
            矿区安全无天气。多挖一天多 2kg 宝石，但返程的时间与风险由你自己承担。
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

/**
 * 单顶帐篷的行动按钮（v0.1.2b）。
 * 关键：回传的是帐篷稳定 ID，不是列表下标；帐篷被消耗后列表重排也不会错位。
 */
function TentChoiceButton({
  tent,
  action,
  onAction,
}: {
  tent: TentItem;
  action: ActionInfo;
  onAction: (action: ActionInfo['action']) => void;
}) {
  const max = gameConfig.tentDesertCharges;
  const primary = action.action.type === 'MINE' || action.action.type === 'START_RETURN';
  return (
    <button
      type="button"
      className={`action-btn ${primary ? 'primary' : ''}`}
      data-tentid={tent.id}
      onClick={() => onAction({ ...action.action, tentId: tent.id })}
    >
      {action.label} · 用 {tentName(tent.id)}（{tent.charges}/{max}）
    </button>
  );
}

/** 侧栏行动（来自引擎，附加面板可用性过滤） */
function panelActions(game: GameState): ActionInfo[] {
  const all = getAvailableActions(game);
  if (game.status !== 'ONGOING') return [];
  // 有待处理事件时行动全部冻结（Modal 会覆盖界面）
  if (game.pendingEvents.length > 0) {
    return all.map((a) => ({ ...a, disabled: true, disabledReason: '先处理当前事件' }));
  }
  return all;
}
