import { useEffect } from 'react';
import { gameConfig, weatherNames } from '../game';
import type { EventChoice, GameState, WeatherType } from '../game/types';

/* ------------------------------------------------------------------ */
/* Modal 基础壳（P0 修复）                                              */
/*  - 信息类 Modal：× 永远可见、Esc 关闭、Footer 关闭、内容内部滚动        */
/*  - 事件类 Modal：必须做出选择（不提供 × / Esc），但内容内部滚动         */
/*    保证选项永远可达，不会形成无法退出的状态                            */
/* ------------------------------------------------------------------ */

interface ShellProps {
  title: string;
  /** 传入则允许 × / Esc / Footer 关闭（信息类 Modal） */
  onClose?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

export function ModalShell({ title, onClose, children, wide }: ShellProps) {
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          {onClose && (
            <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
              ×
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {onClose && (
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
        <ModalShell title="沙尘暴！">
          <p className="modal-desc">
            风沙遮天蔽日。是否使用你的装备？帐篷可逐次抵挡（耐久 -1），指南针可辨别方向（单次消耗）。
          </p>
          <div className="modal-actions">
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
          </div>
        </ModalShell>
      );
    }
    case 'RAINSTORM':
      return (
        <ModalShell title="草原暴雨！">
          <p className="modal-desc">
            倾盆大雨浇在草原上。帐篷可以保住体力——但暴雨会整顶报废帐篷（无论还剩多少沙漠耐久）。
          </p>
          <div className="modal-actions">
            {game.tents.length > 0 && (
              <button className="btn gold" onClick={() => choice({ kind: 'RAINSTORM', useTent: true })}>
                使用帐篷（整顶消耗，不掉耐力）
              </button>
            )}
            <button className="btn" onClick={() => choice({ kind: 'RAINSTORM', useTent: false })}>
              {game.tents.length > 0 ? '不用帐篷（耐力 -1）' : '冒雨硬扛（耐力 -1）'}
            </button>
          </div>
        </ModalShell>
      );
    case 'CARAVAN':
      return (
        <ModalShell title="沙漠商队">
          <p className="modal-desc">一支商队愿意做笔买卖：二选一。购买不消耗时间。</p>
          <div className="modal-actions">
            <button
              className="btn gold"
              disabled={game.cash < gameConfig.caravanTentPrice}
              onClick={() => choice({ kind: 'CARAVAN', action: 'BUY_TENT' })}
            >
              花费 {gameConfig.caravanTentPrice} 元购买一顶二手帐篷（3 次沙漠耐久）
              {game.cash < gameConfig.caravanTentPrice && ' —— 现金不足'}
            </button>
            <button className="btn" onClick={() => choice({ kind: 'CARAVAN', action: 'TAKE_INTEL' })}>
              免费获取周边 2 格内（曼哈顿距离）的地形情报
            </button>
          </div>
        </ModalShell>
      );
    case 'THIEF':
      return (
        <ModalShell title="盗贼夜袭！">
          <p className="modal-desc">盗贼抢走了 {event.stolen} 元。是否追回？</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => choice({ kind: 'THIEF', action: 'GIVE_UP' })}>
              放弃（损失 {event.stolen} 元）
            </button>
            <button className="btn gold" onClick={() => choice({ kind: 'THIEF', action: 'CHASE' })}>
              追回（消耗 1 天，全额找回）
              {game.daysUsed + 1 > game.maxDays && <span className="warn-text"> —— 这将超出最大天数！</span>}
            </button>
          </div>
        </ModalShell>
      );
    case 'MARKET':
      return (
        <ModalShell title="繁荣市集">
          <p className="modal-desc">村里正逢繁荣市集！二选一：享用八折购物，或打一天工赚钱。</p>
          <div className="modal-actions">
            <button className="btn gold" onClick={() => choice({ kind: 'MARKET', action: 'TAKE_DISCOUNT' })}>
              八折购物（帐篷 {gameConfig.marketDiscountTentPrice} 元 / 指南针 {gameConfig.marketDiscountCompassPrice} 元，本次停留有效）
            </button>
            <button className="btn" onClick={() => choice({ kind: 'MARKET', action: 'WORK' })}>
              打工（消耗 1 天，赚得 {gameConfig.workPay} 元）
              {game.daysUsed + 1 > game.maxDays && <span className="warn-text"> —— 这将超出最大天数！</span>}
            </button>
          </div>
        </ModalShell>
      );
    default:
      return null;
  }
}

/** 天气预报结果展示（单日：当前格 + 8 邻域） */
export function ForecastModal({ game, onClose }: { game: GameState; onClose: () => void }) {
  const view = game.lastForecast!;
  return (
    <ModalShell title={`天气预报 · 第 ${view.day} 天`} onClose={onClose} wide>
      <p className="modal-desc">
        当前格与周围一圈（最多 9 格）的明天天气。未知地形的格子仍会显示天气（这本身就是情报），
        但不会永久揭示地形。
      </p>
      <div className="forecast-grid9">
        {view.cells.map((c) => (
          <div
            key={c.tileId}
            className={`forecast-cell ${c.isCurrent ? 'is-current' : ''} ${c.terrainKnown ? '' : 'is-unknown'}`}
          >
            <div className="fc-coord">
              ({c.row},{c.col}){c.isCurrent ? ' · 当前' : ''}
            </div>
            <div className="fc-terrain">{c.terrainKnown ? terrainName(game, c.tileId) : '未知'}</div>
            <div className={`wtag w-${c.weather.toLowerCase()}`}>{weatherNames[c.weather]}</div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function terrainName(game: GameState, tileId: string): string {
  const t = game.map.tiles[tileId];
  const names: Record<string, string> = {
    CITY: '城市',
    DESERT: '沙漠',
    GRASS: '草地',
    VILLAGE: '村庄',
    OASIS: '绿洲',
    MINE: '矿区',
  };
  return names[t.terrain] ?? t.terrain;
}

export type { WeatherType };
