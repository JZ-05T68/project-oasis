/**
 * 浏览器审计场景 storm：多顶帐篷 × 沙漠沙尘暴（真人试玩 P0 回归）。
 *
 * Seed audit-14：城市邻格 (6,0) 是沙漠，第 2/3/4/6/7 天为沙尘暴。
 * 拿 4 顶帐篷 + 4 只指南针，逐次在沙尘暴 Modal 里选择 Tent D / C / B / A，验证：
 *  - Modal 内每个可点按钮的指针命中都在自己身上（不被滚动容器裁剪、不被透明层遮挡）；
 *  - 四顶都能被真正选中，且只消耗被选中的那一顶。
 * 宿营的帐篷预算由「剩余耐久最多、且最晚被选中」的规则自动分配，保证四顶都能活到被选中的时刻。
 *
 * 注意：沙尘暴选「只用帐篷（迷路）」会额外损失 1 天，会让后续宿营日跳格；因此本场景统一走
 * 「帐篷 + 指南针（安全通过）」分支（日期按 1 天/次推进，正好覆盖第 2/3/4/6 天的 4 次沙尘暴）。
 * 「只用帐篷（迷路 +1 天）」分支由 menu 场景的行走过程覆盖。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, rec, pass, fail, assert, auditClick, sleep, hitTest } = O;
  const R = O.R;
  const SEED = 'audit-14';
  const ORDER = ['D', 'C', 'B', 'A']; // 沙尘暴选择顺序
  const ORDER_IDX = { 'tent-004': 0, 'tent-003': 1, 'tent-002': 2, 'tent-001': 3 };

  /** 对 Modal 内所有可点按钮做指针可达性审计 */
  async function auditHitTargets(label) {
    const buttons = $$('.modal-body button');
    const bad = [];
    let checked = 0;
    for (const b of buttons) {
      if (b.disabled) continue;
      checked += 1;
      let ht = hitTest(b);
      if (ht.state !== 'OK') {
        b.scrollIntoView({ block: 'center' });
        await sleep(90);
        ht = hitTest(b);
        if (ht.state !== 'OK') bad.push(txt(b).slice(0, 24) + ' → ' + ht.state);
      }
    }
    const hint = !!$('.modal-scroll-hint');
    assert(
      label + '：全部可点按钮指针可达',
      bad.length === 0,
      '检查 ' + checked + ' 个 · ' + (bad.length ? bad.join(' | ') : '无遮挡') + (hint ? ' · [滚动提示可见]' : ''),
    );
  }

  function tentButtonInModal(letter, keyword) {
    return $$('.modal-body button').filter((b) => {
      if (b.disabled) return false;
      const row = b.closest('.tent-choice');
      if (!row) return false;
      return txt(row).indexOf('Tent ' + letter) === 0 && txt(b).indexOf(keyword) >= 0;
    })[0];
  }

  /** "A 3/3、B 2/3、C 3/3" → { A:3, B:2, C:3 } */
  function parseTents(s) {
    const out = {};
    const re = /([A-Z]) (\d)\/3/g;
    let m;
    while ((m = re.exec(s)) !== null) out[m[1]] = Number(m[2]);
    return out;
  }
  function sameTents(a, b) {
    const ka = Object.keys(a).sort().join(',');
    const kb = Object.keys(b).sort().join(',');
    if (ka !== kb) return false;
    return Object.keys(a).every((k) => a[k] === b[k]);
  }
  /** 断言：只有 chosen 这顶耐久 -1（归零则整顶移除），其它帐篷完全不变 */
  function assertOnlyChosenConsumed(label, before, after, chosen) {
    const b = parseTents(before);
    const a = parseTents(after);
    const expected = { ...b };
    const left = (b[chosen] || 0) - 1;
    if (left > 0) expected[chosen] = left;
    else delete expected[chosen];
    return assert(label, sameTents(a, expected), before + ' → ' + after + '（期望只剩 ' + JSON.stringify(expected) + '）');
  }

  /** 宿营用哪一顶：剩余耐久最多；同耐久时优先「最晚被选中」的那顶，保证四顶都能活到被选中 */
  function pickCampButton() {
    const camps = $$('.action-btn').filter(
      (b) => txt(b).indexOf('原地宿营') >= 0 && !b.disabled && b.getAttribute('data-tentid'),
    );
    let best = null;
    let bestCharge = -1;
    let bestIdx = 99;
    for (const b of camps) {
      const id = b.getAttribute('data-tentid');
      const charge = Number((txt(b).match(/（(\d)\//) || [])[1] || 0);
      const idx = ORDER_IDX[id] === undefined ? 9 : ORDER_IDX[id];
      if (charge > bestCharge || (charge === bestCharge && idx < bestIdx)) {
        best = b;
        bestCharge = charge;
        bestIdx = idx;
      }
    }
    return best;
  }

  const scene = async () => {
    const ready = await O.gotoGame(SEED, { tents: 4, compasses: 4 });
    assert('准备：4 顶帐篷 + 4 只指南针', ready && /A .*B .*C .*D /.test(O.tentsState()), O.tentsState());

    // 走到 (6,0)：第 1 天（无沙尘暴）
    await O.stepAnywhere();
    assert('已走到城市上方邻格', O.currentTile() === '6:0', 'now=' + O.currentTile() + ' · ' + O.terrainHere());
    assert('该格是沙漠（沙尘暴专项目标格）', /沙漠/.test(O.terrainHere()), O.terrainHere());

    const used = [];
    let storms = 0;
    for (let step = 0; step < 24 && storms < 4; step += 1) {
      const kind = await O.clearModals();
      if (kind === 'SANDSTORM') {
        await auditHitTargets('沙尘暴 Modal 第 ' + (storms + 1) + ' 次');
        const want = ORDER[storms];
        const btn = tentButtonInModal(want, '指南针');
        if (!btn) {
          fail('沙尘暴 · 选择 Tent ' + want, '找不到 Tent ' + want + ' 的可用按钮（剩余：' + O.tentsState() + '）');
          break;
        }
        const before = O.tentsState();
        const compBefore = Number((txt(O.$('.topbar')).match(/指南针 (\d+)/) || [])[1]);
        const stBefore = $$('.stamina-dot.on').length;
        btn.click();
        await sleep(420);
        const after = O.tentsState();
        const compAfter = Number((txt(O.$('.topbar')).match(/指南针 (\d+)/) || [])[1]);
        const stAfter = $$('.stamina-dot.on').length;
        used.push(want);
        storms += 1;
        assertOnlyChosenConsumed('沙尘暴 · Tent ' + want + ' + 指南针：只消耗所选帐篷', before, after, want);
        assert(
          '沙尘暴 · 同时消耗 1 只指南针',
          Number.isFinite(compBefore) && compAfter === compBefore - 1,
          compBefore + ' → ' + compAfter,
        );
        assert('  安全通过：沙尘暴本身不扣耐力', stAfter === stBefore, stBefore + ' → ' + stAfter);
        // v0.1.2b 即时反馈：帐篷 + 指南针合并在同一个结果弹窗里
        // （队列按事件顺序，可能先有「野外宿营完成」，所以在整个队列里找「沙尘暴结算」）
        const infos = await O.collectResults(4);
        const res = infos.filter((r) => r.title === '沙尘暴结算')[0];
        assert(
          '沙尘暴 · 帐篷耐久与指南针变化合成同一个结果弹窗',
          !!res &&
            res.changes.some((c) => c.label === 'Tent ' + want) &&
            res.changes.some((c) => c.label === '指南针'),
          res
            ? res.title + ' · 变化=' + res.changes.map((c) => c.label).join(',')
            : '队列里没有「沙尘暴结算」：' + infos.map((i) => i.title).join(','),
        );
        continue;
      }
      if (kind === 'RAINSTORM') {
        await O.resolveWeatherModal();
        await O.clearResults();
        continue;
      }
      const camp = pickCampButton();
      if (!camp) {
        fail('沙尘暴专项 · 继续宿营', '没有可用的宿营按钮（帐篷=' + O.tentsState() + '）');
        break;
      }
      camp.click();
      await sleep(340);
      await O.clearResults();
    }
    assert('沙尘暴专项：Tent D / C / B / A 全部被逐一点中', used.join(',') === 'D,C,B,A', '实际顺序=' + used.join(','));
    pass('沙尘暴专项：四顶帐篷都只消耗被选中的那一顶', '结束时帐篷=' + O.tentsState());

    // 侧栏逐顶帐篷按钮（野外宿营）——多顶时每个帐篷一个按钮
    await O.clearModals();
    const campBtns = $$('.action-btn').filter((b) => txt(b).indexOf('原地宿营') >= 0 && b.getAttribute('data-tentid'));
    assert('野外宿营展开为逐顶帐篷按钮（带稳定 ID）', campBtns.length >= 1, '按钮=' + campBtns.map((b) => b.getAttribute('data-tentid')).join(','));
    if (campBtns.length) {
      const tBefore = O.tentsState();
      const target = campBtns[campBtns.length - 1];
      const targetId = target.getAttribute('data-tentid');
      await auditClick('野外宿营 · 选择 ' + targetId, target, 'CHANGE', { note: '耐久 -1' });
      const letter = { 'tent-001': 'A', 'tent-002': 'B', 'tent-003': 'C', 'tent-004': 'D' }[targetId];
      if (letter) assertOnlyChosenConsumed('野外宿营 · 只消耗 ' + targetId, tBefore, O.tentsState(), letter);
    }

    R.storms = storms;
    R.usedTents = used;
    R.tentsEnd = O.tentsState();
  };

  await O.finalize('storm', scene);
  return 'done:storm';
})();
