import { gameConfig, weatherNames } from '../game';
import type { EventChoice, GameState, WeatherType } from '../game/types';

interface Props {
  game: GameState;
  onChoice: (eventId: string, choice: EventChoice) => void;
}

/** 待决事件 Modal：一次只显示队首事件（天气预报结果由 GamePage 单独渲染） */
export default function EventModal({ game, onChoice }: Props) {
  const event = game.pendingEvents[0];
  if (!event) return null;

  const choice = (c: EventChoice) => {
    onChoice(event.id, c);
  };

  switch (event.kind) {
    case 'SANDSTORM': {
      const canTent = game.tents.length > 0;
      const canCompass = game.compasses > 0;
      return (
        <Modal
          title="沙尘暴！"
          desc="风沙遮天蔽日。是否使用你的装备？帐篷可逐次抵挡（耐久 -1），指南针可辨别方向（单次消耗）。"
        >
          {canTent && canCompass && (
            <button className="btn gold" onClick={() => choice({ kind: 'SANDSTORM', useTent: true, useCompass: true })}>
              帐篷 + 指南针（安全通过）
            </button>
          )}
          {canTent && (
            <button className="btn" onClick={() => choice({ kind: 'SANDSTORM', useTent: true, useCompass: false })}>
              只用帐篷（帐篷耐久 -1，但会迷路：额外损失 1 天）
            </button>
          )}
          {canCompass && (
            <button className="btn" onClick={() => choice({ kind: 'SANDSTORM', useTent: false, useCompass: true })}>
              只用指南针（耐力 -1，不迷路）
            </button>
          )}
          <button className="btn" onClick={() => choice({ kind: 'SANDSTORM', useTent: false, useCompass: false })}>
            什么都不用（耐力 -1，且迷路额外损失 1 天）
          </button>
        </Modal>
      );
    }
    case 'RAINSTORM':
      return (
        <Modal
          title="草原暴雨！"
          desc="倾盆大雨浇在草原上。帐篷可以保住体力——但暴雨会整顶报废帐篷（无论还剩多少沙漠耐久）。"
        >
          {game.tents.length > 0 && (
            <button className="btn gold" onClick={() => choice({ kind: 'RAINSTORM', useTent: true })}>
              使用帐篷（整顶消耗，不掉耐力）
            </button>
          )}
          <button className="btn" onClick={() => choice({ kind: 'RAINSTORM', useTent: false })}>
            {game.tents.length > 0 ? '不用帐篷（耐力 -1）' : '冒雨硬扛（耐力 -1）'}
          </button>
        </Modal>
      );
    case 'CARAVAN':
      return (
        <Modal
          title="沙漠商队"
          desc="一支商队愿意做笔买卖：二选一。购买不消耗时间。"
        >
          <button
            className="btn gold"
            disabled={game.cash < gameConfig.caravanTentPrice}
            onClick={() => choice({ kind: 'CARAVAN', action: 'BUY_TENT' })}
          >
            花费 {gameConfig.caravanTentPrice} 元购买一顶二手帐篷（3 次沙漠耐久）
            {game.cash < gameConfig.caravanTentPrice && ' —— 现金不足'}
          </button>
          <button className="btn" onClick={() => choice({ kind: 'CARAVAN', action: 'TAKE_INTEL' })}>
            免费获取周边 3 格以内的地形情报
          </button>
        </Modal>
      );
    case 'THIEF':
      return (
        <Modal
          title="盗贼夜袭！"
          desc={`盗贼抢走了 ${event.stolen} 元。是否追回？`}
        >
          <button className="btn" onClick={() => choice({ kind: 'THIEF', action: 'GIVE_UP' })}>
            放弃（损失 {event.stolen} 元）
          </button>
          <button className="btn gold" onClick={() => choice({ kind: 'THIEF', action: 'CHASE' })}>
            追回（消耗 1 天，全额找回）
            {game.daysUsed + 1 > gameConfig.maxDays && (
              <span className="warn-text"> —— 这将超出 42 天期限！</span>
            )}
          </button>
        </Modal>
      );
    case 'MARKET':
      return (
        <Modal
          title="繁荣市集"
          desc="村里正逢繁荣市集！二选一：享用八折购物，或打一天工赚钱。"
        >
          <button className="btn gold" onClick={() => choice({ kind: 'MARKET', action: 'TAKE_DISCOUNT' })}>
            八折购物（帐篷 {gameConfig.marketDiscountTentPrice} 元 / 指南针 {gameConfig.marketDiscountCompassPrice} 元，本次停留有效）
          </button>
          <button className="btn" onClick={() => choice({ kind: 'MARKET', action: 'WORK' })}>
            打工（消耗 1 天，赚得 {gameConfig.workPay} 元）
            {game.daysUsed + 1 > gameConfig.maxDays && (
              <span className="warn-text"> —— 这将超出 42 天期限！</span>
            )}
          </button>
        </Modal>
      );
    case 'FORECAST_OFFER':
      return (
        <Modal
          title="20:00 · 观测站的邀请"
          desc="是否把下一天用于观测天气？查看将消耗一整天（该天不能移动或行动），之后你将看到未来 3 天已知区域的天气。"
        >
          <button className="btn gold" onClick={() => choice({ kind: 'FORECAST_OFFER', accept: true })}>
            查看天气（消耗 1 天）
            {game.daysUsed + 2 >= gameConfig.maxDays && (
              <span className="warn-text"> —— 时间紧张！</span>
            )}
          </button>
          <button className="btn" onClick={() => choice({ kind: 'FORECAST_OFFER', accept: false })}>
            不查看
          </button>
        </Modal>
      );
    default:
      return null;
  }
}

function Modal({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{title}</h3>
        <p className="modal-desc">{desc}</p>
        <div className="modal-actions">{children}</div>
      </div>
    </div>
  );
}

/** 天气预报结果展示（由 GamePage 根据 lastForecast 渲染） */
export function ForecastModal({ game, onClose }: { game: GameState; onClose: () => void }) {
  const view = game.lastForecast!;
  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: 'min(680px, 96vw)' }}>
        <h3>未来 3 天天气预报</h3>
        <p className="modal-desc">
          消耗 1 天换来的观测结果。未知地形的区域无法预报——先去探索或收集情报吧。
        </p>
        <table className="forecast-grid">
          <thead>
            <tr>
              <th>区域</th>
              {view.dayNumbers.map((d) => (
                <th key={d}>第 {d} 天</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.nodeId}>
                <td className="node-name">{row.terrainKnown ? game.map.nodes[row.nodeId].name : '???'}</td>
                {row.values.map((w: WeatherType | 'UNKNOWN', i: number) => (
                  <td key={i} className={w === 'UNKNOWN' ? 'unknown' : ''}>
                    {w === 'UNKNOWN' ? '未知' : weatherNames[w]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button className="btn gold" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
