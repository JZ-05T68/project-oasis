import { useCallback, useEffect, useRef, useState } from 'react';
import { gameConfig, tentName, weatherNames } from '../game';
import type { EventChoice, GameState, WeatherType } from '../game/types';

/* ------------------------------------------------------------------ */
/* Modal 基础壳（P0 修复）                                              */
/*  - 信息类 Modal：× 永远可见、Esc 关闭、Footer 关闭、内容内部滚动        */
/*  - 事件类 Modal：必须做出选择（不提供 × / Esc），但内容内部滚动         */
/*  - v0.1.2b：内容溢出时给出明确的「还有更多选项」滚动提示，             */
/*    且高度上限改用 min(88vh, 100%)，保证 Modal 永不超出视口             */
/*    导致下方按钮落在裁剪区之外（真人试玩 P0：多顶帐篷的后部按钮点不到） */
/* ------------------------------------------------------------------ */

interface ShellProps {
  title: string;
  /** 传入则允许 × / Esc / Footer 关闭（信息类 Modal） */
  onClose?: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

export function ModalShell({ title, onClose, children, wide }: ShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  /** 内容是否超出可视区（决定是否显示滚动提示） */
  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const over = el.scrollHeight - el.clientHeight > 4;
    setOverflowing(over);
    setAtBottom(!over || el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  }, []);

  // 每次渲染后重新测量（内容/尺寸都可能变化）
  useEffect(() => {
    measure();
    const el = bodyRef.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  });

  const showHint = overflowing && !atBottom;

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
        <div className={`modal-body ${overflowing ? 'is-overflowing' : ''}`} ref={bodyRef}>
          {children}
        </div>
        {showHint && (
          <button
            type="button"
            className="modal-scroll-hint"
            onClick={() => {
              const el = bodyRef.current;
              if (el) el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
            }}
          >
            ↓ 下方还有选项，点击或滚动查看
          </button>
        )}
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
  const maxCharge = gameConfig.tentDesertCharges;

  switch (event.kind) {
    case 'SANDSTORM': {
      const canCompass = game.compasses > 0;
      return (
        <ModalShell title="沙尘暴！">
          <p className="modal-desc">
            风沙遮天蔽日。是否使用你的装备？帐篷可逐次抵挡（耐久 -1），指南针可辨别方向（单次消耗）。
          </p>
          {game.tents.length > 0 && (
            <div className="tent-choice-list">
              {game.tents.map((t) => (
                <div className="tent-choice" key={t.id}>
                  <span className="tent-choice-name" data-tentid={t.id}>
                    {tentName(t.id)}
                    <em>
                      {t.charges}/{maxCharge}
                    </em>
                  </span>
                  <div className="tent-choice-btns">
                    <button
                      type="button"
                      className="btn gold sm"
                      data-testid={`sandstorm-tent-compass-${t.id}`}
                      disabled={!canCompass}
                      onClick={() => choice({ kind: 'SANDSTORM', useTent: true, useCompass: true, tentId: t.id })}
                    >
                      + 指南针（安全通过）
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      data-testid={`sandstorm-tent-only-${t.id}`}
                      onClick={() => choice({ kind: 'SANDSTORM', useTent: true, useCompass: false, tentId: t.id })}
                    >
                      只用帐篷（迷路 +1 天）
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="modal-actions">
            {canCompass && (
              <button type="button" className="btn" onClick={() => choice({ kind: 'SANDSTORM', useTent: false, useCompass: true })}>
                只用指南针（耐力 -1，不迷路）
              </button>
            )}
            <button type="button" className="btn" onClick={() => choice({ kind: 'SANDSTORM', useTent: false, useCompass: false })}>
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
            倾盆大雨浇在草原上。帐篷可以保住体力——但暴雨会把你选中的那顶帐篷
            <b>整顶报废</b>（无论剩余多少耐久）。
          </p>
          {game.tents.length > 0 && (
            <div className="tent-choice-list">
              {game.tents.map((t) => (
                <div className="tent-choice" key={t.id}>
                  <span className="tent-choice-name" data-tentid={t.id}>
                    {tentName(t.id)}
                    <em>
                      {t.charges}/{maxCharge}
                    </em>
                  </span>
                  <div className="tent-choice-btns">
                    <button
                      type="button"
                      className="btn gold sm"
                      data-testid={`rainstorm-tent-${t.id}`}
                      onClick={() => choice({ kind: 'RAINSTORM', useTent: true, tentId: t.id })}
                    >
                      使用帐篷（整顶报废）
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => choice({ kind: 'RAINSTORM', useTent: false })}>
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
              type="button"
              className="btn gold"
              disabled={game.cash < gameConfig.caravanTentPrice}
              onClick={() => choice({ kind: 'CARAVAN', action: 'BUY_TENT' })}
            >
              花费 {gameConfig.caravanTentPrice} 元购买一顶二手帐篷（{gameConfig.caravanTentCharges} 次沙漠耐久）
              {game.cash < gameConfig.caravanTentPrice && ' —— 现金不足'}
            </button>
            <button type="button" className="btn" onClick={() => choice({ kind: 'CARAVAN', action: 'TAKE_INTEL' })}>
              免费获取周边 {gameConfig.intelRevealRadius} 格内（曼哈顿距离）的地形情报
            </button>
          </div>
        </ModalShell>
      );
    case 'THIEF':
      return (
        <ModalShell title="盗贼夜袭！">
          <p className="modal-desc">盗贼抢走了 {event.stolen} 元。是否追回？</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => choice({ kind: 'THIEF', action: 'GIVE_UP' })}>
              放弃（损失 {event.stolen} 元）
            </button>
            <button type="button" className="btn gold" onClick={() => choice({ kind: 'THIEF', action: 'CHASE' })}>
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
            <button type="button" className="btn gold" onClick={() => choice({ kind: 'MARKET', action: 'TAKE_DISCOUNT' })}>
              八折购物（帐篷 {gameConfig.marketDiscountTentPrice} 元 / 指南针 {gameConfig.marketDiscountCompassPrice} 元，本次停留有效）
            </button>
            <button type="button" className="btn" onClick={() => choice({ kind: 'MARKET', action: 'WORK' })}>
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
