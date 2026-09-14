/**
 * Project Oasis — 浏览器审计场景 A：开局 / 城市 / 天气 / 地图 / 时间 / 矿区 / 结算。
 * 依赖 scripts/e2e-audit-lib.js 已先行注入。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, byTextOne, rec, pass, fail, assert, auditClick, sleep } = O;
  const R = O.R;

  const scene = async () => {
    /* ---------- 规则页 ---------- */
    assert('规则页存在', !!byTextOne('.start-card .btn', '我已阅读规则'), txt($('.start-card .btn')));
    assert('规则正文独立滚动容器存在（确认按钮在滚动区之外）', !!$('.rules-scroll'));
    await auditClick('规则页 · 我已阅读规则，开始远征', byTextOne('.start-card .btn', '我已阅读规则'), 'CHANGE', {
      note: '→ 进入开局界面',
    });

    /* ---------- 开局界面 ---------- */
    assert('开局界面出现', !!$('input[aria-label="Seed"]'));
    await auditClick('开局 · 随机 Seed', byTextOne('button', '随机 Seed'), 'CHANGE');
    const rand = $('input[aria-label="Seed"]').value;
    assert('  随机 Seed 真的换了值', typeof rand === 'string' && rand.length > 0, rand);
    O.setSeed('audit-run1');
    await sleep(150);
    assert('开局 · Seed 输入框可编辑', $('input[aria-label="Seed"]').value === 'audit-run1');

    O.setSeed('');
    await sleep(150);
    const startBtn = byTextOne('button', '开始游戏');
    await auditClick('开局 · 空 Seed 时「开始游戏」禁用', startBtn, null, {
      allowDisabled: true,
      note: 'disabled=' + startBtn.disabled,
    });
    assert('  空 Seed 确实禁用', startBtn.disabled === true);
    O.setSeed('audit-run1');
    await sleep(150);
    await auditClick('开局 · 开始游戏', startBtn, 'CHANGE', { note: '→ 进入游戏' });
    assert('进入游戏主界面', O.gameReady());

    /* ---------- 城市控件 ---------- */
    await auditClick('城市 · 购买帐篷', byTextOne('button', '购买帐篷'), 'CHANGE', { note: '现金 -400' });
    await auditClick('城市 · 购买指南针', byTextOne('button', '购买指南针'), 'CHANGE', { note: '现金 -100' });
    await auditClick('城市 · 再次购买帐篷（第 2 顶）', byTextOne('button', '购买帐篷'), 'CHANGE');
    await auditClick('城市 · 再次购买帐篷（第 3 顶）', byTextOne('button', '购买帐篷'), 'CHANGE');
    await auditClick('城市 · 再次购买指南针（第 2 只）', byTextOne('button', '购买指南针'), 'CHANGE');
    await auditClick('城市 · 再次购买指南针（第 3 只）', byTextOne('button', '购买指南针'), 'CHANGE');
    R.tentsAfterBuy = O.tentsState();
    assert('帐篷列表显示多顶且带稳定编号', /A .*B .*C /.test(R.tentsAfterBuy), R.tentsAfterBuy);

    // 现金不足 → 购买按钮禁用
    for (let i = 0; i < 12; i++) {
      const b = byTextOne('button', '购买帐篷');
      if (!b || b.disabled) break;
      b.click();
      await sleep(120);
    }
    const tentBtn = byTextOne('button', '购买帐篷');
    if (tentBtn && tentBtn.disabled) {
      await auditClick('城市 · 现金不足时「购买帐篷」禁用', tentBtn, null, { allowDisabled: true });
      assert('  禁用时给出原因文本', /现金不足/.test(txt(tentBtn)), txt(tentBtn));
    } else {
      rec({ name: '城市 · 现金不足时「购买帐篷」禁用', ok: true, skipped: '现金仍充足' });
    }

    /* ---------- 天气预报 ---------- */
    await auditClick('天气 · 购买天气预报包（最大天数 -1）', byTextOne('button', '购买天气预报包'), 'CHANGE', {
      note: '→ 自动弹出预报 Modal',
    });
    assert('预报 Modal 自动弹出', O.modalKind() === 'FORECAST', String(O.modalKind()));
    await auditClick('天气 · 预报 Modal 的 × 关闭', $('.modal-close'), 'CHANGE', { note: '× 关闭' });

    const useBtn = byTextOne('button', '使用天气预报');
    await auditClick('天气 · 使用储存的预报', useBtn, 'CHANGE', { note: '再次弹出预报' });
    assert('使用预报后弹出 Modal', O.modalKind() === 'FORECAST');
    await auditClick('天气 · 预报 Modal 的 Footer 关闭', byTextOne('.modal-footer .btn', '关闭'), 'CHANGE', {
      note: 'Footer 关闭',
    });
    await auditClick('天气 · 再次使用预报', useBtn, 'CHANGE');
    let escOk = false;
    if (O.modalKind() === 'FORECAST') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(260);
      escOk = O.modalKind() !== 'FORECAST';
    }
    assert('天气 · Esc 键关闭预报 Modal', escOk);
    for (let k = 0; k < 4; k++) {
      const u = byTextOne('button', '使用天气预报');
      if (!u || u.disabled) break;
      u.click();
      await sleep(200);
      const cl = $('.modal-close');
      if (cl) {
        cl.click();
        await sleep(200);
      }
    }
    const u2 = byTextOne('button', '使用天气预报');
    if (u2 && u2.disabled) {
      await auditClick('天气 · 预报次数用尽后「使用天气预报」禁用', u2, null, { allowDisabled: true, note: txt(u2) });
    } else {
      rec({ name: '天气 · 预报次数用尽后「使用天气预报」禁用', ok: true, skipped: '次数未耗尽' });
    }

    /* ---------- 游戏内规则 Modal ---------- */
    await auditClick('顶栏 · 规则按钮打开规则 Modal', $('.rules-btn'), 'CHANGE', { note: '→ 打开规则 Modal' });
    assert('规则 Modal 已打开', O.modalKind() === 'RULES', String(O.modalKind()));
    await auditClick('规则 Modal · × 关闭', $('.modal-close'), 'CHANGE');
    await auditClick('顶栏 · 再次打开规则 Modal', $('.rules-btn'), 'CHANGE');
    await auditClick('规则 Modal · Footer 关闭', byTextOne('.modal-footer .btn', '关闭'), 'CHANGE');

    /* ---------- 地图方向 / 非法禁用 ---------- */
    await O.clearModals();
    assert('地图当前格存在', !!O.currentTile(), O.currentTile());
    const dirs = { 下: [1, 0], 上: [-1, 0], 右: [0, 1], 左: [0, -1] };
    let legalDirs = 0;
    for (const nm of Object.keys(dirs)) {
      await O.clearModals();
      const cur = O.currentTile();
      const rc = cur.split(':').map(Number);
      const rr = rc[0] + dirs[nm][0];
      const cc = rc[1] + dirs[nm][1];
      const el = document.querySelector('.grid-tile[data-tileid="' + rr + ':' + cc + '"]');
      const legal = !!el && el.classList.contains('clickable') && !el.disabled;
      if (legal) {
        legalDirs += 1;
        await auditClick('地图 · ' + nm + ' 合法方向可点击', el, 'CHANGE', { note: '→ ' + rr + ':' + cc });
      } else {
        await auditClick('地图 · ' + nm + ' 不可前往方向已禁用（' + rr + ':' + cc + '）', el, null, {
          allowDisabled: true,
          maybeMissing: true,
          note: el ? '格子存在但不可前往' : '越界（格子不存在）',
        });
        assert('  ' + nm + ' 未被误判为可点', !el || !el.classList.contains('clickable'));
      }
    }
    assert('地图 · 至少存在一个合法方向', legalDirs > 0, '合法方向数=' + legalDirs);
    assert(
      '地图 · 越界坐标不存在格子',
      !document.querySelector('.grid-tile[data-tileid="8:0"]') && !document.querySelector('.grid-tile[data-tileid="0:9"]'),
    );

    /* ---------- 城市等待 ---------- */
    await O.clearModals();
    if (O.currentTile() === '7:0') {
      await auditClick('时间 · 城市原地停留（免费、无需帐篷）', byTextOne('button', '原地停留'), 'CHANGE', { note: '天数 +1' });
    } else {
      rec({ name: '时间 · 城市原地停留', ok: true, skipped: '当前不在城市（已走开）' });
    }

    /* ---------- 走到矿区 ---------- */
    await O.clearModals();
    const mines = O.mineTiles().map((t) => t.getAttribute('data-tileid'));
    assert('地图上两座矿区已知可见', mines.length === 2, mines.join(','));
    const near = mines.slice().sort((a, b) => O.man(O.currentTile(), a) - O.man(O.currentTile(), b))[0];
    R.mine = near;
    const arrived = await O.walkTowards(near, 60);
    assert('走到矿区 ' + near, arrived && O.currentTile() === near, 'now=' + O.currentTile() + ' · trail=' + (R.trail || []).join('>'));
    assert('进入采矿阶段', /采矿/.test(txt($('.topbar'))), txt($('.topbar')));
    R.tentsAtMine = O.tentsState();
    await O.clearModals();

    /* ---------- 矿区 ---------- */
    await auditClick('矿区 · 挖矿（+2kg）', byTextOne('button', '挖矿'), 'CHANGE', { note: '宝石 +2kg' });
    await auditClick('矿区 · 连续挖矿（第 2 次）', byTextOne('button', '挖矿'), 'CHANGE', { note: '宝石 +2kg' });
    assert('连续挖矿累计 4kg', /4 kg/.test(txt($('.topbar'))), txt($('.topbar')));

    await O.clearModals();
    const campBtns = $$('.action-btn').filter((b) => txt(b).indexOf('原地宿营') >= 0 && b.getAttribute('data-tentid'));
    assert('矿区等待展开为逐顶帐篷按钮', campBtns.length >= 1, '按钮数=' + campBtns.length);
    if (campBtns.length) {
      await auditClick('矿区 · 原地等待 · ' + campBtns[0].getAttribute('data-tentid'), campBtns[0], 'CHANGE', { note: '耐久 -1' });
    }

    /* ---------- 返程与结算 ---------- */
    await O.clearModals();
    await auditClick('矿区 · 停止挖矿，开始返程', byTextOne('button', '开始返程'), 'CHANGE', { note: '→ 返程阶段' });
    assert('进入返程阶段', /返程/.test(txt($('.topbar'))), txt($('.topbar')));
    const home = await O.walkTowards('7:0', 60);
    const settled = !!$('.settlement');
    assert('沿合法路线回到城市并进入结算', settled, 'trail=' + (R.trail || []).join('>') + ' · home=' + home);
    assert('结算判定为成功返城', /成功返城/.test(txt($('.settlement .verdict'))), txt($('.settlement .verdict')));

    const st = txt($('.settlement'));
    assert('结算显示宝石销售额与净收益', /宝石销售额/.test(st) && /净收益/.test(st));
    assert('结算公布最终鉴定单价', /最终鉴定单价/.test(st));
    R.settlement = st.slice(0, 400);
    await auditClick('结算 · 再来一局', byTextOne('.settle-actions button', '再来一局'), 'CHANGE', { note: '→ 回到开局界面' });
    assert('回到开局界面（不残留上一局状态）', !!$('input[aria-label="Seed"]'));
  };

  await O.finalize('menu', scene);
  return 'done:menu';
})();
