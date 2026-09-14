/**
 * Project Oasis — 浏览器逐按钮点击审计：公共框架（v0.1.2b）。
 *
 * 由 scripts/run-browser-audit.sh 通过 agent-browser eval 注入：
 *   1. eval 本文件（定义 window.__OASIS）
 *   2. eval scripts/e2e-audit-scene-*.js（定义并运行某个场景）
 *
 * 审计原语 auditClick()：
 *  1. 元素是否存在、是否 disabled、是否 0 尺寸；
 *  2. 不滚动时指针命中测试（elementFromPoint）→ 检测「被遮挡/被滚动容器裁剪」；
 *  3. scrollIntoView 后再次命中测试 → 区分「必须滚动才可达」；
 *  4. 真实 .click() + 状态指纹比对 → 确认点击真的进入了预期引擎状态。
 *
 * 所有辅助函数挂到 window.__OASIS（用 eval 注入时多个 IIFE 之间需要共享作用域）。
 */
(function () {
  if (window.__OASIS) return 'already';
  var O = {};
  window.__OASIS = O;
  window.__AUDIT = [];
  window.__AUDIT_DONE = false;

  O.R = {};
  O.sleep = function (ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };
  O.$ = function (s, root) {
    return (root || document).querySelector(s);
  };
  O.$$ = function (s, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(s));
  };
  O.txt = function (el) {
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  };
  O.byText = function (sel, t, root) {
    return O.$$(sel, root).filter(function (b) {
      return O.txt(b).indexOf(t) >= 0;
    });
  };
  O.byTextOne = function (sel, t, root) {
    return O.byText(sel, t, root)[0] || null;
  };
  O.rec = function (o) {
    window.__AUDIT.push(o);
    return o;
  };
  O.pass = function (name, detail) {
    return O.rec({ name: name, ok: true, detail: detail || '' });
  };
  O.fail = function (name, detail) {
    return O.rec({ name: name, ok: false, detail: detail || '' });
  };
  O.assert = function (name, cond, detail) {
    return cond ? O.pass(name, detail) : O.fail(name, detail);
  };

  /* ---------------- 状态指纹 ---------------- */
  O.fp = function () {
    var tb = O.$('.topbar');
    var modal = O.$('.modal-header');
    var settle = O.$('.settlement');
    var start = O.$('.start-screen');
    var seedInput = O.$('input[aria-label="Seed"]');
    var screen = settle
      ? 'SETTLE'
      : start
        ? 'START:' + O.txt(O.$('h1', start)).slice(0, 6)
        : tb
          ? 'GAME'
          : '?';
    return [
      screen,
      seedInput ? 'seed=' + seedInput.value : 'noseed',
      tb ? O.txt(tb) : '',
      modal ? 'M:' + O.txt(modal) : '',
      modal ? 'MB:' + O.$$('.modal-body button').length : '',
      O.$$('.grid-tile.clickable').length,
      O.$$('.action-btn').length,
      O.$$('.action-btn:not([disabled])').length,
      O.$$('.log-list li').length,
    ].join('~');
  };

  /* ---------------- 指针命中测试 ---------------- */
  O.hitTest = function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { state: 'ZERO_SIZE' };
    function probe(x, y) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'OUTSIDE_VIEWPORT';
      var hit = document.elementFromPoint(x, y);
      if (!hit) return 'NO_HIT';
      if (hit === el || el.contains(hit) || hit.contains(el)) return 'OK';
      return 'BLOCKED_BY:' + hit.tagName + '.' + (typeof hit.className === 'string' ? hit.className : '');
    }
    var immediate = probe(r.left + r.width / 2, r.top + r.height / 2);
    var top = Math.max(r.top, 0);
    var bot = Math.min(r.bottom, window.innerHeight);
    var left = Math.max(r.left, 0);
    var right = Math.min(r.right, window.innerWidth);
    var visible = bot > top && right > left ? probe((left + right) / 2, (top + bot) / 2) : 'NO_VISIBLE_AREA';
    return { state: immediate === 'OK' ? 'OK' : visible, immediate: immediate, visible: visible };
  };

  /* ---------------- 审计一次点击 ---------------- */
  O.auditClick = async function (name, elOrFn, expect, opts) {
    opts = opts || {};
    var el = typeof elOrFn === 'function' ? elOrFn() : elOrFn;
    if (!el) {
      return opts.maybeMissing
        ? O.rec({ name: name, ok: true, skipped: 'NOT_PRESENT' })
        : O.fail(name, '元素不存在');
    }
    var before = O.fp();
    if (el.disabled) {
      var r0 = el.getBoundingClientRect();
      var visible = r0.width > 0 && r0.height > 0;
      return opts.allowDisabled
        ? O.pass(name, '按预期禁用' + (visible ? '（可见）' : '（0 尺寸！）') + (opts.note ? ' · ' + opts.note : ''))
        : O.fail(name, '意外禁用');
    }
    var ht = O.hitTest(el);
    var needScroll = ht.state !== 'OK';
    if (needScroll) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await O.sleep(120);
      ht = O.hitTest(el);
    }
    if (ht.state !== 'OK') {
      return O.fail(name, '指针不可达：' + ht.state + '（immediate=' + ht.immediate + '）');
    }
    el.click();
    await O.sleep(opts.wait || 260);
    var after = O.fp();
    var changed = after !== before;
    var okChange =
      expect === 'NO_CHANGE'
        ? true
        : expect === 'CHANGE'
          ? changed
          : typeof expect === 'function'
            ? !!expect(before, after)
            : changed;
    var detail = (needScroll ? '[需滚动] ' : '') + (opts.note || '');
    return okChange
      ? O.pass(name, detail)
      : O.fail(name, '点击后状态未按预期变化' + (detail ? ' · ' + detail : '') + ' | ' + before + ' → ' + after);
  };

  /* ---------------- 游戏内状态读取 ---------------- */
  O.gameReady = function () {
    return !!O.$('.topbar');
  };
  O.tentsState = function () {
    var m = O.txt(O.$('.topbar')).match(/帐篷(.*?)指南针/);
    return m ? m[1].trim() : '?';
  };
  O.daysState = function () {
    var m = O.txt(O.$('.topbar')).match(/第 (\d+) \/ (\d+) 天/);
    return m ? { day: +m[1], max: +m[2] } : null;
  };
  O.currentTile = function () {
    var t = O.$('.grid-tile.current');
    return t ? t.getAttribute('data-tileid') : null;
  };
  O.terrainHere = function () {
    var lines = O.$$('.panel .location-line');
    for (var i = 0; i < lines.length; i++) {
      if (O.txt(lines[i]).indexOf('地点') === 0) return O.txt(lines[i]);
    }
    return '';
  };
  O.mineTiles = function () {
    return O.$$('.grid-tile').filter(function (t) {
      return t.innerText.indexOf('矿') >= 0;
    });
  };
  O.man = function (a, b) {
    var p = a.split(':').map(Number);
    var q = b.split(':').map(Number);
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
  };
  O.gridDims = function () {
    var maxR = 0;
    var maxC = 0;
    O.$$('.grid-tile').forEach(function (t) {
      var p = t.getAttribute('data-tileid').split(':').map(Number);
      if (p[0] > maxR) maxR = p[0];
      if (p[1] > maxC) maxC = p[1];
    });
    return { rows: maxR + 1, cols: maxC + 1 };
  };
  O.bfsDistFrom = function (from) {
    var d = O.gridDims();
    var dist = {};
    dist[from] = 0;
    var q = [from];
    while (q.length) {
      var cur = q.shift();
      var p = cur.split(':').map(Number);
      var nb = [
        [p[0] - 1, p[1]],
        [p[0] + 1, p[1]],
        [p[0], p[1] - 1],
        [p[0], p[1] + 1],
      ];
      for (var i = 0; i < 4; i++) {
        var r = nb[i][0];
        var c = nb[i][1];
        if (r < 0 || c < 0 || r >= d.rows || c >= d.cols) continue;
        var k = r + ':' + c;
        if (k in dist) continue;
        dist[k] = dist[cur] + 1;
        q.push(k);
      }
    }
    return dist;
  };

  /* ---------------- Modal ---------------- */
  O.modalKind = function () {
    var h = O.$('.modal-header');
    if (!h) return null;
    var t = O.txt(h);
    if (t.indexOf('沙尘暴') === 0) return 'SANDSTORM';
    if (t.indexOf('草原暴雨') === 0) return 'RAINSTORM';
    if (t.indexOf('沙漠商队') === 0) return 'CARAVAN';
    if (t.indexOf('盗贼夜袭') === 0) return 'THIEF';
    if (t.indexOf('繁荣市集') === 0) return 'MARKET';
    if (t.indexOf('天气预报') === 0) return 'FORECAST';
    if (t.indexOf('远征规则') === 0) return 'RULES';
    return 'OTHER:' + t;
  };
  O.clearModals = async function () {
    for (var i = 0; i < 8; i++) {
      var k = O.modalKind();
      if (!k) return null;
      if (k === 'FORECAST' || k === 'RULES') {
        var close = O.$('.modal-close') || O.byTextOne('.modal-footer .btn', '关闭');
        if (close) close.click();
        await O.sleep(200);
        continue;
      }
      if (k === 'CARAVAN') {
        (O.byTextOne('.modal-actions button', '免费获取') || O.$$('.modal-actions button')[0]).click();
      } else if (k === 'THIEF') {
        (O.byTextOne('.modal-actions button', '放弃') || O.$$('.modal-actions button')[0]).click();
      } else if (k === 'MARKET') {
        (O.byTextOne('.modal-actions button', '八折购物') || O.$$('.modal-actions button')[0]).click();
      } else if (k === 'SANDSTORM' || k === 'RAINSTORM') {
        return k; // 交给场景处理
      } else {
        var b0 = O.$$('.modal-actions button')[0];
        if (!b0) return k;
        b0.click();
      }
      await O.sleep(240);
    }
    return null;
  };
  /** 处理天气 Modal：优先用帐篷，其次不用 */
  O.resolveWeatherModal = async function () {
    var use = O.$$('.modal-body button').filter(function (b) {
      return (O.txt(b).indexOf('只用帐篷') >= 0 || O.txt(b).indexOf('使用帐篷') >= 0) && !b.disabled;
    })[0];
    var fallback = O.$$('.modal-body button').filter(function (b) {
      return O.txt(b).indexOf('什么都不用') >= 0 || O.txt(b).indexOf('不用帐篷') >= 0 || O.txt(b).indexOf('不同帐篷') >= 0;
    })[0];
    var pick = use || fallback || O.$$('.modal-body button')[0];
    if (pick) pick.click();
    await O.sleep(320);
  };

  /* ---------------- 开局 ---------------- */
  O.setSeed = function (v) {
    var input = O.$('input[aria-label="Seed"]');
    if (!input) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  O.buyEquipment = async function (tents, compasses) {
    for (var i = 0; i < (tents || 0); i++) {
      var b = O.byTextOne('button', '购买帐篷');
      if (!b || b.disabled) break;
      b.click();
      await O.sleep(140);
    }
    for (var j = 0; j < (compasses || 0); j++) {
      var c = O.byTextOne('button', '购买指南针');
      if (!c || c.disabled) break;
      c.click();
      await O.sleep(140);
    }
  };
  O.gotoGame = async function (seed, buy) {
    var confirmBtn = O.byTextOne('.start-card .btn', '我已阅读规则');
    if (confirmBtn) {
      confirmBtn.click();
      await O.sleep(500);
    }
    if (!O.setSeed(seed)) return false;
    await O.sleep(150);
    var start = O.byTextOne('button', '开始游戏');
    if (!start) return false;
    start.click();
    await O.sleep(700);
    if (buy) await O.buyEquipment(buy.tents, buy.compasses);
    return O.gameReady();
  };

  /* ---------------- 行走 ---------------- */
  O.walkTowards = async function (target, maxSteps) {
    var trail = [O.currentTile()];
    var stuck = 0;
    for (var s = 0; s < maxSteps; s++) {
      if (O.currentTile() === target) {
        O.R.trail = trail;
        return true;
      }
      var k = await O.clearModals();
      if (k === 'SANDSTORM' || k === 'RAINSTORM') {
        await O.resolveWeatherModal();
        continue;
      }
      var clickable = O.$$('.grid-tile.clickable');
      if (!clickable.length) {
        O.R.trail = trail;
        return false;
      }
      var dist = O.bfsDistFrom(target);
      var best = null;
      var bestD = Infinity;
      for (var i = 0; i < clickable.length; i++) {
        var id = clickable[i].getAttribute('data-tileid');
        var dd = id in dist ? dist[id] : Infinity;
        if (dd < bestD) {
          bestD = dd;
          best = clickable[i];
        }
      }
      if (!best) best = clickable[0];
      var before = O.currentTile();
      best.click();
      await O.sleep(300);
      var after = O.currentTile();
      if (after === before) {
        stuck += 1;
        if (stuck > 4) {
          O.R.trail = trail;
          return false;
        }
      } else {
        stuck = 0;
        trail.push(after);
        if (trail.length > 90) {
          O.R.trail = trail;
          return false;
        }
      }
    }
    O.R.trail = trail;
    return false;
  };

  /** 通用探索：随机走一个合法未访问格 */
  O.stepAnywhere = async function () {
    var k = await O.clearModals();
    if (k === 'SANDSTORM' || k === 'RAINSTORM') {
      await O.resolveWeatherModal();
      return true;
    }
    var clickable = O.$$('.grid-tile.clickable');
    if (!clickable.length) return false;
    var before = O.currentTile();
    clickable[0].click();
    await O.sleep(300);
    return O.currentTile() !== before;
  };

  /** 完成一个场景并落盘结果 */
  O.finalize = async function (sceneName, sceneFn) {
    try {
      await sceneFn();
    } catch (e) {
      O.fail('场景 ' + sceneName + ' 抛出异常', String((e && e.message) || e));
    }
    O.R.viewport = [window.innerWidth, window.innerHeight];
    O.R.total = window.__AUDIT.length;
    O.R.failed = window.__AUDIT.filter(function (x) {
      return !x.ok;
    }).length;
    window.__AUDIT_DONE = true;
  };
  return 'lib-ready';
})();
