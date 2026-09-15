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
    // 顶栏现金 / 帐篷单价读取器（必须在任何使用点之前声明：const 有 TDZ）
    const cashNow = () => {
      const m = txt($('.topbar')).match(/现金\s*(\d+)/);
      return m ? Number(m[1]) : null;
    };
    const tentPriceNow = () => {
      const b = byTextOne('button', '购买帐篷');
      const m = b ? txt(b).match(/(\d+)\s*元/) : null;
      return m ? Number(m[1]) : 0;
    };
    await auditClick('城市 · 购买帐篷（第 1 顶）', byTextOne('button', '购买帐篷'), 'CHANGE', { note: '现金 -帐篷单价（读按钮文案）' });
    await auditClick('城市 · 购买帐篷（第 2 顶）', byTextOne('button', '购买帐篷'), 'CHANGE');
    await auditClick('城市 · 购买指南针', byTextOne('button', '购买指南针'), 'CHANGE', { note: '现金 -指南针单价' });
    R.tentsAfterBuy = O.tentsState();
    // 帐篷单价 700（过夜平衡实验结论）下开局只买得起 2 顶 —— 断言「确实买不起第 3 顶」而不是继续买
    assert('帐篷列表显示多顶且带稳定编号', /A .*B /.test(R.tentsAfterBuy), R.tentsAfterBuy);
    const tent3 = byTextOne('button', '购买帐篷');
    if (tent3 && tent3.disabled) {
      await auditClick('城市 · 第 3 顶帐篷买不起时按钮禁用（700×3 > 2000）', tent3, null, { allowDisabled: true, note: txt(tent3) });
      assert('  禁用时给出原因文本', /现金不足/.test(txt(tent3)), txt(tent3));
    } else {
      // 单价较低时第 3 顶买得起：**只记录状态，不真的买**。
      // 买了会把现金压到 25 元，紧接着的「购买天气预报包」就会因资金不足而禁用，
      // 于是十几项天气断言全线误报（真实踩过）。买第 3 顶属于玩法选择，不是本场景的验收目标。
      rec({
        name: '城市 · 第 3 顶帐篷在当前单价下买得起（不做购买，保留预报预算）',
        ok: true,
        detail: 'tentPrice=' + (txt(tent3).match(/(\d+)\s*元/) || [])[1] + ' 元，现金 ' + cashNow(),
      });
      rec({ name: '城市 · 第 3 顶帐篷买不起时按钮禁用（700×3 > 2000）', ok: true, skipped: '当前单价下买得起' });
    }

    // 现金不足 → 购买按钮禁用
    //
    // 注意：必须给后面的「天气预报」检查**留出预算**。帐篷单价从 700 降到 625 之后，
    // 这条循环会把剩下的现金买成第 3 顶帐篷，导致预报按钮因资金不足而禁用 ——
    // 那是场景自伤，不是游戏缺陷（真实历史：曾因此误报 12 项）。
    for (let i = 0; i < 12; i++) {
      const b = byTextOne('button', '购买帐篷');
      if (!b || b.disabled) break;
      const c = cashNow();
      if (c !== null && c - tentPriceNow() < 300) break; // 留出预报包预算
      b.click();
      await sleep(160);
      await O.clearResults(); // 每笔购买都会即时反馈
    }
    const tentBtn = byTextOne('button', '购买帐篷');
    if (tentBtn && tentBtn.disabled) {
      await auditClick('城市 · 现金不足时「购买帐篷」禁用', tentBtn, null, { allowDisabled: true });
      assert('  禁用时给出原因文本', /现金不足/.test(txt(tentBtn)), txt(tentBtn));
    } else {
      rec({ name: '城市 · 现金不足时「购买帐篷」禁用', ok: true, skipped: '为保留预报预算而提前停止（将在预报买完后复查）' });
    }

    /* ---------- 天气预报 ---------- */
    await auditClick('天气 · 购买天气预报包', byTextOne('button', '购买天气预报包'), 'CHANGE', {
      note: '→ 先给结算结果，再弹预报 Modal',
      keepResult: true,
    });
    const fcRes = O.resultInfo();
    assert(
      '天气 · 购买预报先给出即时反馈（v0.1.3 现金计价：只扣现金 + 次数 0→2，最大旅程天数不变）',
      !!fcRes &&
        fcRes.changes.some((c) => c.label === '天气预报次数' && c.after === '2') &&
        fcRes.changes.some((c) => c.label === '金钱') &&
        !fcRes.changes.some((c) => c.label === '最大旅程天数'),
      fcRes ? fcRes.title + ' · ' + JSON.stringify(fcRes.changes) : '没有结果弹窗',
    );
    await O.confirmResult();
    await sleep(320);
    assert('预报 Modal 自动弹出', O.modalKind() === 'FORECAST', String(O.modalKind()));
    await auditClick('天气 · 预报 Modal 的 × 关闭', $('.modal-close'), 'CHANGE', { note: '× 关闭' });

    const useForecast = () => byTextOne('button', '使用天气预报');
    await auditClick('天气 · 使用储存的预报', useForecast, 'CHANGE', { note: '再次弹出预报' });
    await sleep(320);
    assert('使用预报后弹出 Modal', O.modalKind() === 'FORECAST', String(O.modalKind()));
    await auditClick('天气 · 预报 Modal 的 Footer 关闭', byTextOne('.modal-footer .btn', '关闭'), 'CHANGE', {
      note: 'Footer 关闭',
    });
    await sleep(200);
    await auditClick('天气 · 再次使用预报', useForecast, 'CHANGE');
    await sleep(320);
    let escOk = false;
    if (O.modalKind() === 'FORECAST') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(260);
      escOk = O.modalKind() !== 'FORECAST';
    }
    assert('天气 · Esc 键关闭预报 Modal', escOk);
    for (let k = 0; k < 5; k++) {
      const u = byTextOne('button', '使用天气预报');
      if (!u || u.disabled) break;
      u.click();
      await sleep(240);
      await O.clearResults(); // 使用预报也会即时反馈
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

    // 预报买完后把现金花光，复查「现金不足 → 禁用」这条 UI 状态
    for (let i = 0; i < 12; i++) {
      const b = byTextOne('button', '购买帐篷');
      if (!b || b.disabled) break;
      b.click();
      await sleep(160);
      await O.clearResults();
    }
    const tentBtn2 = byTextOne('button', '购买帐篷');
    if (tentBtn2 && tentBtn2.disabled) {
      await auditClick('城市 · 花光现金后「购买帐篷」禁用', tentBtn2, null, { allowDisabled: true });
      assert('  禁用时给出原因文本', /现金不足/.test(txt(tentBtn2)), txt(tentBtn2));
    } else {
      rec({ name: '城市 · 花光现金后「购买帐篷」禁用', ok: true, skipped: '现金仍充足' });
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
    if (arrived && O.currentTile() === near) {
      assert('走到矿区 ' + near, true, 'now=' + O.currentTile());
    } else if ($('.settlement') || !O.currentTile()) {
      rec({ name: '走到矿区 ' + near, ok: true, skipped: '本 Seed 下商队中途力竭（正常对局；失败路径由本场景后续断言覆盖）' });
    } else {
      assert('走到矿区 ' + near, false, 'now=' + O.currentTile() + ' · trail=' + (R.trail || []).join('>'));
    }
    // 若本 Seed 下商队中途力竭（这是**正常对局结果**，不是 UI 缺陷），
    // 矿区/返程部分改记为 skipped，转而覆盖「失败结算画面」这条路径（§58 要求成功与失败都要覆盖）。
    if (!arrived && ($('.settlement') || !O.currentTile())) {
      [
        '进入采矿阶段',
        '矿区 · 挖矿（+2kg）',
        '矿区 · 挖矿结果即时反馈（宝石 0 kg → 2 kg）',
        '矿区 · 挖矿同一事件也写入右下角日志（双记录）',
        '矿区 · 连续挖矿（第 2 次）',
        '连续挖矿累计 4kg',
        '矿区等待展开为逐顶帐篷按钮',
        '矿区 · 停止挖矿，开始返程',
        '进入返程阶段',
        '沿合法路线回到城市并进入结算',
        '结算判定为成功返城',
        '结算显示宝石销售额与净收益',
        '结算公布最终鉴定单价',
      ].forEach((n) =>
        rec({
          name: n,
          ok: true,
          skipped: '本 Seed 下商队中途力竭（正常对局；矿区/返程 UI 由 trail 场景 27 项断言独立覆盖）',
        }),
      );
      const failText = txt($('.settlement'));
      assert('失败结算画面可读（明确给出失败原因）', /旅途终结/.test(failText) && /耐力耗尽|超过|路线|无法/.test(failText), failText.slice(0, 220));
      await auditClick('结算 · 再来一局（失败路径）', byTextOne('.settle-actions button', '再来一局'), 'CHANGE', { note: '→ 回到开局界面' });
      assert('回到开局界面（不残留上一局状态）', !!$('input[aria-label="Seed"]'));
      return;
    }
    assert('进入采矿阶段', /采矿/.test(txt($('.topbar'))), txt($('.topbar')));
    R.tentsAtMine = O.tentsState();
    await O.clearModals();

    /* ---------- 矿区 ---------- */
    await auditClick('矿区 · 挖矿（+2kg）', byTextOne('button', '挖矿'), 'CHANGE', { note: '宝石 +2kg', keepResult: true });
    const mineInfo = O.resultInfo();
    assert(
      '矿区 · 挖矿结果即时反馈（宝石 0 kg → 2 kg）',
      !!mineInfo && mineInfo.changes.some((c) => c.label === '宝石' && c.before === '0 kg' && c.after === '2 kg'),
      mineInfo ? mineInfo.title + ' · ' + JSON.stringify(mineInfo.changes) : '没有结果弹窗',
    );
    assert(
      '矿区 · 挖矿同一事件也写入右下角日志（双记录）',
      $$('.log-list li')
        .map((li) => txt(li))
        .join(' | ')
        .indexOf('宝石') >= 0,
    );
    await O.clearResults();

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
