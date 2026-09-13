import { computeSettlement, starLabel } from '../game';
import type { GameState } from '../game/types';

interface Props {
  game: GameState;
  onRestart: () => void;
}

const DEFEAT_TEXT: Record<string, string> = {
  TIMEOUT: '时间耗尽——第 43 天的太阳升起时，你已经永远留在了荒野之中。',
  STAMINA_EXHAUSTED: '耐力耗尽——你和商队倒在离绿洲很远的地方。',
  RETURN_ROUTE_SEVERED: '返程路线中断——去程与返程的足迹封死了所有归途。',
  TRAPPED: '进退无路——四周都是你自己留下的脚印。',
};

export default function Settlement({ game, onRestart }: Props) {
  const v = computeSettlement(game);
  const win = v.outcome === 'VICTORY';

  return (
    <div className="app-shell">
      <div className="settlement">
        <div className={`panel ${win ? '' : ''}`}>
          <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? '成功返城' : '旅途终结'}</div>
          <p className="verdict-sub">
            {win
              ? `你在第 ${v.daysUsed} 天带着宝石回到了城市。`
              : DEFEAT_TEXT[v.defeatReason ?? ''] ?? '旅途就此结束。'}
          </p>
          <table className="settle-table">
            <tbody>
              <tr>
                <td className="k">本局 Seed</td>
                <td className="v">{v.seed}</td>
              </tr>
              <tr>
                <td className="k">总用时</td>
                <td className="v">{v.daysUsed} 天</td>
              </tr>
              <tr>
                <td className="k">去程 / 采矿 / 返程</td>
                <td className="v">
                  {v.outboundDays ?? '-'} / {v.miningDays} / {v.returnDays} 天
                </td>
              </tr>
              <tr>
                <td className="k">天气预报次数</td>
                <td className="v">{v.forecastCount}</td>
              </tr>
              <tr>
                <td className="k">装备支出</td>
                <td className="v">{v.equipmentSpent} 元</td>
              </tr>
              {v.routeScore !== null && (
                <>
                  <tr>
                    <td className="k">路线难度评分</td>
                    <td className="v">
                      {v.routeScore}（{starLabel(v.stars ?? 1)}）
                    </td>
                  </tr>
                  <tr>
                    <td className="k">宝石基础估值</td>
                    <td className="v">{v.baseGemPrice} 元/kg</td>
                  </tr>
                  <tr>
                    <td className="k">市场因素</td>
                    <td className="v">× {v.marketFactor?.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="k">最终成交价</td>
                    <td className="v">{v.gemPrice ?? '-'} 元/kg</td>
                  </tr>
                </>
              )}
              <tr>
                <td className="k">宝石重量</td>
                <td className="v">{v.gemsKg} kg</td>
              </tr>
              <tr>
                <td className="k">宝石销售额</td>
                <td className="v">{v.gemRevenue} 元{!win && '（失败，无法出售）'}</td>
              </tr>
              <tr>
                <td className="k">剩余现金</td>
                <td className="v">{v.cashRemaining} 元</td>
              </tr>
              <tr className="hl">
                <td className="k">最终资产</td>
                <td className="v">{v.finalAssets} 元</td>
              </tr>
              <tr className="hl">
                <td className="k">净收益（相对 2000 元本金）</td>
                <td className="v">
                  {v.netProfit >= 0 ? '+' : ''}
                  {v.netProfit} 元
                </td>
              </tr>
            </tbody>
          </table>
          <div className="settle-actions">
            <button className="btn gold" onClick={onRestart}>
              再来一局
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
