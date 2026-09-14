/**
 * 浏览器审计场景 rain：多顶帐篷 × 草地暴雨（整顶报废）。
 *
 * Seed audit-3：城市邻格 (6,0) 是草地，第 1/4/5/6 天为暴雨。
 * 拿 4 顶帐篷 + 4 只指南针，第一天抵达即触发暴雨 Modal，验证：
 *  - Modal 内所有帐篷按钮指针可达；
 *  - 被选中的那顶帐篷**整顶报废**（无论剩余耐久），其它帐篷不变；
 *  - 用帐篷不掉耐力。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, rec, pass, fail, assert, auditClick, sleep, hitTest } = O;
  const R = O.R;
  const SEED = 'audit-3';

  function tentButtonInModal(letter) {
    return $$('.modal-body button').filter((b) => {
      if (b.disabled) return false;
      const row = b.closest('.tent-choice');
      if (!row) return false;
      return txt(row).indexOf('Tent ' + letter) === 0 && txt(b).indexOf('使用帐篷') >= 0;
    })[0];
  }
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

  const scene = async () => {
    const ready = await O.gotoGame(SEED, { tents: 4, compasses: 4 });
    assert('准备：4 顶帐篷 + 4 只指南针', ready && /A .*B .*C .*D /.test(O.tentsState()), O.tentsState());

    await O.stepAnywhere();
    assert('已走到城市上方邻格', O.currentTile() === '6:0', 'now=' + O.currentTile() + ' · ' + O.terrainHere());
    assert('该格是草地（暴雨专项目标格）', /草地/.test(O.terrainHere()), O.terrainHere());

    let rains = 0;
    const destroyed = [];
    const order = ['D', 'C'];
    for (let step = 0; step < 24 && rains < 2; step += 1) {
      const kind = await O.clearModals();
      if (kind === 'RAINSTORM') {
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
        assert(
          '暴雨 Modal 第 ' + (rains + 1) + ' 次：全部可点按钮指针可达',
          bad.length === 0,
          '检查 ' + checked + ' 个 · ' + (bad.length ? bad.join(' | ') : '无遮挡') + (!!$('.modal-scroll-hint') ? ' · [滚动提示可见]' : ''),
        );
        const want = order[rains];
        const btn = tentButtonInModal(want);
        if (!btn) {
          fail('暴雨 · 选择 Tent ' + want, '找不到 Tent ' + want + ' 的按钮（剩余：' + O.tentsState() + '）');
          break;
        }
        const before = O.tentsState();
        const stBefore = $$('.stamina-dot.on').length;
        btn.click();
        await sleep(420);
        const after = O.tentsState();
        const expected = parseTents(before);
        delete expected[want];
        assert('暴雨 · Tent ' + want + ' 整顶报废（数量 -1）', sameTents(parseTents(after), expected), before + ' → ' + after);
        assert('暴雨 · 用帐篷不掉耐力', $$('.stamina-dot.on').length === stBefore, stBefore + ' → ' + $$('.stamina-dot.on').length);
        destroyed.push(want);
        rains += 1;
        continue;
      }
      if (kind === 'SANDSTORM') {
        await O.resolveWeatherModal();
        continue;
      }
      const camp = $$('.action-btn').filter((b) => txt(b).indexOf('原地宿营') >= 0 && !b.disabled)[0];
      if (!camp) {
        fail('暴雨专项 · 继续宿营', '没有可用的宿营按钮（帐篷=' + O.tentsState() + '）');
        break;
      }
      camp.click();
      await sleep(340);
    }
    assert('暴雨专项：至少触发并完整处理 2 次草原暴雨', rains >= 2, '次数=' + rains + ' · 报废=' + destroyed.join(','));

    // 不使用帐篷的路径：耐力 -1 且帐篷保留
    await O.clearModals();
    for (let step = 0; step < 24; step += 1) {
      const kind = await O.clearModals();
      if (kind === 'RAINSTORM') {
        const skip = O.byTextOne('.modal-actions button', '不用帐篷');
        if (!skip) {
          fail('暴雨 · 不用帐篷选项存在', '找不到「不用帐篷」按钮');
          break;
        }
        const st = $$('.stamina-dot.on').length;
        const tentsBefore = O.tentsState(); // 必须在点击前取，中间宿营会消耗帐篷
        skip.click();
        await sleep(400);
        const same = sameTents(parseTents(O.tentsState()), parseTents(tentsBefore));
        const stAfter2 = $$('.stamina-dot.on').length;
        assert(
          '暴雨 · 选择不用帐篷：耐力 -1 且帐篷完全保留',
          same && stAfter2 === st - 1,
          tentsBefore + ' → ' + O.tentsState() + ' · 耐力 ' + st + ' → ' + stAfter2,
        );
        break;
      }
      if (kind === 'SANDSTORM') {
        await O.resolveWeatherModal();
        continue;
      }
      const camp = $$('.action-btn').filter((b) => txt(b).indexOf('原地宿营') >= 0 && !b.disabled)[0];
      if (!camp) break;
      camp.click();
      await sleep(340);
    }

    R.rains = rains;
    R.destroyed = destroyed;
    R.tentsEnd = O.tentsState();
  };

  await O.finalize('rain', scene);
  return 'done:rain';
})();
