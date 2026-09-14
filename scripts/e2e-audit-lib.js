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
    var result = O.$('[data-testid="result-modal"]');
    return [
      screen,
      seedInput ? 'seed=' + seedInput.value : 'noseed',
      tb ? O.txt(tb) : '',
      modal ? 'M:' + O.txt(modal) : '',
      modal ? 'MB:' + O.$$('.modal-body button').length : '',
      result ? 'RES:' + O.txt(O.$('.modal-header', result)) : 'nores',
      result ? 'RESN:' + O.$$('[data-testid="result-changes"] li').length : '',
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
    // v0.1.2b 即时反馈：状态变化会弹出统一结果弹窗，它会挡住后续按钮。
    // 这里先把弹窗内容记入 detail，再确认关闭，保证审计流程连续；
    // 需要专门断言弹窗内容的场景传 opts.keepResult = true 自行处理。
    var res = O.resultInfo();
    var resNote = res
      ? ' | 结果弹窗「' +
        res.title +
        '」' +
        (res.message ? '：' + res.message : '') +
        (res.changes.length
          ? ' ｜ 变化=' +
            res.changes
              .map(function (c) {
                return c.label + ' ' + c.before + '→' + c.after;
              })
              .join('; ')
          : '｜（无数值变化）')
      : '';
    if (res && !opts.keepResult) await O.confirmResult();
    var detail = (needScroll ? '[需滚动] ' : '') + (opts.note || '') + resNote;
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
    if (O.$('[data-testid="result-modal"]')) return 'RESULT';
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

  /* ---------------- 统一结果提示弹窗（v0.1.2b 即时反馈） ---------------- */
  O.resultEl = function () {
    return O.$('[data-testid="result-modal"]');
  };
  /** 读取结果弹窗内容：标题 / 正文 / 资源变化（变化前 → 变化后）/ 结局 */
  O.resultInfo = function () {
    var el = O.resultEl();
    if (!el) return null;
    var rows = O.$$('[data-testid="result-changes"] li', el).map(function (li) {
      return {
        label: O.txt(O.$('.rc-label', li)),
        before: O.txt(O.$('.rc-before', li)),
        arrow: O.txt(O.$('.rc-arrow', li)),
        after: O.txt(O.$('.rc-after', li)),
        cls: li.className,
      };
    });
    var outcomeEl = O.$('[data-testid="result-outcome"]', el);
    return {
      title: O.txt(O.$('.modal-header h3', el)),
      message: O.txt(O.$('[data-testid="result-message"]', el)),
      changes: rows,
      outcome: outcomeEl ? O.txt(outcomeEl) : null,
      confirmText: O.txt(O.$('[data-testid="result-confirm"]', el)),
    };
  };
  /** 确认（关闭）当前结果弹窗 */
  O.confirmResult = async function () {
    var btn = O.$('[data-testid="result-confirm"]');
    if (!btn) return false;
    btn.click();
    await O.sleep(200);
    return true;
  };
  /** 连续确认直到没有结果弹窗（最多 n 条） */
  O.clearResults = async function (n) {
    var done = 0;
    while (done < (n || 10) && O.resultEl()) {
      await O.confirmResult();
      done += 1;
    }
    return done;
  };
  /**
   * 依次确认并收集所有结果弹窗，返回 info 列表（先进先出 = 事件发生顺序）。
   * 一次行动可能先产生「宿营完成」，随后才产生天气事件结算，所以断言
   * 「某事件有即时反馈」应当在整个队列里找，而不是只看第一条。
   */
  O.collectResults = async function (n) {
    var out = [];
    for (var i = 0; i < (n || 6); i += 1) {
      var info = O.resultInfo();
      if (!info) break;
      out.push(info);
      await O.confirmResult();
    }
    return out;
  };

  O.clearModals = async function () {
    for (var i = 0; i < 12; i++) {
      var k = O.modalKind();
      if (!k) return null;
      if (k === 'RESULT') {
        await O.confirmResult();
        continue;
      }
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
  O.buyEquipment = async function (tents, compasses) {    for (var i = 0; i < (tents || 0); i++) {
      var b = O.byTextOne('button', '购买帐篷');
      if (!b || b.disabled) break;
      b.click();
      await O.sleep(160);
      await O.clearResults(); // 购买会弹出即时反馈结果
    }
    for (var j = 0; j < (compasses || 0); j++) {
      var c = O.byTextOne('button', '购买指南针');
      if (!c || c.disabled) break;
      c.click();
      await O.sleep(160);
      await O.clearResults();
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

  /* ---------------- 帐篷 / 天气 Modal 准备（v0.1.2b 追加） ---------------- */

  /** 顶栏帐篷文案 → { A:3, B:3, C:2, D:1 } */
  O.tentCharges = function () {
    var out = {};
    var re = /([A-Z]) (\d)\/(\d)/g;
    var s = O.tentsState();
    var m;
    while ((m = re.exec(s)) !== null) out[m[1]] = Number(m[2]);
    return out;
  };
  O.chargesPattern = function () {
    var t = O.tentCharges();
    return Object.keys(t)
      .sort()
      .map(function (k) {
        return k + t[k];
      })
      .join('/');
  };

  /** 用指定帐篷宿营（不传则挑剩余耐久最高的一顶，尽量不影响其它帐篷） */
  O.campWith = async function (tentId) {
    var list = O.$$('.action-btn').filter(function (b) {
      return O.txt(b).indexOf('原地宿营') >= 0 && !b.disabled && b.getAttribute('data-tentid');
    });
    var pick = null;
    if (tentId) {
      pick = list.filter(function (b) {
        return b.getAttribute('data-tentid') === tentId;
      })[0];
    }
    if (!pick) {
      var best = null;
      var bestCharge = -1;
      list.forEach(function (b) {
        var c = Number((O.txt(b).match(/（(\d)\//) || [])[1] || 0);
        if (c > bestCharge) {
          bestCharge = c;
          best = b;
        }
      });
      pick = best;
    }
    if (!pick) return false;
    pick.click();
    await O.sleep(340);
    await O.clearResults();
    return true;
  };

  /** 在沙尘暴 Modal 里用「只用帐篷」方式消耗某顶帐篷（用于推进到下一个天气） */
  O.resolveStormWithTent = async function (tentId) {
    var rows = O.$$('.tent-choice');
    var pick = null;
    for (var i = 0; i < rows.length; i++) {
      if (!tentId || O.$('.tent-choice-name', rows[i]).getAttribute('data-tentid') === tentId) {
        pick = O.$$('button', rows[i]).filter(function (b) {
          return !b.disabled && O.txt(b).indexOf('只用帐篷') >= 0;
        })[0];
        break;
      }
    }
    if (!pick) {
      // 退而求其次：用最高耐久帐篷的「+ 指南针」
      pick = O.$$('.tent-choice button').filter(function (b) {
        return !b.disabled && O.txt(b).indexOf('指南针') >= 0;
      })[0];
    }
    if (!pick) return false;
    pick.click();
    await O.sleep(420);
    await O.clearResults();
    return true;
  };

  /**
   * 准备一个「沙尘暴 Modal 打开」的现场：
   *  - 出城到 (6,0)（沙漠）；
   *  - 按 plan 依次用指定帐篷宿营（用来把耐久调成目标形态）；
   *  - 中途出现的沙尘暴用「只用帐篷」消化（优先不碰 plan 里的帐篷）；
   *  - plan 完成后在 城市↔沙漠 之间往返推进天数找沙尘暴（往返不消耗帐篷）。
   * 返回 true 表示沙尘暴 Modal 已打开。
   */
  O.prepareStorm = async function (seed, tents, compasses, plan) {
    var ready = await O.gotoGame(seed, { tents: tents, compasses: compasses });
    if (!ready) return false;
    var camp = { tents: tents, compasses: compasses };
    await O.stepAnywhere();
    for (var i = 0; i < 46; i++) {
      var k = await O.clearModals();
      if (k === 'SANDSTORM') {
        if (!plan || plan.length === 0) return true; // plan 已完成 → 这个 Modal 就是测量目标
        // plan 还没走完：用「什么都不用」硬扛，保住帐篷形态不被额外消耗
        var skip = O.byTextOne('.modal-body button', '什么都不用') || O.$$('.modal-body button')[0];
        if (skip) {
          skip.click();
          await O.sleep(420);
          await O.clearResults();
        }
        continue;
      }
      if (k === 'RAINSTORM') {
        await O.resolveWeatherModal();
        await O.clearResults();
        continue;
      }
      if (k === 'RESULT') continue;
      if (plan && plan.length) {
        await O.campWith(plan.shift());
        continue;
      }
      // plan 用完：在沙漠格宿营（会消耗帐篷）之前，先试「往返城市」推进天数，避免动帐篷
      var here = O.currentTile();
      var city = O.$('.grid-tile[data-tileid="7:0"]');
      var clickable = O.$$('.grid-tile.clickable');
      var back = clickable.filter(function (t) {
        return t.getAttribute('data-tileid') === '7:0';
      })[0];
      if (here !== '7:0' && back) {
        back.click();
        await O.sleep(300);
        await O.clearResults();
        continue;
      }
      var up = clickable.filter(function (t) {
        return t.getAttribute('data-tileid') === '6:0';
      })[0];
      if (up) {
        up.click();
        await O.sleep(300);
        await O.clearResults();
        continue;
      }
      // 兜底：宿营推进
      if (!(await O.campWith())) return false;
    }
    return false;
  };

  /* ---------------- 行走 ---------------- */
  O.walkTowards = async function (target, maxSteps) {    var trail = [O.currentTile()];
    var stuck = 0;
    for (var s = 0; s < maxSteps; s++) {
      if (O.currentTile() === target) {
        O.R.trail = trail;
        return true;
      }
      var k = await O.clearModals();
      if (k === 'RESULT') continue;
      if (k === 'SANDSTORM' || k === 'RAINSTORM') {
        await O.resolveWeatherModal();
        await O.clearResults();
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
      await O.clearResults(); // 移动产生的天气/事件反馈
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
    if (k === 'RESULT') return true;
    if (k === 'SANDSTORM' || k === 'RAINSTORM') {
      await O.resolveWeatherModal();
      await O.clearResults();
      return true;
    }
    var clickable = O.$$('.grid-tile.clickable');
    if (!clickable.length) return false;
    var before = O.currentTile();
    clickable[0].click();
    await O.sleep(300);
    await O.clearResults();
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

  /* ---------------- v0.1.2b 追加：装备按钮文案完整性 ---------------- */

  /** 沙尘暴 Modal 的期望完整文案（真人试玩要求：玩家必须看到完整后果） */
  O.STORM_LABELS = {
    perTent: ['+ 指南针（安全通过）', '只用帐篷（迷路 +1 天）'],
    noTentCompass: '只用指南针（耐力 -1，不迷路）',
    noTentNothing: '什么都不用（耐力 -1，且迷路额外损失 1 天）',
  };

  /**
   * 断言 Modal 内所有装备按钮的文案**完整可读**：
   *  1. 完整在视口内（Modal 不超出视口）；
   *  2. Header / 关闭按钮可见；
   *  3. 每个按钮不存在文字裁切（scroll <= client，无 ellipsis/nowrap 截断）；
   *  4. 每个按钮不存在被 overflow 祖先裁切；
   *  5. 按钮区域可被指针命中（点击区域完整）；
   *  6. 文案与期望**完全一致**（校验用户实际看到的字，而不只是 Action 存在）；
   *  7. 记录按钮行数（>1 = 已按需换行，属允许行为）。
   */
  O.assertLabelsIntact = function (tag, expected, opts) {
    opts = opts || {};
    var modal = O.$(opts.sel || '.modal');
    if (!modal) {
      O.fail(tag + ' · Modal 存在', '找不到 Modal（kind=' + O.modalKind() + '）');
      return null;
    }
    var body = O.$('.modal-body', modal);
    var header = O.$('.modal-header', modal);
    var mRect = modal.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    O.assert(
      tag + ' · Modal 完整在视口内（不被裁到屏幕外）',
      mRect.top >= -1 && mRect.left >= -1 && mRect.bottom <= vh + 1 && mRect.right <= vw + 1,
      'modal=[' + Math.round(mRect.left) + ',' + Math.round(mRect.top) + ',' + Math.round(mRect.right) + ',' + Math.round(mRect.bottom) + '] viewport=' + vw + 'x' + vh,
    );
    O.assert(
      tag + ' · Header 可见' + (opts.requireClose ? ' / 关闭按钮存在' : '（事件类 Modal 无关闭按钮，属预期）'),
      !!header &&
        header.getBoundingClientRect().height > 0 &&
        header.getBoundingClientRect().top >= -1 &&
        (!opts.requireClose || !!O.$('.modal-close', modal)),
      header ? 'header=' + O.txt(header) + ' · close=' + !!O.$('.modal-close', modal) : 'no header',
    );

    var buttons = O.$$('button', modal);
    var problems = [];
    var rows = [];
    var scrolled = 0;
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var label = O.txt(b);
      if (!label) continue;
      b.scrollIntoView({ block: 'nearest' });
      var br = b.getBoundingClientRect();
      var bodyRect = body.getBoundingClientRect();
      var clippedX = b.scrollWidth > b.clientWidth + 1;
      var clippedY = b.scrollHeight > b.clientHeight + 1;
      var inBody = br.top >= bodyRect.top - 1 && br.bottom <= bodyRect.bottom + 1;
      var mid = document.elementFromPoint(Math.min(vw - 1, Math.max(0, (br.left + br.right) / 2)), Math.min(vh - 1, Math.max(0, (br.top + br.bottom) / 2)));
      var hit = mid === b || (mid && b.contains(mid));
      // overflow 祖先裁切
      var occluded = null;
      var a = b.parentElement;
      while (a && a !== document.body) {
        var cs = getComputedStyle(a);
        var oy = cs.overflowY;
        var ox = cs.overflowX;
        if (oy !== 'visible' || ox !== 'visible') {
          var ar = a.getBoundingClientRect();
          if (br.left < ar.left - 1 || br.right > ar.right + 1) occluded = 'horiz-by:' + (a.className || a.tagName);
          if (cs.overflowY !== 'visible' && (br.top < ar.top - 1 || br.bottom > ar.bottom + 1)) {
            if (!a.classList.contains('modal-body')) occluded = 'vert-by:' + (a.className || a.tagName);
          }
        }
        a = a.parentElement;
      }
      var lines = br.height > 34 ? 2 : 1;
      rows.push({ label: label, w: Math.round(br.width), h: Math.round(br.height), lines: lines, disabled: !!b.disabled, inBody: inBody, hit: hit });
      if (clippedX || clippedY || occluded || !hit || (opts.requireVisible !== false && !inBody)) {
        problems.push(
          '"' + label.slice(0, 26) + '"' +
            (clippedX ? ' 横向裁切' : '') +
            (clippedY ? ' 纵向裁切' : '') +
            (occluded ? ' ' + occluded : '') +
            (hit ? '' : ' 指针不可达') +
            (inBody ? '' : ' 超出可视区'),
        );
      }
    }
    O.assert(tag + ' · 所有按钮文案完整、未被裁切/遮挡', problems.length === 0, '检查 ' + rows.length + ' 个按钮 · ' + (problems.length ? problems.join(' | ') : '全部完整'));

    if (expected) {
      var missing = [];
      for (var k = 0; k < expected.length; k++) {
        var found = rows.some(function (r) {
          return r.label === expected[k];
        });
        if (!found) missing.push(expected[k]);
      }
      O.assert(
        tag + ' · 期望文案逐字存在（用户看到的完整字面）',
        missing.length === 0,
        missing.length ? '缺少：' + missing.join(' / ') : expected.length + ' 条文案全部逐字匹配',
      );
    }
    return { rows: rows, problems: problems };
  };

  return 'lib-ready';
})();
