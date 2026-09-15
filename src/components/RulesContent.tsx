/**
 * v0.1.2a 完整书面规则（v0.1.2b 同步：草地暴雨 -2、即时反馈）。
 * - 首次进入游戏必须经过 RulesScreen（确认按钮）；
 * - 游戏中可通过 RulesModal 随时重看（打开不消耗天数）。
 * 规则内容与 docs/GAME_DESIGN.md 保持同步；数值一律读 gameConfig，不写死。
 */

import { gameConfig } from '../game';

function RulesContent() {
  return (
    <div className="rules-content">
      <h4>一、游戏目标</h4>
      <p>
        你携带 <b>{gameConfig.startCash} 元</b> 从城市出发，在 <b>{gameConfig.maxDays} 天</b> 内完成：
        <b>城市 → 矿区 → 挖矿 → 沿不重复路线返城</b>。宝石的精确单价在你
        <b>成功返城后才会鉴定公布</b>——矿区本身的客观开采难度会影响它的价值。
      </p>
      <h4>二、地图</h4>
      <p>
        <b>{gameConfig.map.rows}×{gameConfig.map.cols}</b> 格子地图（{gameConfig.map.rows * gameConfig.map.cols} 格，本轮真人试玩测试尺寸）。城市固定在<b>左下角 ({gameConfig.map.rows - 1},0)</b>；
        两个矿区（Mine A / Mine B）位于<b>最右侧一列</b>，位置每局随机，但<b>只出现在最上方的 6 行内</b>
        （不会紧贴右下角，否则远征距离过短）；其余格子的地形（草地/沙漠/村庄/绿洲）完全随机。
      </p>
      <h4>三、移动</h4>
      <p>只允许<b>上 / 下 / 左 / 右</b>四方向移动，每移动一格消耗 1 天，不允许斜向或越界。</p>
      <h4>四、去返程限制（核心规则）</h4>
      <p>
        去程走过的普通格会被"烧掉"：<b>返程不能再次经过</b>，返程自己也不能重复普通格。
        城市和你进入的矿区可以重复。规划一条去程时，必须给自己留一条回家的路。
      </p>
      <h4>五、时间</h4>
      <p>
        初始 <b>0 / {gameConfig.maxDays}</b> 天，全程固定不变——购买天气预报<b>不再消耗任何天数</b>。
        剩余时间不足以合法完成旅程，或路线被彻底封死时，远征会立即失败。
      </p>
      <h4>六、帐篷与宿营</h4>
      <p>
        每顶帐篷 {gameConfig.tentPrice} 元，最大耐久 <b>{gameConfig.tentDesertCharges}</b>。<b>多顶帐篷逐顶记录耐久，每顶都有独立编号（Tent A / B / C…），
        使用哪一顶由你自己选择——编号与耐久一一对应，绝不会选错。</b>
      </p>
      <ul>
        <li>野外（沙漠/草地/绿洲）与矿区的<b>原地停留都是宿营</b>：每天消耗所选帐篷 1 点耐久，没有帐篷不能在野外停留；</li>
        <li>
          <b>草地暴雨</b>中使用帐篷抵挡：该帐篷<b>整顶报废</b>（无论剩余耐久），但<b>耐力不减少</b>；
        </li>
        <li>
          <b>草地暴雨</b>中不使用帐篷硬扛：<b>耐力 -2</b>（本轮真人试玩暂定值，{gameConfig.weather.grassRain.staminaLossWithoutTent}）。耐力因此归零会立即失败，原因会明确告知「耐力耗尽」；
        </li>
        <li><b>城市与村庄</b>是安全住宿点：停留不需要帐篷、不花钱，但每天照常消耗时间。</li>
      </ul>
      <h4>七、绿洲</h4>
      <p>
        <b>有水绿洲</b>可以"修整"：1 天、+1 耐力，但修整必须宿营——需要帐篷并消耗 1 点耐久；
        每片绿洲每局只能有效修整一次。<b>干涸绿洲</b>不能修整，只按普通野外宿营停留。
      </p>
      <h4>八、矿区</h4>
      <p>
        每天挖 <b>2kg</b> 宝石，挖矿<b>不消耗帐篷</b>。矿区安全无天气无遭遇。
        但在矿区"什么都不做"地等待属于野外宿营：需要帐篷、耐久 -1。
      </p>
      <h4>八之二、负重与返程（v0.1.4 正式规则）</h4>
      <p>
        宝石背得越多，驼队穿越沙漠越吃力：载重超过 <b>{gameConfig.mechanisms.loadReturn.thresholdKg}kg</b> 之后，
        每多背 <b>{gameConfig.mechanisms.loadReturn.stepKg}kg</b>，返程每穿越 <b>1 格沙漠</b>就
        <b>多耗 {gameConfig.mechanisms.loadReturn.maxExtraPerDesertTile} 天</b>
        （单格最多 +{gameConfig.mechanisms.loadReturn.maxExtraPerDesertTile} 天）。
      </p>
      <p>
        觉得太重，可以随时<b>丢弃宝石</b>减负：丢弃<b>不消耗时间</b>、也不消耗金钱，
        载重降到 {gameConfig.mechanisms.loadReturn.thresholdKg}kg 以下就完全恢复正常速度。
        所以「再挖一天」不只是多花一天 —— 它还会让你的回家路变长。
      </p>
      {gameConfig.mechanisms.returnIntel.enabled && (
        <>
          <h4>八之三、返程情报（v0.2.0 新机制）</h4>
          <p>
            远方的路不再全凭记忆：<b>抵达矿区</b>时，驼队会就地勘察，自动揭示返程方向的
            <b>{gameConfig.mechanisms.returnIntel.coneCandidates} 格</b>候选路线地图（越靠近城市的格子越优先）。
            {gameConfig.mechanisms.returnIntel.mode === 'compass' && (
              <>
                {' '}你还可以在野外<b>消耗 {gameConfig.mechanisms.returnIntel.compassCostPerScout} 个指南针</b>
                <b>侦察前方 {gameConfig.mechanisms.returnIntel.scoutRadius} 格</b>（不消耗天数），
                把未知地形提前看清楚。
              </>
            )}
            {gameConfig.mechanisms.returnIntel.mode === 'survey1' && (
              <> 你还可以主动<b>侦察以当前格为中心的 {gameConfig.mechanisms.returnIntel.scoutRadius} 格范围</b>，不消耗天数。</>
            )}
            情报只揭示地形与距离，<b>不会告诉你宝石价格</b>——路线更清楚，不代表更赚钱。
          </p>
        </>
      )}
      {gameConfig.mechanisms.villageService.enabled && (
        <>
          <h4>八之四、村庄服务（v0.2.0 新机制）</h4>
          <p>
            村庄不只是安全住宿点，还能<b>用现金换资源</b>（消费不影响宝石鉴定）：
          </p>
          <ul>
            <li>
              <b>休整</b>：每恢复 1 点耐力 <b>{gameConfig.mechanisms.villageService.restCostPerStamina} 元</b>，
              单次最多恢复 {gameConfig.mechanisms.villageService.restMaxStamina} 点
              {gameConfig.mechanisms.villageService.restCostsDay ? '，并消耗 1 天' : '，不消耗天数'}；
            </li>
            <li>
              <b>买情报</b>：<b>{gameConfig.mechanisms.villageService.intelPrice} 元</b>揭示周边
              {gameConfig.mechanisms.villageService.intelTiles} 格地形；
            </li>
            {gameConfig.mechanisms.villageService.sellEnabled && (
              <li>
                <b>卖宝石减负</b>：按鉴定价的 <b>{Math.round(gameConfig.mechanisms.villageService.sellPriceRatio * 100)}%</b> 就地折现，
                每次最多卖 {gameConfig.mechanisms.villageService.sellStepKg}kg——提前落袋，但也放弃了返城后的全价。
              </li>
            )}
          </ul>
        </>
      )}
      {gameConfig.mechanisms.surgeMining.enabled && (
        <>
          <h4>八之五、深层采矿（v0.2.0 新机制）</h4>
          <p>
            在矿区可以冒险<b>突击深层矿脉</b>：一次产出提升到平日的
            <b>{gameConfig.mechanisms.surgeMining.yieldMultiplier} 倍</b>，
            代价是多花 <b>{gameConfig.mechanisms.surgeMining.extraDays} 天</b>
            {gameConfig.mechanisms.surgeMining.staminaCost > 0 ? `、消耗 ${gameConfig.mechanisms.surgeMining.staminaCost} 点耐力` : ''}
            {gameConfig.mechanisms.surgeMining.oncePerRun ? '。每局只能使用一次' : ''}。
            挖得越猛，背得越重，回家的路就越难走。
          </p>
        </>
      )}
      {gameConfig.mechanisms.emergencyRescue.enabled && (
        <>
          <h4>八之六、紧急求援</h4>
          <p>
            当返程预计<b>剩余时间不足 {gameConfig.mechanisms.emergencyRescue.triggerMarginDays} 天</b>、
            或<b>耐力见底</b>时，可以呼叫商队<b>紧急求援</b>：延长
            <b> {gameConfig.mechanisms.emergencyRescue.extraDays} 天</b> 期限并恢复
            <b> {gameConfig.mechanisms.emergencyRescue.staminaBack} 点耐力</b>
            {gameConfig.mechanisms.emergencyRescue.maxUses > 0 ? `（每局最多 ${gameConfig.mechanisms.emergencyRescue.maxUses} 次）` : ''}。
            {gameConfig.mechanisms.rescueSettlement.enabled ? (
              <>
                {' '}
                求援<b>当场不收钱</b>——驼队愿意赊账；但安全返城结算时，他们要从你的宝石收入里
                {gameConfig.mechanisms.rescueSettlement.deferredDebt > 0
                  ? `拿走 <b>${gameConfig.mechanisms.rescueSettlement.deferredDebt} 元</b>`
                  : ''}
                {gameConfig.mechanisms.rescueSettlement.deferredDebt > 0 && gameConfig.mechanisms.rescueSettlement.revenueShare > 0 ? '，外加 ' : ''}
                {gameConfig.mechanisms.rescueSettlement.revenueShare > 0
                  ? `分走销售收入的 <b>${Math.round(gameConfig.mechanisms.rescueSettlement.revenueShare * 100)}%</b>`
                  : ''}
                。救得回命，不一定救得回钱包——货不值钱的时候，认赔可能比叫救援更划算。
              </>
            ) : (
              <>
                {' '}
                代价是当场支付 <b>{gameConfig.mechanisms.emergencyRescue.cost} 元</b>现金。
                它能在你快要赶不上时间时把你捞回来，<b>但会把利润直接吃掉一大块</b>——
                安全返城与赚钱，是两件需要分别考虑的事。
              </>
            )}
          </p>
        </>
      )}
      {gameConfig.mechanisms.upkeep.enabled && (
        <>
          <h4>八之七、远征运营成本</h4>
          <p>
            远征不是免费的：驮队、草料与补给每天都在烧钱。
            {gameConfig.mechanisms.upkeep.mode === 'overtime' ? (
              <>
                {' '}
                前 <b>{gameConfig.mechanisms.upkeep.freeDays} 天</b>由商队承担，从第
                <b> {gameConfig.mechanisms.upkeep.freeDays + 1} 天</b>起，每天要付
                <b> {gameConfig.mechanisms.upkeep.overtimeCostPerDay} 元</b>。
              </>
            ) : gameConfig.mechanisms.upkeep.mode === 'miningDay' ? (
              <>
                {' '}
                在矿区每驻扎 1 天，要交<b> {gameConfig.mechanisms.upkeep.costPerDay} 元</b>场地与抽水费。
              </>
            ) : (
              <>
                {' '}
                每进行 1 天要付<b> {gameConfig.mechanisms.upkeep.costPerDay} 元</b>。
              </>
            )}
            {' '}这笔钱<b>回城结算时一并支付</b>，走得多快就付得多省——
            多挖一天值不值，得把它算进去。
          </p>
        </>
      )}
      {gameConfig.mechanisms.lateSale.enabled && (
        <>
          <h4>八之八、城门集市有截止日</h4>
          <p>
            城门集市只开到第 <b>{gameConfig.maxDays - gameConfig.mechanisms.lateSale.graceDays} 天</b>。
            之后回城的宝石只能折价卖给贩子，<b>少卖 {Math.round(gameConfig.mechanisms.lateSale.discount * 100)}%</b>。
            赶得上集市和挖得到矿，是两件要同时权衡的事。
          </p>
        </>
      )}
      <h4>九、天气预报</h4>
      <p>
        天气预报<b>使用现金购买</b>：每包 <b>{gameConfig.forecast.packPrice} 元</b>，
        获得 <b>{gameConfig.forecast.chargesPerPack} 次</b>局部次日预报，购买后立即自动使用
        <b> {gameConfig.forecast.autoUseOnPurchase} 次</b>。
        每次预报只预测<b>下一天</b>、只覆盖<b>当前格 + 周围一圈邻格</b>
        （角落 4 格 / 边缘 6 格 / 内部 9 格）。
        购买预报<b>不消耗天数</b>，使用预报<b>不消耗天数也不消耗耐力</b>；
        剩余次数可长期储存、不过期、可以带入返程。天气预报<b>只能预测自然天气</b>——
        盗贼、商队、市集、牧民等人为遭遇无法被预测，它也不会永久揭开未知地形。
        现金不足时无法购买（不允许负现金）。
      </p>
      <h4>十、随机事件</h4>
      <p>
        旅途中的事件是<b>一次性</b>的随机遭遇（首次踏入某格时才可能发生），
        不会因为原地停留而反复刷新。商队会卖二手帐篷，牧民会指点周边地形。
      </p>
      <h4>十一、宝石价格</h4>
      <p>
        游戏全程<b>不显示矿区精确单价</b>。成功返城后进行最终鉴定并结算收入。
        矿区越难安全往返，宝石通常越值钱；你实际怎么走、受多少伤，都改变不了鉴定结果。
      </p>
      <h4>十二、失败条件</h4>
      <p>
        以下情况都会导致远征失败：<b>耐力归零</b>；<b>不存在任何合法完成路线</b>；
        <b>剩余时间已无法完成旅程</b>；<b>超过时间限制</b>。失败时会明确告知原因。
      </p>
      <h4>十三、即时反馈</h4>
      <p>
        任何<b>关键资源变化</b>（耐力、金钱、帐篷耐久/报废、指南针、天气预报次数、
        宝石、天数）都会在结算后<b>立即弹窗</b>，并以
        <b>「变化前 → 变化后」</b>的形式列出；一次事件改变多项资源时只弹一个综合结果。
        右下角的旅途日志同时保留全部历史记录，可供随时回溯。
      </p>
    </div>
  );
}

export default RulesContent;
