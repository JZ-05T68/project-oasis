/**
 * Project Oasis — 浏览器审计场景 forecast（v0.1.2b 追加）。
 *
 * 真人试玩确认问题：天气预报 Modal 的卡片按数组顺序排列，地图边缘缺格时会自动补位，
 * 导致视觉方向与真实地图方向不一致（例如玩家在 (7,0) 时 (7,1) 被挤到第三行）。
 *
 * 本场景在真实 Chromium 里把玩家实际走到 9 类位置（内部 / 四边 / 四角），
 * 每次都打开天气预报 Modal 并断言：
 *  - 卡片位置由 (dr, dc) 决定（grid-row = dr+2、grid-column = dc+2）；
 *  - 几何位置与方位一致（北在上、南在下、西在左、东在右）；
 *  - 越界方向留空，不存在自动补位（缺的方向恰好是越界方向）；
 *  - 无重复格、无缺失合法格、无地图外格；
 *  - 当前格唯一且落在正中央；
 *  - 预报不永久揭示未知地形（Modal 里显示"未知"的格子在地图上仍是 ?）。
 *
 * runner 为每类位置重新加载页面并设置 window.__FC_CASE（去返程烧格规则下，
 * 不可能在同一局里走遍 9 类位置）。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, assert, rec, pass, fail, sleep } = O;
  const R = O.R;
  const ROWS = 8;
  const COLS = 9;

  const caseSpecs = [
    { name: '左下角 (7,0)', path: [], at: [7, 0], expect: 4, dirs: ['北', '东北', '当前格', '东'] },
    { name: '左边缘 (6,0)', path: ['6:0'], at: [6, 0], expect: 6, dirs: ['北', '东北', '当前格', '东', '南', '东南'] },
    { name: '下边缘 (7,1)', path: ['7:1'], at: [7, 1], expect: 6, dirs: ['西北', '北', '东北', '西', '当前格', '东'] },
    { name: '内部 (6,1)', path: ['6:0', '6:1'], at: [6, 1], expect: 9, dirs: ['西北', '北', '东北', '西', '当前格', '东', '西南', '南', '东南'] },
    { name: '上边缘 (0,1)', path: ['6:0', '5:0', '4:0', '3:0', '2:0', '1:0', '0:0', '0:1'], at: [0, 1], expect: 6, dirs: ['西', '当前格', '东', '西南', '南', '东南'] },
    { name: '左上角 (0,0)', path: ['6:0', '5:0', '4:0', '3:0', '2:0', '1:0', '0:0'], at: [0, 0], expect: 4, dirs: ['当前格', '东', '南', '东南'] },
    { name: '右上角 (0,8)', path: ['6:0', '5:0', '4:0', '3:0', '2:0', '1:0', '0:0', '0:1', '0:2', '0:3', '0:4', '0:5', '0:6', '0:7', '0:8'], at: [0, 8], expect: 4, dirs: ['西', '当前格', '西南', '南'] },
    { name: '右下角 (7,8)', path: ['7:1', '7:2', '7:3', '7:4', '7:5', '7:6', '7:7', '7:8'], at: [7, 8], expect: 4, dirs: ['西北', '北', '西', '当前格'] },
    { name: '右边缘 (6,8)', path: ['7:1', '7:2', '7:3', '7:4', '7:5', '7:6', '7:7', '7:8', '6:8'], at: [6, 8], expect: 6, dirs: ['西北', '北', '西', '当前格', '西南', '南'] },
  ];

  function byTextFn(sel, t) {
    return $$(sel).filter((b) => txt(b).indexOf(t) >= 0)[0];
  }
  function cellRect(el) {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  /** 把待决事件 / 即时反馈 Modal 全部消化掉（事件 → 结果 → 下一天天气…） */
  async function drainModals(rounds) {
    for (let r = 0; r < (rounds || 6); r += 1) {
      const k = await O.clearModals();
      if (k === 'SANDSTORM' || k === 'RAINSTORM') {
        await O.resolveWeatherModal();
        await O.clearResults();
        continue;
      }
      if (!k) return true;
    }
    return false;
  }

  /** 走一条指定路径（逐格点击，途中处理事件/结算） */
  async function walkPath(path) {
    for (const id of path) {
      await drainModals();
      const el = document.querySelector('.grid-tile[data-tileid="' + id + '"].clickable');
      if (!el || el.disabled) return { ok: false, want: id, why: blockReason() };
      el.click();
      await sleep(340);
      await O.clearResults();
    }
    return { ok: true };
  }

  /** 走不动时说明原因（结算页 / 待决事件 / 无合法移动） */
  function blockReason() {
    if ($('.settlement')) return '已进入结算：' + txt($('.verdict')).slice(0, 40);
    const k = O.modalKind();
    if (k) {
      const btns = $$('.modal button').map((b) => txt(b).slice(0, 16) + (b.disabled ? '[禁用]' : ''));
      return '仍有 Modal 未处理：' + k + ' · 按钮=' + btns.join(' / ');
    }
    const legal = $$('.grid-tile.clickable').length;
    return legal === 0 ? '没有合法可移动格（路线被烧掉或已判负）' : '目标格不可点击（legal=' + legal + '）';
  }

  /** 打开一次天气预报 Modal（先把待决事件 Modal 清干净） */
  async function openForecast() {
    await drainModals();
    const btn = byTextFn('button', '使用天气预报');
    if (!btn || btn.disabled) return false;
    btn.click();
    await sleep(360);
    await O.clearResults(); // 「天气预报已使用」的即时反馈
    await sleep(260);
    return O.modalKind() === 'FORECAST';
  }

  /** 单次尝试：换一局走到目标并完成全部方位断言。成功返回 { ok:true }，可重试返回 { retry } */
  async function attemptOnce(spec, seed) {
    const ready = await O.gotoGame(seed, { tents: 4, compasses: 2 });
    if (!ready) return { fatal: '无法进入游戏（seed=' + seed + '）' };

    // 买一包预报（3 次），在目标位置只使用一次
    const pack = byTextFn('button', '购买天气预报包');
    if (pack && !pack.disabled) {
      pack.click();
      await sleep(360);
      await O.clearResults();
      if (O.modalKind() === 'FORECAST') {
        const cl = $('.modal-close');
        if (cl) {
          cl.click();
          await sleep(200);
        }
      }
    }

    const walked = await walkPath(spec.path);
    const want = spec.at[0] + ':' + spec.at[1];
    const now = O.currentTile();
    if (!walked.ok || now !== want) {
      return {
        retry: 'now=' + now + '（目标 ' + want + '）· ' + (walked.ok ? '路径未走完' : walked.why + '（卡在 ' + walked.want + '）'),
      };
    }

    const opened = await openForecast();
    if (!opened) return { retry: '打开预报 Modal 失败 kind=' + O.modalKind() + ' now=' + now };

    const p = spec.at;
    const tag = '预报方位 · ' + spec.name;
    const cells = $$('[data-testid="forecast-grid"] [role="gridcell"]');

    assert(tag + ' · 卡片数 = 图内方向数（' + spec.expect + '）', cells.length === spec.expect, '实际 ' + cells.length);

    // 每张卡片的 (dr, dc) 必须与真实坐标一致，且落在正确的 3×3 位置
    const badCoord = [];
    const badPlacement = [];
    const dirs = [];
    for (const c of cells) {
      const dr = Number(c.getAttribute('data-dr'));
      const dc = Number(c.getAttribute('data-dc'));
      const rc = c.getAttribute('data-tileid').split(':').map(Number);
      const cs = getComputedStyle(c);
      if (rc[0] !== p[0] + dr || rc[1] !== p[1] + dc) badCoord.push(c.getAttribute('data-tileid') + ' dr/dc=' + dr + ',' + dc);
      if (Number(cs.gridRowStart) !== dr + 2 || Number(cs.gridColumnStart) !== dc + 2) {
        badPlacement.push(c.getAttribute('data-tileid') + ' → ' + cs.gridRowStart + '/' + cs.gridColumnStart);
      }
      dirs.push(c.getAttribute('data-dir'));
    }
    assert(tag + ' · 每张卡片的 (dr,dc) 与真实坐标一致', badCoord.length === 0, badCoord.join(' | ') || '全部一致');
    assert(
      tag + ' · 每张卡片落在 3×3 的正确格位（grid-row=dr+2 / grid-column=dc+2）',
      badPlacement.length === 0,
      badPlacement.join(' | ') || '全部正确',
    );

    // 无重复格 / 无地图外格
    const ids = cells.map((c) => c.getAttribute('data-tileid'));
    assert(tag + ' · 不存在重复格', new Set(ids).size === ids.length, ids.join(','));
    const outside = ids.filter((id) => {
      const r = id.split(':').map(Number);
      return r[0] < 0 || r[0] >= ROWS || r[1] < 0 || r[1] >= COLS;
    });
    assert(tag + ' · 不存在地图外格', outside.length === 0, outside.join(',') || '无');

    // 没有自动补位：缺的方向必须恰好是越界方向
    const present = {};
    cells.forEach((c) => (present[c.getAttribute('data-dr') + ',' + c.getAttribute('data-dc')] = 1));
    const wrong = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const inBounds = p[0] + dr >= 0 && p[0] + dr < ROWS && p[1] + dc >= 0 && p[1] + dc < COLS;
        if (!!present[dr + ',' + dc] !== inBounds) wrong.push(dr + ',' + dc + (inBounds ? ' 缺失' : ' 多余'));
      }
    }
    assert(tag + ' · 越界方向留空、无自动补位（缺的正好是越界方向）', wrong.length === 0, wrong.join(' | ') || '方位集合完全正确');

    // 当前格唯一 + 位于正中央
    const current = cells.filter((c) => c.classList.contains('is-current'));
    const cur = current[0];
    assert(
      tag + ' · 当前格唯一且在正中央 (0,0 → 第2行第2列)',
      current.length === 1 &&
        !!cur &&
        cur.getAttribute('data-tileid') === want &&
        Number(getComputedStyle(cur).gridRowStart) === 2 &&
        Number(getComputedStyle(cur).gridColumnStart) === 2,
      current.length + ' 个当前格 · ' + (cur ? cur.getAttribute('data-tileid') + ' 位置=' + getComputedStyle(cur).gridRowStart + '/' + getComputedStyle(cur).gridColumnStart : '无'),
    );

    // 几何位置与方位一致：北在上、南在下、西在左、东在右
    const byDelta = {};
    cells.forEach((c) => (byDelta[c.getAttribute('data-dr') + ',' + c.getAttribute('data-dc')] = cellRect(c)));
    const geoOk = [];
    const geoBad = [];
    const cmp = (name, a, b, axis, dir) => {
      if (!a || !b) return;
      const ok = dir === 'lt' ? a[axis] < b[axis] - 1 : a[axis] > b[axis] + 1;
      (ok ? geoOk : geoBad).push(name);
    };
    cmp('西北在正北左侧', byDelta['-1,-1'], byDelta['-1,0'], 'cx', 'lt');
    cmp('东北在正北右侧', byDelta['-1,1'], byDelta['-1,0'], 'cx', 'gt');
    cmp('正北在当前格上方', byDelta['-1,0'], byDelta['0,0'], 'cy', 'lt');
    cmp('正南在当前格下方', byDelta['1,0'], byDelta['0,0'], 'cy', 'gt');
    cmp('西在当前格左侧', byDelta['0,-1'], byDelta['0,0'], 'cx', 'lt');
    cmp('东在当前格右侧', byDelta['0,1'], byDelta['0,0'], 'cx', 'gt');
    cmp('西北在东北左侧', byDelta['-1,-1'], byDelta['-1,1'], 'cx', 'lt');
    cmp('西南在东南左侧', byDelta['1,-1'], byDelta['1,1'], 'cx', 'lt');
    cmp('西南在西北下方', byDelta['1,-1'], byDelta['-1,-1'], 'cy', 'gt');
    assert(tag + ' · 几何位置与地图方位一致', geoBad.length === 0, '校验 ' + geoOk.length + ' 组 · ' + (geoBad.length ? '错误：' + geoBad.join(',') : '全部正确'));

    // 方位名与位置一致
    const missing = spec.dirs.filter((d) => dirs.indexOf(d) < 0);
    assert(
      tag + ' · 方位标注正确（' + spec.dirs.join('/') + '）',
      missing.length === 0,
      '实际=' + dirs.join(',') + (missing.length ? ' 缺=' + missing.join(',') : ''),
    );

    // 地形不因预报永久揭示
    const unknownCells = cells.filter((c) => txt($('.fc-terrain', c)) === '未知');
    const leaked = [];
    for (const c of unknownCells) {
      const id = c.getAttribute('data-tileid');
      const tile = document.querySelector('.grid-tile[data-tileid="' + id + '"]');
      if (tile && !tile.classList.contains('unknown')) leaked.push(id);
    }
    assert(
      tag + ' · 预报不永久揭示未知地形（显示"未知"的格子在地图上仍是 ?）',
      leaked.length === 0,
      '未知格 ' + unknownCells.length + ' 个 · 泄漏=' + (leaked.join(',') || '无'),
    );

    // 坐标与地图一致（当前格）
    assert(tag + ' · 当前格坐标显示正确', txt($('.fc-coord', cur)).indexOf('(' + p[0] + ',' + p[1] + ')') === 0, txt($('.fc-coord', cur)));

    pass(tag + ' 全部方位断言通过', '卡片数=' + cells.length + ' 方位=' + dirs.join(','));
    const cl = $('.modal-close');
    if (cl) {
      cl.click();
      await sleep(240);
    }
    return { ok: true, count: cells.length };
  }

  const scene = async () => {
    const only = typeof window.__FC_CASE === 'number' ? window.__FC_CASE : null;
    const specs = only === null ? caseSpecs : [caseSpecs[only]];
    const done = [];
    for (const spec of specs) {
      const baseSeed = 'fc-pos-' + spec.name.replace(/[^\w]/g, '');
      const seeds = [baseSeed, baseSeed + '-r2', baseSeed + '-r3'];
      let lastReason = '';
      let succeeded = false;
      for (const seed of seeds) {
        const r = await attemptOnce(spec, seed);
        if (r.fatal) {
          fail('预报方位 · ' + spec.name + ' 开局', r.fatal);
          break;
        }
        if (r.ok) {
          succeeded = true;
          done.push(spec.name + '=' + r.count);
          break;
        }
        lastReason = r.retry;
      }
      if (!succeeded && lastReason) {
        fail('预报方位 · ' + spec.name + ' 走到目标格', '三次尝试均失败：' + lastReason);
      }
    }
    R.forecastCases = (R.forecastCases || []).concat(done);
    if (only === null) {
      assert('预报方位 · 覆盖 9 类位置', done.length === 9, '完成 ' + done.length + ' 类：' + done.join(' , '));
    }
  };

  await O.finalize('forecast', scene);
  return 'done:forecast';
})();
