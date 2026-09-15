/**
 * Project Oasis — 浏览器审计场景 economy（v0.3.0 Economic Independence Lab）。
 *
 * §53 要求的验收范围里，本场景覆盖：
 *   1. 规则页能看懂新机制（远征运营成本 / 延期求援）
 *   2. 顶栏实时显示「累计运营费」与求援「可赊账」（§50 反馈及时）
 *   3. 完整成功远征 → 结算页**经济瀑布**逐项出现且能对账（§48/§35）
 *   4. 「远征结果」与「经济结果」两张卡分开展示（§49：成功但亏损不是红色失败）
 *   5. 结算后「再来一局」可回到开局界面
 *
 * 复用 e2e-audit-lib.js 的 O.* 原语；走法沿用 fullrun 场景验证过的
 * 「烧格感知 BFS + 绕开沙漠」策略。
 */
(function () {
  var O = window.__OASIS;
  if (!O) return 'lib-missing';
  /**
   * v0.3.0 落盘后（帐篷 800 元），开局只买得起 2 顶帐篷 + 1 指南针，
   * 且运营费 overtime 前 22 天免费。此处挖矿天数从 12 降到 6：
   *  - 12 天在 800 元帐篷预算下会把 6 个 seed 全部推入耐力耗尽，
   *    结算页永远拿不到「成功返城」分支，§48 瀑布断言无法覆盖；
   *  - 6 天既能让总天数越过第 22 天（触发可观察的运营费），
   *    又能留下足够耐力完成返程，使成功分支可达。
   */
  var MINING_DAYS = 6;
  var SEEDS = [
    'uiwin-4', 'uiwin-117', 'uiwin-385', 'uiwin-521', 'audit-run1', 'audit-run2',
    'econ-win1', 'econ-win2', 'econ-win3', 'econ-win4', 'econ-win5', 'econ-win6',
    'econ-win7', 'econ-win8', 'econ-win9', 'econ-win10',
  ];
  var DESERT_WEIGHT = 3;

  function glyphOf(el) {
    var g = O.$('.grid-glyph', el);
    return g ? O.txt(g) : '?';
  }
  function isMineEl(el) {
    return /矿/.test(O.txt(el));
  }
  function returnDistFromCity() {
    var dims = O.gridDims();
    var city = (dims.rows - 1) + ':0';
    var cur = O.currentTile();
    var burned = {};
    O.$$('.grid-tile').forEach(function (t) {
      var tr = t.getAttribute('data-trail');
      if (tr === 'out' || tr === 'ret') burned[t.getAttribute('data-tileid')] = true;
    });
    var dist = {};
    dist[city] = 0;
    var q = [city];
    while (q.length) {
      var c = q.shift();
      var p = c.split(':').map(Number);
      var nb = [[p[0] - 1, p[1]], [p[0] + 1, p[1]], [p[0], p[1] - 1], [p[0], p[1] + 1]];
      for (var i = 0; i < 4; i++) {
        var rr = nb[i][0];
        var cc = nb[i][1];
        if (rr < 0 || cc < 0 || rr >= dims.rows || cc >= dims.cols) continue;
        var k = rr + ':' + cc;
        if (k in dist) continue;
        if (burned[k] && k !== cur) continue;
        dist[k] = dist[c] + 1;
        q.push(k);
      }
    }
    return dist;
  }
  async function smartStep(target, distOverride) {
    var k = await O.clearModals();
    if (k === 'SANDSTORM' || k === 'RAINSTORM') {
      await O.resolveWeatherModal();
      await O.clearResults();
      return true;
    }
    var moves = O.$$('.grid-tile.clickable');
    if (!moves.length) return false;
    var dist = distOverride || O.bfsDistFrom(target);
    var best = null;
    var bestScore = Infinity;
    for (var i = 0; i < moves.length; i++) {
      var id = moves[i].getAttribute('data-tileid');
      var d = id in dist ? dist[id] : 999;
      var desert = glyphOf(moves[i]) === '沙' ? 1 : 0;
      var sc = d + desert * DESERT_WEIGHT;
      if (sc < bestScore) {
        bestScore = sc;
        best = moves[i];
      }
    }
    if (!best) best = moves[0];
    var before = O.currentTile();
    best.click();
    await O.sleep(280);
    await O.clearResults();
    return O.currentTile() !== before;
  }
  async function smartWalk(target, maxSteps, useReturnField) {
    for (var s = 0; s < maxSteps; s++) {
      if (O.currentTile() === target) return true;
      if (O.$('.settlement')) return /成功返城/.test(O.txt(O.$('.settlement .verdict')));
      if (!(await smartStep(target, useReturnField ? returnDistFromCity() : null))) return false;
    }
    return false;
  }
  async function drainToSettlement(maxSteps) {
    var city = String(O.gridDims().rows - 1) + ':0';
    for (var i = 0; i < maxSteps; i++) {
      if (O.$('.settlement')) return true;
      await smartStep(city, returnDistFromCity());
    }
    return !!O.$('.settlement');
  }
  async function backToStart() {
    var again = O.byTextOne('.settle-actions button', '再来一局');
    if (!again) return false;
    again.click();
    await O.sleep(520);
    return !!O.$('input[aria-label="Seed"]');
  }

  /**
   * 结算瀑布数值/存在性断言一律基于 `attempt()` 返回的 rows 快照。
   *
   * 为什么不再直接查 DOM：`attempt()` 在返回前已经调用 backToStart()，
   * 页面那时已被导航回开局界面，`.settle-table` 不存在了 ——
   * 旧的 settleNum/settleHas 因此恒返回 null/false（v0.3.0 审计发现的时序 Bug）。
   */
  var ROWS_CACHE = [];
  function snapNumFrom(rows, label) {
    for (var i = 0; i < rows.length; i++) {
      var eq = rows[i].indexOf(' = ');
      if (eq < 0) continue;
      if (rows[i].slice(0, eq).indexOf(label) !== 0) continue;
      var m = /(-?\d+)/.exec(rows[i].slice(eq + 3));
      return m ? Number(m[1]) : null;
    }
    return null;
  }
  function snapHasFrom(rows, label) {
    for (var i = 0; i < rows.length; i++) {
      var eq = rows[i].indexOf(' = ');
      if (eq < 0) continue;
      if (rows[i].slice(0, eq).indexOf(label) === 0) return true;
    }
    return false;
  }
  function settleNum(label) { return snapNumFrom(ROWS_CACHE, label); }
  function settleHas(label) { return snapHasFrom(ROWS_CACHE, label); }

  async function attempt(seed) {
    var ready = await O.gotoGame(seed, { tents: 2, compasses: 1 });
    if (!ready) return { seed: seed, ok: false, stage: 'gotoGame' };
    await O.clearResults();
    await O.clearModals();

    /* ---- 顶栏：新机制必须实时可见（§50） ---- */
    var top = O.txt(O.$('.topbar')) || '';
    O.R.topbar = top.slice(0, 260);
    O.assert('顶栏显示「累计运营费」（运营成本实时可见，不是藏在结算里的税）', /累计运营费/.test(top), top.slice(0, 160));
    O.assert('顶栏求援状态显示「可赊账」（延期求援）', /可赊账/.test(top), top.slice(0, 160));

    /* ---- 规则页：新机制 1~3 句话能说明白（§43 G15） ---- */
    var rulesBtn = O.byTextOne('button', '规则') || O.byTextOne('.btn', '规则');
    if (rulesBtn) {
      rulesBtn.click();
      await O.sleep(320);
      var rt = O.txt(O.$('.rules-body') || O.$('.modal') || document.body).slice(0, 4000);
      O.R.rules = rt.slice(0, 300);
      O.assert('规则页说明「远征运营成本」', /远征运营成本/.test(rt), O.R.rules);
      O.assert('规则页说明「求援当场不收钱 / 回城结算」', /当场不收钱/.test(rt), O.R.rules);
      var closeBtn = O.byTextOne('.modal button', '关闭') || O.byTextOne('.rules button', '关闭');
      if (closeBtn) {
        closeBtn.click();
        await O.sleep(260);
      }
    } else {
      O.fail('规则页按钮存在', '未找到规则按钮');
    }

    /* ---- 走到矿区 ---- */
    var mines = O.mineTiles().map(function (t) {
      return t.getAttribute('data-tileid');
    });
    var near = mines.slice().sort(function (a, b) {
      return O.man(O.currentTile(), a) - O.man(O.currentTile(), b);
    })[0];
    var outboundOk = await smartWalk(near, 40);
    if (!outboundOk || O.$('.settlement')) {
      await drainToSettlement(90);
      var r0 = { seed: seed, ok: false, stage: 'outbound' };
      r0.backOk = await backToStart();
      return r0;
    }

    /* ---- 采矿：故意多挖几天，制造可观察的运营费（overtime 前 22 天免费） ---- */
    var mined = 0;
    for (var d = 0; d < MINING_DAYS; d++) {
      var mineBtn = O.byTextOne('.action-btn', '挖矿');
      if (!mineBtn || mineBtn.disabled) break;
      mineBtn.click();
      await O.sleep(220);
      await O.clearResults();
      await O.clearModals();
      mined += 1;
    }
    O.R.mined = mined;

    /* ---- 返程 ---- */
    var retBtn = O.byTextOne('.action-btn', '返程') || O.byTextOne('.action-btn', '返回');
    if (retBtn && !retBtn.disabled) {
      retBtn.click();
      await O.sleep(300);
      await O.clearResults();
      await O.clearModals();
    }
    var homeOk = await smartWalk(String(O.gridDims().rows - 1) + ':0', 60, true);
    if (!homeOk || !O.$('.settlement')) {
      await drainToSettlement(90);
    }
    if (!O.$('.settlement')) {
      var r2 = { seed: seed, ok: false, stage: 'no-settlement' };
      return r2;
    }
    var text = O.txt(O.$('.settlement'));
    var result = {
      seed: seed,
      ok: /成功返城|远征完成/.test(O.txt(O.$('.settlement .verdict'))),
      stage: 'settled',
      mined: mined,
      text: text.slice(0, 900),
      rows: O.$$('.settle-table tr').map(function (tr) {
        return O.txt(O.$('td.k', tr)) + ' = ' + O.txt(O.$('td.v', tr));
      }),
    };
    result.backOk = await backToStart();
    return result;
  }

  O.finalize('economy', async function () {
    var winner = null;
    var attempts = [];
    for (var i = 0; i < SEEDS.length; i++) {
      var r = await attempt(SEEDS[i]);
      attempts.push({ seed: r.seed, ok: !!r.ok, stage: r.stage, mined: r.mined });
      if (r.ok) {
        winner = r;
        break;
      }
    }
    O.R.attempts = attempts;
    O.assert('至少在 1 个 Seed 上完成「开局→采矿→返程→结算」全流程', !!winner, JSON.stringify(attempts));
    if (!winner) {
      O.R.lastText = (attempts.length && '') || '';
      return;
    }
    O.R.rows = winner.rows;
    ROWS_CACHE = winner.rows;

    /* ---- §48 瀑布逐项 ---- */
    O.assert('结算瀑布：初始资金', settleHas('初始资金'), JSON.stringify(winner.rows.slice(0, 8)));
    O.assert('结算瀑布：装备支出', settleHas('装备支出'), '');
    O.assert('结算瀑布：返城时手中现金', settleHas('返城时手中现金'), '');
    O.assert('结算瀑布：宝石销售额', settleHas('宝石销售额'), '');
    O.assert('结算瀑布：远征运营成本', settleHas('远征运营成本'), '');
    O.assert('结算瀑布：结算期费用合计', settleHas('结算期费用合计'), '');
    O.assert('结算瀑布：最终现金', settleHas('最终现金'), '');
    O.assert('结算瀑布：净利润', settleHas('净利润'), '');

    /* ---- §35 会计恒等式：从快照里读出来的数字必须自己能对上 ---- */
    /**
     * 符号约定修正（v0.3.0 审计修复）：
     * 结算页把费用行显示为 `-1440 元`，snapNum 会原样取到 -1440，
     * 而恒等式里这些项本来就是要被“减掉”的，若直接参与就会双重取负。
     * 因此这里对费用类字段统一取绝对值，让恒等式保持「收入 − 支出」的朴素形式。
     */
    var cash = settleNum('返城时手中现金');
    var gem = settleNum('宝石销售额');
    var late = Math.abs(settleNum('逾期折价') || 0);
    var exp = Math.abs(settleNum('结算期费用合计') || 0);
    var final = settleNum('最终现金');
    var net = settleNum('净利润');
    var init = settleNum('初始资金');
    O.R.accounting = { cash: cash, gem: gem, late: late, exp: exp, final: final, net: net, init: init };
    O.assert(
      '结算页数字自己对得上：最终现金 = 返城现金 + 宝石销售额 − 逾期折价 − 结算费用',
      cash !== null && gem !== null && final !== null && final === cash + gem - late - exp,
      JSON.stringify(O.R.accounting),
    );
    O.assert(
      '净利润 = 最终现金 − 初始资金（2000）',
      final !== null && init !== null && net === final - init,
      JSON.stringify(O.R.accounting),
    );

    /* ---- §49 成功与盈亏分开展示 ---- */
    O.assert('结算页把「远征结果」与「经济结果」分开展示', /远征结果/.test(winner.text) && /经济结果/.test(winner.text), winner.text.slice(0, 200));
    O.assert('结算后「再来一局」可回到开局界面', winner.backOk === true, 'backOk=' + winner.backOk);
  });
})();
