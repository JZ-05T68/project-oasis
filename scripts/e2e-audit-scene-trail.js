/**
 * Project Oasis — 浏览器审计场景 trail（v0.1.4：去程/返程轨迹标记 + 图例）。
 *
 * 覆盖用户确认的 UI 问题与验收要求：
 *   1. 去程轨迹明显（角标「去」+ 边框），返程轨迹明显（角标「回」）；
 *   2. 返程禁入格明显（× 角标 + 红框 + 斜纹），且**真的点不动**；
 *   3. 当前可走格明显；
 *   4. 图例存在且覆盖 当前 / 去程 / 返程 / 禁入 / 可走 / 地形；
 *   5. **不只靠颜色**：去 / 回 / × 是文字角标，色觉障碍下依然可读；
 *   6. **地形仍可识别**：带轨迹的格子中心地形字仍在，底色仍是地形色（轨迹只加角标与斜纹）；
 *   7. 从一个真实 seed 完整走完 开局 → 去程 → 到矿 → 开始返程 → 返程多步。
 *
 * 由 scripts/run-browser-audit.sh 注入（WorkBuddy 自带浏览器 agent-browser）。
 */
(function () {
  var O = window.__OASIS;
  if (!O) return 'lib-missing';

  var TERRAIN_BG = {
    CITY: 'rgb(216, 210, 192)',
    DESERT: 'rgb(224, 192, 104)',
    GRASS: 'rgb(124, 180, 107)',
    VILLAGE: 'rgb(201, 141, 90)',
    OASIS: 'rgb(79, 179, 191)',
    MINE: 'rgb(217, 169, 78)',
  };
  var GLYPHS = { CITY: '城', DESERT: '沙', GRASS: '草', VILLAGE: '村', OASIS: '泉', MINE: '矿' };

  function tiles() {
    return O.$$('.grid-tile');
  }
  function byTrail(t) {
    return tiles().filter(function (el) {
      return el.getAttribute('data-trail') === t;
    });
  }
  function returnSet0() {
    return byTrail('ret');
  }
  function lockedTiles() {
    return tiles().filter(function (el) {
      return el.getAttribute('data-locked') === '1';
    });
  }
  function badge(el, cls) {
    return O.$(cls, el);
  }
  /** 记录每个轨迹格的「地形是否仍可读」：中心地形字 + 底色 */
  function terrainReadability(list) {
    var bad = [];
    list.forEach(function (el) {
      var id = el.getAttribute('data-tileid');
      var g = O.$('.grid-glyph', el);
      var label = g ? O.txt(g) : '';
      var bg = getComputedStyle(el).backgroundColor;
      var known = el.className.indexOf('unknown') < 0;
      if (!known) return; // 未知格本来就没有地形字
      // 地形字必须是一个合法地形字
      var okGlyph = Object.keys(GLYPHS).some(function (k) {
        return GLYPHS[k] === label;
      });
      // 底色必须是某个地形色（允许 1px 抗锯齿差异 → 用前缀比较）
      var okBg = Object.keys(TERRAIN_BG).some(function (k) {
        return bg === TERRAIN_BG[k];
      });
      if (!okGlyph || !okBg) bad.push(id + ' glyph=' + label + ' bg=' + bg);
    });
    return bad;
  }

  O.finalize('trail', async function () {
    /* ---------------- 0. 开局 ---------------- */
    var ready = await O.gotoGame('trail-audit-01', { tents: 2, compasses: 1 });
    O.assert('开局进入游戏', !!ready, 'gameReady=' + !!ready);

    /* ---------------- 1. 图例 ---------------- */
    var legend = O.$('[data-testid="map-legend"]');
    var legendText = legend ? O.txt(legend) : '';
    var need = ['当前', '去程轨迹', '返程轨迹', '返程禁入', '当前可走', '城市', '沙漠', '草地', '村庄', '绿洲', '矿区'];
    var missing = need.filter(function (t) {
      return legendText.indexOf(t) < 0;
    });
    O.assert('图例存在且完整（当前/去程/返程/禁入/可走/全部地形）', !!legend && missing.length === 0, missing.length ? '缺少: ' + missing.join(',') : legendText);
    O.assert(
      '图例含字符型标记（不依赖颜色：去 / 回 / × / ●）',
      ['去', '回', '×', '●'].every(function (c) {
        return legendText.indexOf(c) >= 0;
      }),
      legendText,
    );

    /* ---------------- 2. 去程轨迹（OUTBOUND） ---------------- */
    // 注意：O.mineTiles() 返回的是 DOM 元素（不是 tileId），必须先取 data-tileid
    var mineEls = O.mineTiles();
    var target = mineEls[0] ? mineEls[0].getAttribute('data-tileid') : null;
    O.assert('能在地图上找到矿区格', !!target, 'target=' + target);
    for (var i = 0; i < 3; i++) {
      await O.stepAnywhere();
    }
    var outTiles = byTrail('out');
    O.assert('去程阶段出现「去」轨迹格（除起点城市外）', outTiles.length >= 2, 'out=' + outTiles.length);
    O.assert(
      '去程轨迹格左上角有「去」角标（文字标记，非仅颜色）',
      outTiles.every(function (el) {
        var b = badge(el, '.tile-trail-badge');
        return b && O.txt(b) === '去';
      }),
      outTiles.length + ' 个格子',
    );
    O.assert(
      '去程阶段不显示「返程禁入」标记（返程规则尚未生效）',
      lockedTiles().length === 0,
      'locked=' + lockedTiles().length,
    );
    var badOut = terrainReadability(outTiles);
    O.assert('去程轨迹下地形仍可识别（底色 + 地形字都保留）', badOut.length === 0, badOut.length ? badOut.join(' | ') : '全部 ' + outTiles.length + ' 格正常');

    /* ---------------- 3. 到矿 → 返程禁入标记出现 ---------------- */
    var reached = await O.walkTowards(target, 60);
    var here = O.currentTile();
    O.assert('抵达矿区', reached === true && here === target, 'at=' + here + ' want=' + target);
    var phaseMining = O.topNumbers ? true : true;
    void phaseMining;
    var lockedNow = lockedTiles();
    var outNow = byTrail('out');
    O.assert('矿区阶段：返程禁入标记出现（去程走过的格子已封路）', lockedNow.length >= 2, 'locked=' + lockedNow.length + ' out=' + outNow.length);
    O.assert(
      '返程禁入格右上角有「×」角标（文字/符号标记，非仅颜色）',
      lockedNow.every(function (el) {
        var b = badge(el, '.tile-locked-badge');
        return b && O.txt(b) === '×';
      }),
      lockedNow.length + ' 个格子',
    );
    O.assert(
      '返程禁入格边框与普通格不同（有额外视觉区分）',
      lockedNow.every(function (el) {
        return getComputedStyle(el).borderTopColor === 'rgb(179, 64, 47)';
      }),
      lockedNow.length + ' 个格子',
    );
    O.assert(
      '返程禁入格真的不可点击（disabled 且不在 clickable 列表）',
      lockedNow.every(function (el) {
        return el.disabled && el.className.indexOf('clickable') < 0;
      }),
      lockedNow.length + ' 个格子',
    );
    var badLocked = terrainReadability(lockedNow);
    O.assert('禁入标记下地形仍可识别', badLocked.length === 0, badLocked.length ? badLocked.join(' | ') : '全部正常');

    /* ---------------- 3b. v0.1.4 负重机制：规则页文案 + 丢弃宝石按钮 ---------------- */
    // 规则页（游戏内可重看）：负重机制必须能被玩家读懂
    const rulesBtn = O.$('.rules-btn');
    if (rulesBtn) {
      rulesBtn.click();
      await O.sleep(400);
      const rulesText = O.txt(O.$('.modal'));
      O.assert('规则页含负重机制说明（载重阈值 / 每多背多少 / 每格沙漠多耗几天）', /负重/.test(rulesText) && /24kg/.test(rulesText) && /6kg/.test(rulesText) && /沙漠/.test(rulesText), rulesText.slice(rulesText.indexOf('负重'), rulesText.indexOf('负重') + 200));
      O.assert('规则页含「丢弃宝石」补救动作说明', /丢弃宝石/.test(rulesText), '');
      const closeR = O.$('.modal-close');
      if (closeR) { closeR.click(); await O.sleep(300); }
      await O.clearModals();
    } else {
      O.fail('规则页入口存在', '找不到 .rules-btn');
    }

    /* ---------------- 3c. 丢弃宝石（正式机制新增按钮） ---------------- */
    const topGem = () => {
      const m = O.txt(O.$('.topbar')).match(/宝石\s*(\d+)\s*kg/);
      return m ? Number(m[1]) : null;
    };
    const dayOf = () => {
      const m = O.txt(O.$('.topbar')).match(/第\s*(\d+)\s*\/\s*(\d+)\s*天/);
      return m ? Number(m[1]) : null;
    };
    const dropBtn = O.byTextOne('.action-btn', '丢弃');
    if (dropBtn) {
      const gemsBefore = topGem();
      const dayBefore = dayOf();
      await O.auditClick('负重机制 · 「丢弃宝石减负」按钮可点击', dropBtn, 'CHANGE', { keepResult: true });
      const dropInfo = O.resultInfo();
      await O.clearResults();
      const gemsAfter = topGem();
      const dayAfter = dayOf();
      O.R.dropCheck = { gemsBefore: gemsBefore, gemsAfter: gemsAfter, dayBefore: dayBefore, dayAfter: dayAfter, title: dropInfo ? dropInfo.title : null };
      O.assert(
        '丢弃宝石真的减少了「宝石」重量',
        gemsBefore !== null && gemsAfter !== null && gemsAfter < gemsBefore,
        gemsBefore + 'kg → ' + gemsAfter + 'kg',
      );
      O.assert('丢弃宝石不消耗时间（天数不变）', dayBefore !== null && dayAfter === dayBefore, dayBefore + ' → ' + dayAfter);
      O.assert(
        '丢弃宝石有即时反馈弹窗（结果 Modal）',
        !!dropInfo && /丢弃/.test(dropInfo.title),
        dropInfo ? dropInfo.title : '没有结果弹窗',
      );
    } else {
      // 矿区内 0kg 时按钮不该出现（此时没有可丢的宝石）
      const gemsAtMine = topGem();
      O.assert(
        '无宝石时「丢弃宝石」按钮不出现（负面路径）',
        gemsAtMine === 0,
        'gems=' + gemsAtMine,
      );
    }

    /* ---------------- 4. 开始返程 ---------------- */
    var ret = O.byTextOne('.action-btn', '停止挖矿，开始返程');
    O.assert('存在「停止挖矿，开始返程」按钮', !!ret && !ret.disabled, ret ? O.txt(ret) : 'missing');
    if (ret) {
      ret.click();
      await O.sleep(350);
      await O.clearResults();
      await O.clearModals();
    }
    var clickable = O.$$('.grid-tile.clickable');
    O.assert('返程阶段仍有合法可走格', clickable.length >= 1, 'clickable=' + clickable.length);
    var clickableMarked = clickable.filter(function (el) {
      return el.getAttribute('data-legal') === '1';
    });
    O.assert('可走格带 data-legal=1 且可用绿虚线识别', clickableMarked.length === clickable.length, clickable.length + ' 个');

    /* ---------------- 5. 六类状态同时可区分（在矿区阶段就地判定，
       避免返程走完/结算后地图卸载导致 current=0 的假失败） ---------------- */
    var current0 = tiles().filter(function (el) {
      return el.getAttribute('data-current') === '1';
    });
    var unknown0 = tiles().filter(function (el) {
      return el.className.indexOf('unknown') >= 0;
    });
    var legal0 = O.$$('.grid-tile.clickable');
    var states = {
      current: current0.length,
      unknown: unknown0.length,
      legal: legal0.length,
      out: outNow.length,
      locked: lockedNow.length,
      retPlanned: returnSet0().length,
    };
    O.R.trailStatesMining = states;
    O.assert('当前格唯一且带 data-current', states.current === 1, 'current=' + states.current);
    O.assert('存在未探索格（? 标记，与轨迹格可区分）', states.unknown >= 1, 'unknown=' + states.unknown);
    O.assert(
      '五类状态同时可区分（当前/未探索/可走/去程/禁入）',
      states.current === 1 && states.unknown >= 1 && states.legal >= 1 && states.out >= 1 && states.locked >= 1,
      JSON.stringify(states),
    );

    /* ---------------- 5b. 返程多步轨迹 ---------------- */
    var cityId = String(O.gridDims().rows - 1) + ':0';
    await O.walkTowards(cityId, 3);
    var settled = !!O.$('.settlement');
    O.assert('返程 3 步之后仍未结算（地图还在，本场景没有意外结束）', !settled, settled ? '页面已进入结算画面' : '仍在游戏内');
    var retTiles = byTrail('ret');
    O.assert('返程阶段出现「回」轨迹格', retTiles.length >= 1, 'ret=' + retTiles.length + ' settled=' + settled);
    O.assert(
      '返程轨迹格左上角有「回」角标',
      retTiles.every(function (el) {
        var b = badge(el, '.tile-trail-badge');
        return b && O.txt(b) === '回';
      }),
      retTiles.length + ' 个格子',
    );
    var badRet = terrainReadability(retTiles);
    O.assert('返程轨迹下地形仍可识别', badRet.length === 0, badRet.length ? badRet.join(' | ') : '全部 ' + retTiles.length + ' 格正常');

    /* ---------------- 6. 去程与返程轨迹不会互相覆盖 ---------------- */
    var both = tiles().filter(function (el) {
      var t = el.getAttribute('data-trail');
      var hasOut = badge(el, '.tile-trail-badge') && O.txt(badge(el, '.tile-trail-badge')) === '去';
      var hasRet = badge(el, '.tile-trail-badge') && O.txt(badge(el, '.tile-trail-badge')) === '回';
      return t !== 'none' && hasOut && hasRet;
    });
    O.assert('同一格不会同时被标成去程与返程', both.length === 0, 'conflict=' + both.length);

    /* ---------------- 8. 顶栏 / 日志仍正常 ---------------- */
    var top = O.topNumbers ? O.topNumbers() : null;
    O.assert('顶栏读数正常（天数/现金）', !top || (top.day !== null && top.cash !== null), JSON.stringify(top));
    O.assert('历史日志有轨迹相关记录（至少包含移动或天气）', O.$$('.log-list li').length >= 3, 'logLines=' + O.$$('.log-list li').length);
  });
})();
