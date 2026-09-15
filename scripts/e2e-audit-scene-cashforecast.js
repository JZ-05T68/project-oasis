/**
 * Project Oasis — 浏览器审计场景：天气预报「现金计价」专项（v0.1.3）。
 *
 * 覆盖用户要求的验收点：
 *   1. 实际购买天气预报
 *   2. 金钱扣除正确（结果弹窗 + 顶栏双重校验）
 *   3. 次数正确增加
 *   4. 天数上限保持不变（购买前后 maxDays 完全一致）
 *   5. 局部天气排列（角落 4 格，按真实方位，禁止越界补位）
 *   6. 剩余次数展示
 *   7. 多次购买正确累加
 *   8. 文案（全站不得再出现「最大天数 -1 / 最大旅程天数 -1」旧文案）
 *   9. 日志
 *  10. Result Modal（变化前 → 变化后）
 *  11. 余额不足 → 按钮禁用 + 「资金不足」
 *  12. 游戏完整流程（购买后能继续正常走格子）
 *
 * 由 scripts/run-browser-audit.sh 注入（WorkBuddy 自带浏览器 agent-browser）。
 */
(function () {
  var O = window.__OASIS;
  if (!O) return 'lib-missing';

  var EXPECT_PRICE = window.__EXPECT_PRICE || 300;
  var EXPECT_CHARGES = window.__EXPECT_CHARGES || 3;
  var AFTER_BUY = EXPECT_CHARGES - 1; // 立即自动使用 1 次

  /** 顶栏数字读取 */
  O.topNumbers = function () {
    var tb = O.$('.topbar');
    if (!tb) return { cash: null, charges: null, day: null, maxDays: null };
    var t = O.txt(tb);
    var cash = t.match(/现金\s*(\d+)\s*元/);
    var ch = t.match(/预报次数\s*(\d+)/);
    var day = t.match(/第\s*(\d+)\s*\/\s*(\d+)\s*天/);
    return {
      cash: cash ? Number(cash[1]) : null,
      charges: ch ? Number(ch[1]) : null,
      day: day ? Number(day[1]) : null,
      maxDays: day ? Number(day[2]) : null,
    };
  };

  O.forecastBuyBtn = function () {
    return O.byTextOne('.action-btn', '购买天气预报包');
  };
  O.forecastUseBtn = function () {
    return O.byTextOne('.action-btn', '使用天气预报');
  };

  /** 全站文案扫描：任何位置都不得再出现旧的「天数 -1」计价文案 */
  O.scanForLegacyText = function () {
    var body = document.body.innerText || '';
    var bad = [];
    ['最大天数 -1', '最大天数-1', '最大旅程天数 -1', '最大旅程天数-1', '最大旅程天数降至', '最大允许天数', '永久 -1']
      .forEach(function (s) {
        if (body.indexOf(s) >= 0) bad.push(s);
      });
    return bad;
  };

  O.finalize('cashforecast', async function () {
    /* ---------- 0. 进入游戏（day 0，城市，不买任何装备） ---------- */
    var ok = await O.gotoGame('fc-audit-1');
    O.assert('进入游戏（城市 day 0）', ok, ok ? 'topbar=' + O.txt(O.$('.topbar')) : '未进入游戏');
    if (!ok) return;

    var s0 = O.topNumbers();
    O.assert(
      '初始状态可读',
      s0.cash !== null && s0.charges === 0 && s0.maxDays !== null,
      JSON.stringify(s0),
    );

    /* ---------- 1. 规则页文案已同步 ---------- */
    O.assert('开局界面不存在旧的「天数 -1」计价文案', O.scanForLegacyText().length === 0, O.scanForLegacyText().join(' / ') || 'clean');

    var rulesBtn = O.$('.rules-btn');
    if (rulesBtn) {
      rulesBtn.click();
      await O.sleep(400);
      var rulesText = O.txt(O.$('.modal-body')) || '';
      O.assert(
        '规则页：天气预报说明改为现金购买',
        rulesText.indexOf('使用现金购买') >= 0 && rulesText.indexOf('不消耗天数') >= 0,
        '片段=' + rulesText.slice(Math.max(0, rulesText.indexOf('九、天气预报')), rulesText.indexOf('九、天气预报') + 150),
      );
      O.assert(
        '规则页：删除「购买天气预报会减少最大旅程天数」',
        rulesText.indexOf('最大允许天数') < 0 && rulesText.indexOf('永久 -1') < 0,
        'clean',
      );
      O.assert('规则页：禁止旧文案全站扫描通过', O.scanForLegacyText().length === 0, O.scanForLegacyText().join(' / ') || 'clean');
      var close = O.$('.modal-close') || O.byTextOne('.modal-footer .btn', '关闭');
      if (close) close.click();
      await O.sleep(300);
    } else {
      O.fail('找到规则按钮', 'rules-btn 不存在');
    }

    /* ---------- 2. 购买按钮文案与价格 ---------- */
    var buyBtn = O.forecastBuyBtn();
    O.assert('存在「购买天气预报包（X 元）」按钮', !!buyBtn, buyBtn ? O.txt(buyBtn) : '缺失');
    if (!buyBtn) return;
    var btnLabel = O.txt(buyBtn);
    var mPrice = btnLabel.match(/购买天气预报包（(\d+)\s*元）/);
    O.assert('按钮文案包含现金价格', !!mPrice, btnLabel);
    O.assert(
      '按钮价格与配置一致（' + EXPECT_PRICE + ' 元）',
      !!mPrice && Number(mPrice[1]) === EXPECT_PRICE,
      '文案价格=' + (mPrice ? mPrice[1] : '?'),
    );
    O.assert('按钮文案声明「不消耗天数」', btnLabel.indexOf('不消耗天数') >= 0, btnLabel);
    O.assert('按钮未禁用（开局现金充足）', !buyBtn.disabled, 'disabled=' + buyBtn.disabled);

    /* ---------- 3. 第一次购买：点击 + 结果弹窗 ---------- */
    var cashBefore = s0.cash;
    var dayBefore = s0.day;
    var maxBefore = s0.maxDays;
    var hit = O.hitTest(buyBtn);
    O.assert('购买按钮指针可达', hit.state === 'OK', JSON.stringify(hit));
    buyBtn.click();
    await O.sleep(450);

    var infos = await O.collectResults(6);
    O.assert('购买产生了 Result Modal', infos.length >= 1, '弹窗数=' + infos.length);
    var buyInfo = infos.filter(function (i) {
      return i.title.indexOf('天气预报已购买') >= 0;
    })[0];
    if (!buyInfo) {
      O.fail('结果弹窗标题为「天气预报已购买」', JSON.stringify(infos.map(function (i) { return i.title; })));
    } else {
      O.pass('结果弹窗标题为「天气预报已购买」', buyInfo.title);
      var cashCh = buyInfo.changes.filter(function (c) { return c.label.indexOf('现金') >= 0 || c.label.indexOf('金钱') >= 0; })[0];
      var fcCh = buyInfo.changes.filter(function (c) { return c.label.indexOf('天气预报') >= 0; })[0];
      O.assert(
        'Result Modal 显示现金变化（变化前 → 变化后）',
        !!cashCh && cashCh.before.replace(/[^0-9]/g, '') === String(cashBefore),
        cashCh ? cashCh.label + ' ' + cashCh.before + ' → ' + cashCh.after : '缺少现金变化行',
      );
      O.assert(
        '现金变化幅度 = ' + EXPECT_PRICE + ' 元',
        !!cashCh && Number(cashCh.before.replace(/[^0-9]/g, '')) - Number(cashCh.after.replace(/[^0-9]/g, '')) === EXPECT_PRICE,
        cashCh ? cashCh.before + ' → ' + cashCh.after : '—',
      );
      O.assert(
        'Result Modal 显示预报次数增加',
        !!fcCh && Number(fcCh.after) > Number(fcCh.before),
        fcCh ? fcCh.label + ' ' + fcCh.before + ' → ' + fcCh.after : '缺少预报次数变化行',
      );
      O.assert(
        'Result Modal 不再出现「最大旅程天数」变化行',
        buyInfo.changes.every(function (c) { return c.label.indexOf('最大') < 0; }),
        JSON.stringify(buyInfo.changes.map(function (c) { return c.label; })),
      );
    }

    /* ---------- 4. 天数上限保持不变（核心机制断言） ---------- */
    var s1 = O.topNumbers();
    O.assert('购买后现金正确减少 ' + EXPECT_PRICE + ' 元', s1.cash === cashBefore - EXPECT_PRICE, cashBefore + ' → ' + s1.cash);
    O.assert('购买后天数上限不变', s1.maxDays === maxBefore, maxBefore + ' → ' + s1.maxDays);
    O.assert('购买不消耗天数（day 未推进）', s1.day === dayBefore, dayBefore + ' → ' + s1.day);
    O.assert(
      '购买后预报次数 = 每包 ' + EXPECT_CHARGES + ' 次 − 自动使用 1 次 = ' + AFTER_BUY,
      s1.charges === AFTER_BUY,
      'charges=' + s1.charges,
    );

    /* ---------- 5. 预报弹窗：局部天气排列 + 剩余次数（必须在 clearModals 之前检查） ---------- */
    await O.sleep(320);
    var fmodal = O.$('[data-testid="forecast-modal"]');
    O.assert('购买后自动弹出天气预报弹窗', !!fmodal, fmodal ? O.txt(O.$('.modal-header', fmodal)) : '未弹出');
    if (fmodal) {
      var cells = O.$$('[data-testid="forecast-grid"] [data-tileid]');
      // 城市固定在 (7,0)，是左下角 → 只有 N / NE / C / E 共 4 格
      O.assert('角落格预报 = 4 格（当前 + 3 邻域）', cells.length === 4, '实际=' + cells.length);
      var dirs = cells.map(function (c) { return c.getAttribute('data-dir'); }).sort().join(',');
      O.assert('角落格方位正确（北 / 东北 / 东 / 当前格，无越界补位）', dirs === '东,东北,北,当前格'.split(',').sort().join(','), 'dirs=' + dirs);
      var coords = cells.map(function (c) { return c.getAttribute('data-tileid'); }).sort().join(' ');
      O.assert('角落格坐标正确（6:0 / 6:1 / 7:0 / 7:1，越界格不下发）', coords === '6:0 6:1 7:0 7:1', coords);
      var cur = cells.filter(function (c) { return c.getAttribute('data-testid') === 'forecast-cell-00'; });
      O.assert('存在唯一「当前格」卡片 (7,0)', cur.length === 1 && cur[0].getAttribute('data-tileid') === '7:0', 'cur=' + (cur[0] && cur[0].getAttribute('data-tileid')));
      var remainEl = O.$('[data-testid="forecast-remaining-count"]');
      O.assert('预报弹窗显示剩余次数（' + AFTER_BUY + '）', !!remainEl && remainEl.innerText.trim() === String(AFTER_BUY), remainEl ? remainEl.innerText.trim() : '缺失');
      var ftext = O.txt(O.$('.modal-body', fmodal));
      O.assert('预报弹窗说明「最大旅程天数不受影响」', ftext.indexOf('最大旅程天数不受影响') >= 0, ftext.slice(-80));
      var fc = O.$('.modal-close', fmodal) || O.byTextOne('.modal-footer .btn', '关闭');
      if (fc) fc.click();
      await O.sleep(250);
    }
    await O.clearModals();

    /* ---------- 6. 走格子：天数推进 + 次数可储存（不随天数流失） ---------- */
    var moves = 0;
    for (var i = 0; i < 4; i++) {
      if (!O.gameReady()) break;
      if (await O.stepAnywhere()) moves += 1;
      if (!O.gameReady()) break;
    }
    var sFlow = O.topNumbers();
    if (O.gameReady()) {
      O.assert('购买预报后仍能正常移动推进天数', sFlow.day > dayBefore, 'day=' + dayBefore + ' → ' + (sFlow && sFlow.day));
      O.assert(
        '移动后预报次数不随天数流失（可储存、不过期）',
        sFlow.charges === AFTER_BUY,
        'charges=' + (sFlow && sFlow.charges),
      );
      O.assert('移动后天数上限仍不变', sFlow.maxDays === maxBefore, 'maxDays=' + (sFlow && sFlow.maxDays));
    } else {
      O.pass('走格子流程：对局在途中正常结束（进入结算界面，非崩溃）', 'moves=' + moves);
    }

    /* ---------- 7. 手动使用：次数 −1，天数与现金不变 ---------- */
    if (O.gameReady()) {
      var useBtn = O.forecastUseBtn();
      O.assert('存在「使用天气预报（剩余 N 次）」按钮', !!useBtn, useBtn ? O.txt(useBtn) : '缺失');
      if (useBtn) {
        O.assert('使用按钮文案带剩余次数', new RegExp('剩余\\s*' + AFTER_BUY + '\\s*次').test(O.txt(useBtn)), O.txt(useBtn));
        var pre = O.topNumbers();
        useBtn.click();
        await O.sleep(420);
        await O.collectResults(6);
        var s2 = O.topNumbers();
        if (O.gameReady()) {
          O.assert('手动使用后次数 −1', s2.charges === AFTER_BUY - 1, 'charges=' + pre.charges + ' → ' + s2.charges);
          O.assert('手动使用不消耗天数', s2.day === pre.day, 'day=' + s2.day);
          O.assert('手动使用不消耗现金', s2.cash === pre.cash, 'cash=' + s2.cash);
        }
        await O.clearModals();
        await O.sleep(200);
      }
    }

    /* ---------- 8. 多次购买正确累加 ---------- */
    if (O.gameReady()) {
      var s3 = O.topNumbers();
      var b2 = O.forecastBuyBtn();
      if (b2 && !b2.disabled) {
        b2.click();
        await O.sleep(420);
        await O.collectResults(6);
        await O.clearModals();
        var s4 = O.topNumbers();
        O.assert('再次购买：现金再减 ' + EXPECT_PRICE, s4.cash === s3.cash - EXPECT_PRICE, s3.cash + ' → ' + s4.cash);
        O.assert(
          '再次购买：次数正确累加（存量 + ' + EXPECT_CHARGES + ' − 1）',
          s4.charges === s3.charges + AFTER_BUY,
          s3.charges + ' → ' + s4.charges,
        );
        O.assert('再次购买后天数上限仍不变', s4.maxDays === maxBefore, 'maxDays=' + s4.maxDays);
      } else {
        O.fail('再次购买按钮可用', '按钮缺失或禁用（cash=' + (s3 && s3.cash) + '）');
      }

      /* ---------- 9. 日志 ---------- */
      var logText = O.txt(O.$('.log-list') || document.body);
      O.assert(
        '旅途日志记录了购买预报（含金额）',
        logText.indexOf('购买天气预报包') >= 0 && logText.indexOf('-' + EXPECT_PRICE + ' 元') >= 0,
        logText.indexOf('购买天气预报包') >= 0 ? '已记录' : '日志缺失',
      );

      /* ---------- 10. 余额不足 → 按钮禁用 + 「资金不足」 ---------- */
      var guard = 0;
      while (guard < 20 && O.gameReady()) {
        guard += 1;
        var b = O.forecastBuyBtn();
        if (!b || b.disabled) break;
        b.click();
        await O.sleep(320);
        await O.collectResults(6);
        await O.clearModals();
      }
      var broke = O.topNumbers();
      var bFinal = O.forecastBuyBtn();
      O.assert('现金被买空后仍不允许负现金', broke.cash === null || broke.cash >= 0, 'cash=' + broke.cash);
      if (bFinal && bFinal.disabled) {
        O.pass('余额不足时购买按钮被禁用', 'cash=' + broke.cash);
        var hintEl = bFinal.parentElement ? O.byTextOne('.hint', '资金不足', bFinal.parentElement) : null;
        O.assert('禁用原因明确提示「资金不足」', !!hintEl, hintEl ? O.txt(hintEl) : '未找到提示文案');
      } else {
        O.fail('余额不足时购买按钮被禁用', 'cash=' + broke.cash + ' disabled=' + (bFinal && bFinal.disabled));
      }
    }

    var legacyAfter = O.scanForLegacyText();
    O.assert('全程未出现旧「天数 -1」文案', legacyAfter.length === 0, legacyAfter.join(' / ') || 'clean');
    O.assert('场景结束时游戏未崩溃（仍在游戏内或已正常结算）', O.gameReady() || !!O.$('.settlement'), 'gameReady=' + O.gameReady());
  });
  return 'scene-cashforecast-ready';
})();
