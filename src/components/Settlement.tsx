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
          <div className={`verdict ${win ? 'win' : 'lose'}`} data-testid="verdict">
            {v.verdictHeadline}
          </div>
          <p className="verdict-sub" data-testid="verdict-detail">
            {win ? v.verdictDetail : (v.defeatReason ? DEFEAT_TEXT[v.defeatReason] : v.verdictDetail)}
          </p>

          {/* v0.2.0 §46：远征结果与经济盈亏必须分开展示 */}
          <div className="outcome-split" data-testid="outcome-split">
            <div className={`outcome-card ${win ? 'ok' : 'bad'}`} data-testid="outcome-expedition">
              <span className="oc-label">远征结果</span>
              <span className="oc-value">{win ? '成功返城' : '未能返回'}</span>
            </div>
            <div
              className={`outcome-card ${v.economicOutcome === 'PROFITABLE' ? 'ok' : v.economicOutcome === 'BREAK_EVEN' ? 'mid' : 'bad'}`}
              data-testid="outcome-economic"
            >
              <span className="oc-label">经济结果</span>
              <span className="oc-value">
                {!win
                  ? '远征失败（宝石无法出售）'
                  : v.economicOutcome === 'PROFITABLE'
                    ? '盈利'
                    : v.economicOutcome === 'BREAK_EVEN'
                      ? '保本'
                      : '亏损'}
              </span>
            </div>
          </div>

          <table className="settle-table">
            <tbody>
              <tr>
                <td className="k">本局 Seed</td>
                <td className="v">{v.seed}</td>
              </tr>
              {/* v0.3.0 §48：经济瀑布 —— 每一笔钱都能对账 */}
              <tr className="sub">
                <td className="k">初始资金</td>
                <td className="v">{v.initialCash} 元</td>
              </tr>
              <tr>
                <td className="k">装备支出</td>
                <td className="v">-{v.equipmentSpent} 元</td>
              </tr>
              {v.forecastSpent > 0 && (
                <tr data-testid="settle-forecast">
                  <td className="k">天气预报</td>
                  <td className="v">-{v.forecastSpent} 元</td>
                </tr>
              )}
              {v.villageSpend > 0 && (
                <tr data-testid="settle-village">
                  <td className="k">村庄服务（{v.villageServicesUsed} 次）</td>
                  <td className="v">-{v.villageSpend} 元</td>
                </tr>
              )}
              {v.rescueImmediateSpend > 0 && (
                <tr data-testid="settle-rescue">
                  <td className="k">紧急求援（{v.emergencyRescues} 次，当场支付）</td>
                  <td className="v">-{v.rescueImmediateSpend} 元</td>
                </tr>
              )}
              {v.otherCashDelta !== 0 && (
                <tr data-testid="settle-other-cash">
                  <td className="k">途中事件（市集打工 / 盗贼 / 商队等）</td>
                  <td className="v">
                    {v.otherCashDelta > 0 ? '+' : ''}
                    {v.otherCashDelta} 元
                  </td>
                </tr>
              )}
              <tr className="sub">
                <td className="k">返城时手中现金</td>
                <td className="v">{v.cashRemaining} 元</td>
              </tr>
              <tr>
                <td className="k">宝石销售额</td>
                <td className="v">
                  +{v.grossGemRevenue} 元{!win && '（失败，无法出售）'}
                </td>
              </tr>
              {v.lateSaleLoss > 0 && (
                <tr data-testid="settle-latesale">
                  <td className="k">逾期折价（错过城门集市）</td>
                  <td className="v">-{v.lateSaleLoss} 元</td>
                </tr>
              )}
              {v.rescueSettlement > 0 && (
                <tr data-testid="settle-rescue-settlement">
                  <td className="k">
                    紧急求援结算（延期支付
                    {v.rescueDeferredDebt > 0 ? `：债务 ${v.rescueDeferredDebt}` : ''}
                    {v.rescueRevenueShare > 0 ? `${v.rescueDeferredDebt > 0 ? ' + ' : '：'}收入抽成 ${v.rescueRevenueShare}` : ''}
                    ）
                  </td>
                  <td className="v">-{v.rescueSettlement} 元</td>
                </tr>
              )}
              {v.operatingCost > 0 && (
                <tr data-testid="settle-upkeep">
                  <td className="k">远征运营成本</td>
                  <td className="v">-{v.operatingCost} 元</td>
                </tr>
              )}
              {v.transportCost > 0 && (
                <tr data-testid="settle-transport">
                  <td className="k">宝石运输费</td>
                  <td className="v">-{v.transportCost} 元</td>
                </tr>
              )}
              {v.commissionCost > 0 && (
                <tr data-testid="settle-commission">
                  <td className="k">宝石行佣金</td>
                  <td className="v">-{v.commissionCost} 元</td>
                </tr>
              )}
              {v.appraisalFee > 0 && (
                <tr data-testid="settle-appraisal">
                  <td className="k">鉴定费</td>
                  <td className="v">-{v.appraisalFee} 元</td>
                </tr>
              )}
              {v.settlementExpenses > 0 && (
                <tr className="sub">
                  <td className="k">结算期费用合计</td>
                  <td className="v">-{v.settlementExpenses} 元</td>
                </tr>
              )}
              {/* v0.2.0 机制痕迹（不在瀑布里重复计钱的部分） */}
              {v.emergencyRescues > 0 && v.rescueImmediateSpend === 0 && v.rescueSettlement === 0 && (
                <tr data-testid="settle-rescue">
                  <td className="k">紧急求援</td>
                  <td className="v">{v.emergencyRescues} 次</td>
                </tr>
              )}
              {v.surgeMiningUses > 0 && (
                <tr data-testid="settle-surge">
                  <td className="k">深层采矿</td>
                  <td className="v">额外 +{v.surgeMiningExtraKg} kg</td>
                </tr>
              )}
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
              {/* v0.2.0 机制支出（仅在机制生效时出现，避免给未启用机制的玩家看 0） */}
              {v.villageServicesUsed > 0 && (
                <tr data-testid="settle-village">
                  <td className="k">村庄服务（{v.villageServicesUsed} 次）</td>
                  <td className="v">-{v.villageServiceSpent} 元</td>
                </tr>
              )}
              {v.emergencyRescues > 0 && (
                <tr data-testid="settle-rescue">
                  <td className="k">紧急求援（{v.emergencyRescues} 次）</td>
                  <td className="v">-{v.emergencyRescueCost} 元</td>
                </tr>
              )}
              {v.surgeMiningUses > 0 && (
                <tr data-testid="settle-surge">
                  <td className="k">深层采矿</td>
                  <td className="v">额外 +{v.surgeMiningExtraKg} kg</td>
                </tr>
              )}
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
              <tr>
                <td className="k">初始资金</td>
                <td className="v">{v.initialCash} 元</td>
              </tr>
              <tr>
                <td className="k">最终现金</td>
                <td className="v">{v.finalAssets} 元</td>
              </tr>
              <tr className="hl">
                <td className="k">净利润</td>
                <td className="v" data-testid="net-profit">
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
