/**
 * Project Oasis — 浏览器审计场景 feedback：关键资源变化的即时反馈（ResultModal）。
 *
 * 覆盖 Human Playtest Fix Round 1 的第 8~13 条：
 *  - 金钱 / 帐篷 / 耐力的变化必须弹窗，且显示「变化前 → 变化后」；
 *  - 一次事件改变多个资源 → 只弹一个综合结果；
 *  - 同一事件同时写入右下角日志（双记录）；
 *  - 普通移动 / 城市停留（没有资源变化）不弹窗（不做成弹窗模拟器）；
 *  - 结果弹窗可用「确定」/ × / Esc 三种方式关闭。
 *
 * Seed audit-0：(6,0) 是干涸绿洲（无天气伤害、无遭遇），因此「走出城市」这一步
 * 不会产生任何结算结果，正好用来验证「不过度弹窗」。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, rec, pass, fail, assert, auditClick, sleep } = O;
  const R = O.R;
  const CASH0 = 2000;
  const TENT_PRICE = 400;
  const COMPASS_PRICE = 100;

  function logText() {
    return $$('.log-list li')
      .map((li) => txt(li))
      .join(' | ');
  }
  function changeRow(info, label) {
    return info ? info.changes.filter((c) => c.label === label)[0] : null;
  }
  /** 断言弹窗里存在一条「label：before → after」 */
  function assertFlow(name, info, label, before, after) {
    const row = changeRow(info, label);
    return assert(
      name,
      !!row && row.before === before && row.after === after && row.arrow === '→',
      info ? info.title + ' · ' + label + ' ' + (row ? row.before + ' → ' + row.after : '（缺行）') + ' · ' + JSON.stringify(info.changes) : '没有结果弹窗',
    );
  }

  const scene = async () => {
    const ready = await O.gotoGame('audit-0', { tents: 0, compasses: 0 });
    assert('feedback · 进入游戏', ready);
    assert('feedback · 开局没有任何结算弹窗', !O.resultEl(), String(O.modalKind()));

    /* ---------- 1. 购买帐篷：金钱 + 新帐篷合成同一个结果 ---------- */
    await auditClick('反馈 · 购买帐篷', O.byTextOne('button', '购买帐篷'), 'CHANGE', { keepResult: true });
    let info = O.resultInfo();
    assert('反馈 · 购买帐篷弹出统一结果弹窗', !!info && info.title === '购买完成', info ? info.title : '没有弹窗');
    assertFlow('反馈 · 金钱显示 2000 → 1600', info, '金钱', '¥' + CASH0, '¥' + (CASH0 - TENT_PRICE));
    assertFlow('反馈 · 新帐篷显示 无 → 3/3', info, 'Tent A（新）', '无', '3/3');
    const logAfterBuy = logText();
    assert('反馈 · 同一笔购买也写入右下角日志（双记录）', logAfterBuy.indexOf('购买一顶帐篷') >= 0, logAfterBuy.slice(-140));
    await auditClick('反馈 · 结果弹窗「确定」可关闭', $('[data-testid="result-confirm"]'), 'CHANGE', { note: '确定按钮' });
    assert('反馈 · 确定后弹窗消失', !O.resultEl());

    /* ---------- 2. × 关闭 ---------- */
    await auditClick('反馈 · 购买指南针', O.byTextOne('button', '购买指南针'), 'CHANGE', { keepResult: true });
    info = O.resultInfo();
    assertFlow('反馈 · 指南针数量 0 → 1', info, '指南针', '0', '1');
    await auditClick('反馈 · 结果弹窗 × 可关闭', $('[data-testid="result-modal"] .modal-close'), 'CHANGE', { note: '×' });
    assert('反馈 · × 关闭后弹窗消失', !O.resultEl());

    /* ---------- 3. Esc 关闭 ---------- */
    await auditClick('反馈 · 再次购买帐篷（第 2 顶）', O.byTextOne('button', '购买帐篷'), 'CHANGE', { keepResult: true });
    let escOk = false;
    if (O.resultEl()) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(260);
      escOk = !O.resultEl();
    }
    assert('反馈 · 结果弹窗 Esc 可关闭', escOk);

    /* ---------- 4. 天气预报包：maxDays + 次数合成一个结果，随后显示预报 ---------- */
    await auditClick('反馈 · 购买天气预报包', O.byTextOne('button', '购买天气预报包'), 'CHANGE', { keepResult: true });
    info = O.resultInfo();
    assert('反馈 · 天气预报包只有一个综合结果弹窗', !!info && info.title === '天气预报已购买', info ? info.title : '没有弹窗');
    assertFlow('反馈 · 最大旅程天数 42 → 41', info, '最大旅程天数', '42', '41');
    assertFlow('反馈 · 天气预报次数 0 → 2（含自动使用 1 次）', info, '天气预报次数', '0', '2');
    assert(
      '反馈 · 结果弹窗与预报弹窗不叠加（先结果后预报）',
      !!O.resultEl() && O.$('.forecast-grid9') === null,
      'result=' + !!O.resultEl() + ' forecastGrid=' + !!O.$('.forecast-grid9'),
    );
    await O.confirmResult();
    await sleep(260);
    assert('反馈 · 确认结果后才显示天气预报 Modal', O.modalKind() === 'FORECAST', String(O.modalKind()));
    const closeFc = $('.modal-close');
    if (closeFc) {
      closeFc.click();
      await sleep(220);
    }

    /* ---------- 5. 城市停留：只推进时间 → 不弹窗，但日志照记 ---------- */
    const logLenBefore = $$('.log-list li').length;
    const stay = O.byTextOne('button', '原地停留');
    assert('反馈 · 城市存在「原地停留」按钮', !!stay, stay ? txt(stay) : '无');
    if (stay) {
      stay.click();
      await sleep(320);
      assert('反馈 · 城市停留不弹结算窗（只更新 HUD 与日志）', !O.resultEl(), String(O.modalKind()));
      assert('反馈 · 城市停留仍写入日志', $$('.log-list li').length > logLenBefore, logLenBefore + ' → ' + $$('.log-list li').length);
    }

    /* ---------- 6. 普通移动：没有资源变化 → 不弹窗 ---------- */
    const moved = await O.stepAnywhere();
    assert('反馈 · 从城市走到了邻格', moved && O.currentTile() === '6:0', 'now=' + O.currentTile() + ' · ' + O.terrainHere());
    assert('反馈 · 普通移动（无天气伤害/无遭遇）不弹结算窗', !O.resultEl() && O.modalKind() === null, String(O.modalKind()));

    R.feedbackOk = true;
    R.cashAfter = (txt($('.topbar')).match(/现金 (\d+)/) || [])[1];
  };

  await O.finalize('feedback', scene);
  return 'done:feedback';
})();
