/**
 * Project Oasis — 浏览器审计场景 layout：8×9 地图排版 / 左黑边 / 居中 / 响应式。
 *
 * 由 scripts/run-browser-audit.sh 在多个视口下反复调用 window.__LAYOUT.run()：
 * 每个视口重新测量一次（map wrapper 尺寸、居中、溢出、格子形状、覆盖关系）。
 *
 * 覆盖 Human Playtest Fix Round 1 的第 14~17 条：
 *  - 地图左侧黑边消失（左右留白对称，且留白来自容器 padding 而不是旧固定尺寸）
 *  - 地图在自己的主游戏区域内居中，不偏左/不偏右
 *  - 容器没有任何旧 10×12 遗留尺寸（min-width 420px / max-width 560px / repeat(12)）
 *  - 8×9 = 72 格真实渲染、无占位列；城市左下、矿区右侧且不在右下禁区
 *  - 无横向错误溢出、地图不被切掉、不覆盖 HUD/日志、格子接近正方形且可点击
 */
(function () {
  var O = window.__OASIS;

  function rct(el) {
    var r = el.getBoundingClientRect();
    return {
      l: r.left,
      t: r.top,
      r: r.right,
      b: r.bottom,
      w: r.width,
      h: r.height,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
    };
  }
  function near(a, b, tol) {
    return Math.abs(a - b) <= (tol === undefined ? 2 : tol);
  }
  function overlap(a, b) {
    return a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  }
  function px(v) {
    return Math.round(v * 10) / 10;
  }

  function run(w, h, label, zoom) {
    var tag = label + ' ' + w + '×' + h + ' @' + zoom + '%';
    var wrap = O.$('[data-testid="map-scroll"]');
    var map = O.$('[data-testid="map-grid"]');
    var panel = O.$('.map-panel');
    var topbar = O.$('.topbar');
    var logList = O.$('.log-list');
    var logPanel = logList ? logList.closest('.panel') : null;
    if (!wrap || !map || !panel) {
      O.fail(tag + ' · 地图容器存在', 'wrap=' + !!wrap + ' map=' + !!map + ' panel=' + !!panel);
      return;
    }

    /* ---------- 尺寸来源：8×9，且无旧 10×12 遗留 ---------- */
    var rows = Number(map.getAttribute('data-rows'));
    var cols = Number(map.getAttribute('data-cols'));
    O.assert(tag + ' · 地图容器尺寸来自实际 8×9', rows === 8 && cols === 9, 'data-rows=' + rows + ' data-cols=' + cols);

    var tiles = O.$$('.grid-tile');
    var ids = tiles.map(function (t) {
      return t.getAttribute('data-tileid');
    });
    var uniq = {};
    ids.forEach(function (i) {
      uniq[i] = 1;
    });
    O.assert(
      tag + ' · 8×9 真实渲染 72 格且无重复/占位列',
      tiles.length === 72 && Object.keys(uniq).length === 72,
      'tile 数=' + tiles.length + ' 唯一=' + Object.keys(uniq).length,
    );
    var badCoord = ids.filter(function (i) {
      var p = i.split(':').map(Number);
      return p[0] >= 8 || p[1] >= 9 || p[0] < 0 || p[1] < 0;
    });
    O.assert(tag + ' · 没有越界/多余占位列', badCoord.length === 0, badCoord.join(',') || '无');

    var inline = map.getAttribute('style') || '';
    var cs = getComputedStyle(map);
    var tracks = cs.gridTemplateColumns.split(' ').filter(function (s) {
      return s.length > 0;
    });
    var legacy =
      inline.indexOf('420px') >= 0 ||
      inline.indexOf('560px') >= 0 ||
      inline.indexOf('repeat(12') >= 0 ||
      cs.minWidth !== '0px' ||
      tracks.length !== 9;
    O.assert(
      tag + ' · 地图容器不保留旧 10×12 尺寸（min-width 420 / max-width 560 / 12 列）',
      !legacy,
      'minWidth=' + cs.minWidth + ' · 列数=' + tracks.length + ' · inline=' + inline.slice(0, 80),
    );

    /* ---------- 左侧黑边 / 居中 ---------- */
    var wrapBox = rct(wrap);
    var contentLeft = wrapBox.l + wrap.clientLeft;
    var contentRight = contentLeft + wrap.clientWidth;
    var mapBox = rct(map);
    var leftGap = px(mapBox.l - contentLeft);
    var rightGap = px(contentRight - mapBox.r);
    O.assert(
      tag + ' · 地图左右留白对称（左侧黑边已消失）',
      leftGap >= -1 && rightGap >= -1 && near(leftGap, rightGap, 2),
      '左=' + leftGap + 'px 右=' + rightGap + 'px（差 ' + px(Math.abs(leftGap - rightGap)) + 'px）',
    );

    var panelBox = rct(panel);
    O.assert(
      tag + ' · 地图在主游戏区域（地图面板）内水平居中',
      near(mapBox.cx, panelBox.cx, 2),
      '地图中心=' + px(mapBox.cx) + ' 面板中心=' + px(panelBox.cx) + ' 偏差=' + px(Math.abs(mapBox.cx - panelBox.cx)) + 'px',
    );

    var layout = O.$('.game-layout');
    var cols2 = layout ? getComputedStyle(layout).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    O.assert(
      tag + ' · 地图区与右侧日志是独立排版（互不牵动）',
      cols2 === 2 || cols2 === 1,
      'game-layout 轨道数=' + cols2 + (cols2 === 1 ? '（窄窗口单列，符合预期）' : ''),
    );

    /* ---------- 溢出 / 裁切 ---------- */
    O.assert(
      tag + ' · 地图容器无横向溢出',
      wrap.scrollWidth <= wrap.clientWidth + 1,
      'scrollWidth=' + wrap.scrollWidth + ' clientWidth=' + wrap.clientWidth,
    );
    O.assert(
      tag + ' · 页面无横向错误溢出',
      document.documentElement.scrollWidth <= window.innerWidth + 1,
      'doc scrollWidth=' + document.documentElement.scrollWidth + ' 视口=' + window.innerWidth,
    );
    O.assert(
      tag + ' · 地图没有被切掉（整图在容器可视区内）',
      mapBox.h <= wrap.clientHeight + 1 && mapBox.w <= wrap.clientWidth + 1,
      '地图 ' + px(mapBox.w) + '×' + px(mapBox.h) + ' / 容器 ' + wrap.clientWidth + '×' + wrap.clientHeight,
    );
    O.assert(
      tag + ' · 地图容器没有多余的纵向滚动条（否则中心会偏移半个滚动条宽）',
      wrap.scrollHeight <= wrap.clientHeight + 1,
      'scrollHeight=' + wrap.scrollHeight + ' clientHeight=' + wrap.clientHeight,
    );

    /* ---------- 格子形状 ---------- */
    var t0 = rct(tiles[0]);
    var ratio = t0.w / t0.h;
    O.assert(
      tag + ' · 格子接近正方形',
      near(ratio, 1, 0.12) && t0.w >= 30,
      '格子 ' + px(t0.w) + '×' + px(t0.h) + '（比 ' + px(ratio) + '）',
    );

    /* ---------- 覆盖关系 ---------- */
    var tb = topbar ? rct(topbar) : null;
    O.assert(tag + ' · 地图不覆盖 HUD 顶栏', !tb || !overlap(mapBox, tb), tb ? 'topbar.b=' + px(tb.b) + ' map.t=' + px(mapBox.t) : 'no-topbar');
    if (logPanel) {
      var lb = rct(logPanel);
      O.assert(
        tag + ' · 地图不覆盖右侧日志',
        !overlap(mapBox, lb),
        'map=[' + px(mapBox.l) + ',' + px(mapBox.r) + '] log=[' + px(lb.l) + ',' + px(lb.r) + ']',
      );
    } else {
      O.pass(tag + ' · 地图不覆盖右侧日志', '日志面板未渲染（跳过一次测量）');
    }

    /* ---------- 城市 / 矿区位置 ---------- */
    var cityTile = O.$('.grid-tile[data-tileid="7:0"]');
    O.assert(
      tag + ' · 城市固定在左下角 (7,0)',
      !!cityTile && cityTile.innerText.indexOf('城') >= 0,
      cityTile ? O.txt(cityTile) : '缺少 7:0',
    );
    var mineTiles = tiles.filter(function (t) {
      return (t.getAttribute('title') || '').indexOf('Mine') >= 0;
    });
    var mineOk =
      mineTiles.length === 2 &&
      mineTiles.every(function (t) {
        var p = t.getAttribute('data-tileid').split(':').map(Number);
        return p[1] === 8 && p[0] <= 5;
      });
    O.assert(
      tag + ' · 两座矿区都在最右列且不在右下禁区（row ≤ 5）',
      mineOk,
      mineTiles
        .map(function (t) {
          return t.getAttribute('data-tileid');
        })
        .join(','),
    );

    /* ---------- 可点击高亮 ---------- */
    var clickable = O.$$('.grid-tile.clickable');
    var outlineOk =
      clickable.length > 0 &&
      clickable.every(function (t) {
        return getComputedStyle(t).outlineStyle === 'dashed';
      });
    O.assert(
      tag + ' · 合法移动高亮正常且可点击',
      outlineOk,
      '高亮格数=' + clickable.length + ' 虚线描边=' + outlineOk,
    );

    O.R.viewports = O.R.viewports || [];
    O.R.viewports.push({
      tag: tag,
      wrap: [wrap.clientWidth, wrap.clientHeight],
      map: [Math.round(mapBox.w), Math.round(mapBox.h)],
      leftGap: leftGap,
      rightGap: rightGap,
      tile: [px(t0.w), px(t0.h)],
      centerOffset: px(Math.abs(mapBox.cx - panelBox.cx)),
    });
    return 'measured:' + tag;
  }

  window.__LAYOUT = { ready: false, run: run };

  (async function () {
    var ok = await O.gotoGame('audit-0', { tents: 2, compasses: 1 });
    O.assert('layout · 进入游戏并可测量地图排版', ok && !!O.$('[data-testid="map-grid"]'));
    window.__LAYOUT.ready = true;
    // 第一个视口在本脚本内直接测量（后续视口由 runner 逐个调用 run()）
    window.__LAYOUT.run(window.innerWidth, window.innerHeight, '初始', 100);
    return 'layout-ready';
  })();
})();
