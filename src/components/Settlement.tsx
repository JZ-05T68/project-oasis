import { computeSettlement, starLabel } from '../game';
import type { GameState } from '../game/types';

interface Props {
  game: GameState;
  onRestart: () => void;
}

const DEFEAT_TEXT: Record<string, string> = {
  TIMEOUT: '时间耗尽——最大旅程天数用尽的时刻到来时，你已经永远留在了荒野之中。',
  STAMINA_EXHAUSTED: '耐力耗尽——你和商队倒在离绿洲很远的地方。',
  RETURN_ROUTE_SEVERED: '返程路线已被切断——当前已经不存在符合"去程与返程不得重复普通格"规则的返城路线。',
  TRAPPED: '进退无路——四周都是你自己留下的脚印。',
  NO_LEGAL_ROUTE: '远征路线已被切断——以当前足迹，已经不存在任何合法完成旅程的路线。',
  INSUFFICIENT_TIME: '无法按时完成远征——根据当前剩余时间与已经使用的路线，本局已经无法在时限内合法完成旅程。',
};

export default function Settlement({ game, onRestart }: Props) {
  const v = computeSettlement(game);
  const win = v.outcome === 'VICTORY';

  return (
    <div className="app-shell">
      <div className="settlement">
        <div className="panel">
          <div className={`verdict ${win ? 'win' : 'lose'}`}>{win ? '成功返城' : '旅途终结'}</div>
          <p className="verdict-sub">
            {win
              ? `你在第 ${v.daysUsed} 天（上限 ${v.maxDays} 天）带着宝石回到了城市。`
              : (v.defeatReason ? DEFEAT_TEXT[v.defeatReason] : '旅途就此结束。')}
          </p>
          <table className="settle-table">
            <tbody>
              <tr>
                <td className="k">本局 Seed</td>
                <td className="v">{v.seed}</td>
              </tr>
              <tr>
                <td className="k">总用时 / 天数上限</td>
                <td className="v">
                  {v.daysUsed} / {v.maxDays} 天
                </td>
              </tr>
              <tr>
                <td className="k">去程 / 采矿 / 返程</td>
                <td className="v">
                  {v.outboundDays ?? '-'} / {v.miningDays} / {v.returnDays} 天
                </td>
              </tr>
              <tr>
                <td className="k">天气预报包购买次数</td>
                <td className="v">{v.forecastPacks}</td>
              </tr>
              <tr>
                <td className="k">装备支出</td>
                <td className="v">{v.equipmentSpent} 元</td>
              </tr>
              {v.mineSlot && (
                <tr>
                  <td className="k">进入矿区</td>
                  <td className="v">Mine {v.mineSlot}</td>
                </tr>
              )}
              {v.routeScore !== null && (
                <tr>
                  <td className="k">路线风险评分（仅供统计）</td>
                  <td className="v">
                    {v.routeScore}（{starLabel(v.stars ?? 1)}）
                  </td>
                </tr>
              )}
              {v.gemPrice !== null && (
                <tr>
                  <td className="k">最终鉴定单价</td>
                  <td className="v">{v.gemPrice} 元/kg</td>
                </tr>
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
