import type { DefeatReason, EventResult } from '../game/types';
import { ModalShell } from './EventModal';

/**
 * 统一的结果反馈弹窗（v0.1.2b Human Playtest Fix Round 1）。
 *
 * 真人试玩反馈：耐力下降、帐篷报废、指南针消耗、金钱变化、预报次数变化、
 * maxDays 减少、耐力恢复……这些关键变化原先只写在右下角日志里，玩家经常没意识到。
 *
 * 这里把「发生了什么 + 资源变化前→变化后 + 确认」抽象成唯一一个组件：
 * - 任何事件都不再各自造一套弹窗；
 * - 一次事件改变多个资源时只弹这一个综合结果（不会连弹三个）；
 * - 右下角日志照旧保留（同一事件双记录）。
 * 普通移动（没有任何资源变化）不会产生结果，因此不会变成「弹窗模拟器」。
 */

const DEFEAT_TITLES: Record<DefeatReason, string> = {
  TIMEOUT: '时间耗尽',
  STAMINA_EXHAUSTED: '耐力耗尽',
  RETURN_ROUTE_SEVERED: '返程路线被切断',
  TRAPPED: '进退无路',
  NO_LEGAL_ROUTE: '远征路线被切断',
  INSUFFICIENT_TIME: '无法按时完成远征',
};

interface Props {
  result: EventResult;
  /** 队列中剩余的结算条数（>0 时在按钮上提示，玩家知道还要按几次） */
  remaining: number;
  onClose: () => void;
}

export default function ResultModal({ result, remaining, onClose }: Props) {
  const failed = result.outcome === 'DEFEAT';
  const won = result.outcome === 'VICTORY';

  return (
    <ModalShell
      title={result.title}
      onClose={onClose}
      testId="result-modal"
      footer={
        <div className="result-footer">
          {remaining > 0 && <span className="result-remaining">还有 {remaining} 条待确认</span>}
          <button type="button" className="btn gold" data-testid="result-confirm" onClick={onClose}>
            {remaining > 0 ? `确定（还有 ${remaining} 条）` : '确定'}
          </button>
        </div>
      }
    >
      {failed && (
        <p className="result-outcome lose" data-testid="result-outcome">
          远征失败 · {result.defeatReason ? DEFEAT_TITLES[result.defeatReason] : '旅途结束'}
        </p>
      )}
      {won && (
        <p className="result-outcome win" data-testid="result-outcome">
          远征成功
        </p>
      )}

      <p className="modal-desc" data-testid="result-message">
        {result.message}
      </p>

      {result.changes.length > 0 ? (
        <ul className="result-changes" data-testid="result-changes">
          {result.changes.map((c, i) => (
            <li
              key={`${c.key}-${c.label}-${i}`}
              className={`result-change is-${c.direction}`}
              data-testid={`result-change-${c.key}`}
            >
              <span className="rc-label">{c.label}</span>
              <span className="rc-flow">
                <span className="rc-before">{c.before}</span>
                <span className="rc-arrow">→</span>
                <span className="rc-after">{c.after}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="modal-desc result-nochange" data-testid="result-no-change">
          本次结算没有数值变化。
        </p>
      )}
    </ModalShell>
  );
}
