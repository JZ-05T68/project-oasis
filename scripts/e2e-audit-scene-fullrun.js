/**
 * Project Oasis — 浏览器审计场景 fullrun：完整成功远征（v0.1.4）。
 *
 * §58 要求覆盖「成功」这条完整路径：开局 → 买装备 → 去程 → 到矿 → 采矿 → 返程 → 成功结算。
 *
 * 设计要点（都是踩过坑之后的修正）：
 *  1. 走法必须**地形感知**：纯曼哈顿最短路会横穿整片沙漠，商队必然力竭
 *     （menu 场景在 seed audit-run1 上就是这样死的）。这里给沙漠格加权重绕开。
 *  2. 每次尝试都必须把对局**走到结算**，否则回不到开局界面、后续 Seed 无法重试
 *     （页面只有结算画面才提供「再来一局」，游戏内没有重开入口）。
 *  3. 在多个 Seed 之间重试，直到出现一次成功的完整远征。
 */
(function () {
  var O = window.__OASIS;
  if (!O) return 'lib-missing';
  // Seed 选择：由 scripts/find-ui-seed.ts 在 4000 个 Seed 里挑出「矿区离城市最近且去程几乎无沙漠」
  // 的种子（uiwin-* 系列，hops=10 / 沙漠占比 0%），
  // 让真人式点击走法不必依赖高明策略也能稳定走完一次成功远征。
  var SEEDS = ['uiwin-4', 'uiwin-117', 'uiwin-385', 'uiwin-521', 'audit-run1', 'audit-run2'];
  var DESERT_WEIGHT = 3; // 绕开沙漠的强度（越大越不愿意踩沙）

  function glyphOf(el) {
    var g = O.$('.grid-glyph', el);
    return g ? O.txt(g) : '?';
  }
  function isMineEl(el) {
    return /矿/.test(O.txt(el));
  }
  /**
   * **烧格感知**的「到城市距离场」。
   *
   * 为什么必须自己算：lib 里的 `bfsDistFrom` 是纯曼哈顿梯度，完全不知道
   * 「去程走过的普通格返程不可再进」这条核心规则，于是会把商队一路引向死胡同
   * （这正是 fullrun 一开始在 6 个 Seed 上全部 return-failed 的原因）。
   * 这里直接读 DOM 上的 data-trail 还原烧格集合，再做一次真正的 BFS。
   */
  function returnDistFromCity() {
    var dims = O.gridDims();
    var rows = dims.rows;
    var cols = dims.cols;
    var city = (rows - 1) + ':0';
    var cur = O.currentTile();
    var otherMines = O.$$('.grid-tile')
      .filter(function (t) {
        return isMineEl(t) && t.getAttribute('data-tileid') !== cur;
      })
      .map(function (t) {
        return t.getAttribute('data-tileid');
      });
    var burned = {};
    O.$$('.grid-tile').forEach(function (t) {
      var id = t.getAttribute('data-tileid');
      var tr = t.getAttribute('data-trail');
      if (tr === 'out' || tr === 'ret') burned[id] = true;
    });
    delete burned[cur];
    delete burned[city];
    otherMines.forEach(function (m) {
      burned[m] = true;
    });
    var dist = {};
    dist[city] = 0;
    var q = [city];
    while (q.length) {
      var c = q.shift();
      var p = c.split(':').map(Number);
      var nb = [
        [p[0] - 1, p[1]],
        [p[0] + 1, p[1]],
        [p[0], p[1] - 1],
        [p[0], p[1] + 1],
      ];
      for (var i = 0; i < 4; i++) {
        var rr = nb[i][0];
        var cc = nb[i][1];
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        var k = rr + ':' + cc;
        if (k in dist) continue;
        if (burned[k]) continue;
        dist[k] = dist[c] + 1;
        q.push(k);
      }
    }
    return dist;
  }

  /** 走一步：优先「离目标更近」且**不是沙漠**的格子 */
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
    var trail = [O.currentTile()];
    for (var s = 0; s < maxSteps; s++) {
      if (O.currentTile() === target) {
        O.R.trail = trail;
        return true;
      }
      if (O.$('.settlement')) {
        // 关键：踏进城市会**立即结算**，此时地图卸载、currentTile() 变 null。
        // 因此「结算画面是不是成功返城」才是返程成功与否的唯一判据
        // （早先只要看到 settlement 就 return false，导致每次成功返城都被判成失败）。
        O.R.trail = trail;
        return /成功返城/.test(O.txt(O.$('.settlement .verdict')));
      }
      var moved = await smartStep(target, useReturnField ? returnDistFromCity() : null);
      if (!moved) {
        O.R.trail = trail;
        return false;
      }
      trail.push(O.currentTile());
      if (useReturnField) {
        // 记录「返程轨迹」的历史峰值 —— 成功返城会立刻卸载地图，
        // 结算后再数就永远是 0 了（这是本场景踩过的第二个坑）。
        var n = O.$$('.grid-tile[data-trail="ret"]').length;
        if (n > (O.R.maxRet || 0)) O.R.maxRet = n;
        var ln = O.$$('.log-list li').length;
        if (ln > (O.R.maxLog || 0)) O.R.maxLog = ln;
      }
    }
    O.R.trail = trail;
    return false;
  }

  /**
   * 把当前对局走到结算为止。
   * 目的不是玩好，而是**保证下一个 Seed 能重新开局**（页面只有结算画面才有「再来一局」）。
   */
  async function drainToSettlement(maxSteps) {
    var city = String(O.gridDims().rows - 1) + ':0';
    for (var i = 0; i < maxSteps; i++) {
      if (O.$('.settlement')) return true;
      await smartStep(city, returnDistFromCity());
      if (!O.$$('.grid-tile.clickable').length && !O.$('.settlement')) {
        var k = await O.clearModals();
        if (k === 'SANDSTORM' || k === 'RAINSTORM') {
          await O.resolveWeatherModal();
          await O.clearResults();
        }
      }
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

  async function attempt(seed) {
    var ready = await O.gotoGame(seed, { tents: 2, compasses: 1 });
    if (!ready) return { seed: seed, ok: false, stage: 'gotoGame', backOk: false };
    await O.clearResults();
    await O.clearModals();
    O.R.maxRet = 0;
    O.R.maxLog = 0;
    var mines = O.mineTiles().map(function (t) {
      return t.getAttribute('data-tileid');
    });
    var near = mines.slice().sort(function (a, b) {
      return O.man(O.currentTile(), a) - O.man(O.currentTile(), b);
    })[0];
    var outboundOk = await smartWalk(near, 40);
    if (!outboundOk || O.$('.settlement')) {
      await drainToSettlement(90);
      var r0 = { seed: seed, ok: false, stage: 'outbound', trail: O.R.trail };
      r0.backOk = await backToStart();
      return r0;
    }
    var outTrail = O.$$('.grid-tile[data-trail="out"]').length;
    var mine = O.currentTile();
    var mineBtn = O.byTextOne('.action-btn', '挖矿');
    if (!mineBtn || mineBtn.disabled) {
      await drainToSettlement(90);
      var r1 = { seed: seed, ok: false, stage: 'mining-btn' };
      r1.backOk = await backToStart();
      return r1;
    }
    mineBtn.click();
    await O.sleep(340);
    var mineInfo = O.resultInfo();
    var gemsOk = /2 kg/.test(O.txt(O.$('.topbar')));
    await O.clearResults();
    await O.clearModals();
    var ret = O.byTextOne('.action-btn', '停止挖矿，开始返程');
    if (!ret) {
      await drainToSettlement(90);
      var r2 = { seed: seed, ok: false, stage: 'no-start-return' };
      r2.backOk = await backToStart();
      return r2;
    }
    ret.click();
    await O.sleep(340);
    await O.clearResults();
    await O.clearModals();
    // v0.1.4 负重机制：挖到宝石后「丢弃宝石减负」按钮必须出现且真的能减重（正值路径）
    var gemOf = function () {
      var m = O.txt(O.$('.topbar')).match(/宝石\s*(\d+)\s*kg/);
      return m ? Number(m[1]) : null;
    };
    var dayOf = function () {
      var m = O.txt(O.$('.topbar')).match(/第\s*(\d+)\s*\/\s*(\d+)\s*天/);
      return m ? Number(m[1]) : null;
    };
    var dropBtn = O.byTextOne('.action-btn', '丢弃');
    var dropCheck = { present: !!dropBtn };
    if (dropBtn) {
      var gBefore = gemOf();
      var dBefore = dayOf();
      dropBtn.click();
      await O.sleep(340);
      var dInfo = O.resultInfo();
      await O.clearResults();
      dropCheck.gems = gBefore + '→' + gemOf();
      dropCheck.days = dBefore + '→' + dayOf();
      dropCheck.reduced = gBefore !== null && gemOf() !== null && gemOf() < gBefore;
      dropCheck.dayKept = dBefore !== null && dayOf() === dBefore;
      dropCheck.title = dInfo ? dInfo.title : null;
    }
    var lockedTiles = O.$$('.grid-tile[data-locked="1"]').length;
    var city = String(O.gridDims().rows - 1) + ':0';
    var homeOk = await smartWalk(city, 40, true);
    var settled = !!O.$('.settlement');
    if (!settled) {
      await drainToSettlement(90);
      settled = !!O.$('.settlement');
    }
    var settlementText = settled ? O.txt(O.$('.settlement')) : '';
    var won = settled && /成功返城/.test(settlementText);
    var result = {
      seed: seed,
      ok: homeOk && won,
      stage: won ? 'done' : homeOk ? 'return' : 'return-failed',
      mine: mine,
      outTrail: outTrail,
      retTrail: O.R.maxRet || 0,
      lockedTiles: lockedTiles,
      mineInfo: mineInfo ? mineInfo.title : null,
      dropCheck: dropCheck,
      gemsOk: gemsOk,
      settlement: settlementText.slice(0, 260),
      logLines: Math.max(O.R.maxLog || 0, O.$$('.log-list li').length),
    };
    result.backOk = await backToStart();
    return result;
  }

  O.finalize('fullrun', async function () {
    var attempts = [];
    var winner = null;
    for (var i = 0; i < SEEDS.length; i++) {
      var r = await attempt(SEEDS[i]);
      attempts.push(r);
      if (r.ok) {
        winner = r;
        break;
      }
    }
    O.R.attempts = attempts.map(function (a) {
      return { seed: a.seed, ok: !!a.ok, stage: a.stage, backOk: a.backOk };
    });
    O.assert('至少在 1 个 Seed 上完成「开局→去程→采矿→返程→成功结算」全流程', !!winner, JSON.stringify(O.R.attempts));
    if (!winner) return;
    O.R.winner = winner;
    O.assert('去程阶段真的留下了「去」轨迹', winner.outTrail >= 5, 'out=' + winner.outTrail);
    O.assert('返程阶段真的留下了「回」轨迹', winner.retTrail >= 1, 'ret=' + winner.retTrail);
    O.assert('返程禁入格在返程阶段可见', winner.lockedTiles >= 3, 'locked=' + winner.lockedTiles);
    O.assert('采矿产生了即时反馈（挖矿结果弹窗）', !!winner.mineInfo, String(winner.mineInfo));
    O.assert('挖矿后顶栏宝石重量为 2 kg', winner.gemsOk === true, 'gemsOk=' + winner.gemsOk);
    O.assert('负重机制 · 有宝石时「丢弃宝石减负」按钮出现', !!(winner.dropCheck && winner.dropCheck.present), JSON.stringify(winner.dropCheck));
    O.assert('负重机制 · 点击丢弃后宝石真的减少', !!(winner.dropCheck && winner.dropCheck.reduced), JSON.stringify(winner.dropCheck));
    O.assert('负重机制 · 丢弃不消耗时间', !!(winner.dropCheck && winner.dropCheck.dayKept), JSON.stringify(winner.dropCheck));
    O.assert('成功结算画面出现并判定成功返城', /成功返城/.test(String(winner.settlement)), String(winner.settlement).slice(0, 180));
    O.assert(
      '结算公布最终鉴定单价 / 宝石销售额 / 净收益',
      /最终鉴定单价/.test(String(winner.settlement)) &&
        /宝石销售额/.test(String(winner.settlement)) &&
        /净收益/.test(String(winner.settlement)),
      String(winner.settlement).slice(0, 220),
    );
    O.assert('历史日志有完整记录（≥10 条）', winner.logLines >= 10, 'logLines=' + winner.logLines);
    O.assert('结算后「再来一局」可用并回到开局界面', winner.backOk === true, 'backOk=' + winner.backOk);
  });
})();
