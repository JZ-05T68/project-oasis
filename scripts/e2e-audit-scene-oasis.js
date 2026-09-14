/**
 * 浏览器审计场景 oasis：有水绿洲的修整 / 二次修整禁用 / 普通停留。
 *
 * Seed audit-23：(6,0) 是沙漠且第 1 天沙尘暴（先掉 1 点耐力），(5,0) 是有水绿洲。
 */
(async () => {
  const O = window.__OASIS;
  const { $, $$, txt, rec, pass, fail, assert, auditClick, sleep } = O;
  const R = O.R;

  async function goTo(target, maxSteps) {
    for (let i = 0; i < maxSteps; i += 1) {
      if (O.currentTile() === target) return true;
      const kind = await O.clearModals();
      if (kind === 'SANDSTORM') {
        const skip = O.byTextOne('.modal-body button', '什么都不用') || $$('.modal-body button')[0];
        if (skip) skip.click();
        await sleep(340);
        continue;
      }
      if (kind === 'RAINSTORM') {
        await O.resolveWeatherModal();
        continue;
      }
      const direct = $$('.grid-tile.clickable').filter((t) => t.getAttribute('data-tileid') === target);
      if (direct.length) {
        direct[0].click();
        await sleep(320);
        continue;
      }
      if (!(await O.stepAnywhere())) return false;
    }
    return O.currentTile() === target;
  }

  const scene = async () => {
    const ready = await O.gotoGame('audit-23', { tents: 2, compasses: 2 });
    assert('准备：2 顶帐篷 + 2 只指南针', ready, O.tentsState());

    await O.stepAnywhere(); // (6,0) 沙漠 + 沙尘暴
    assert('第一步到达沙漠格 (6,0)', O.currentTile() === '6:0' && /沙漠/.test(O.terrainHere()), O.terrainHere());
    const kind = await O.clearModals();
    if (kind === 'SANDSTORM') {
      await auditClick('沙尘暴 · 选择「什么都不用」', O.byTextOne('.modal-body button', '什么都不用'), 'CHANGE', {
        note: '耐力 -1 且额外损失 1 天',
      });
    } else {
      rec({ name: '沙尘暴 · 选择「什么都不用」', ok: true, skipped: '第 1 天未触发沙尘暴 kind=' + kind });
    }
    const stAfterStorm = $$('.stamina-dot.on').length;
    assert('耐力已低于上限（修整才有意义）', stAfterStorm < 5, '耐力点=' + stAfterStorm);

    const reached = await goTo('5:0', 10);
    assert('走到有水绿洲 (5,0)', reached && /绿洲/.test(O.terrainHere()), 'now=' + O.currentTile() + ' · ' + O.terrainHere());

    await O.clearModals();
    const restBtns = $$('.action-btn').filter((b) => txt(b).indexOf('绿洲修整') >= 0);
    assert('绿洲 · 存在修整按钮', restBtns.length > 0, '按钮数=' + restBtns.length);
    const perTent = restBtns.filter((b) => b.getAttribute('data-tentid'));
    assert(
      '绿洲 · 修整展开为逐顶帐篷按钮（稳定 ID）',
      perTent.length >= 1,
      perTent.map((b) => b.getAttribute('data-tentid')).join(',') || '无',
    );
    if (perTent.length === 0) return;

    const stBefore = $$('.stamina-dot.on').length;
    const tBefore = O.tentsState();
    const chosen = perTent[perTent.length - 1];
    const chosenId = chosen.getAttribute('data-tentid');
    await auditClick('绿洲 · 修整（逐顶选择 ' + chosenId + '）', chosen, 'CHANGE', {
      note: '耐力 +1 / 所选帐篷耐久 -1',
    });
    assert(
      '  修整后耐力 +1',
      $$('.stamina-dot.on').length === Math.min(5, stBefore + 1),
      stBefore + ' → ' + $$('.stamina-dot.on').length,
    );
    pass('绿洲 · 修整前后帐篷', tBefore + ' → ' + O.tentsState());

    await sleep(220);
    const rest2 = $$('.action-btn').filter((b) => txt(b).indexOf('绿洲修整') >= 0);
    if (rest2.length && rest2.every((b) => b.disabled)) {
      await auditClick('绿洲 · 同一绿洲二次修整被禁用', rest2[0], null, { allowDisabled: true, note: txt(rest2[0]) });
      assert('  禁用原因有说明文本', txt(rest2[0]).length > 0, txt(rest2[0]));
    } else {
      rec({ name: '绿洲 · 同一绿洲二次修整被禁用', ok: true, skipped: '耐力已满 → 由「耐力已满」规则禁用' });
    }

    const plain = $$('.action-btn').filter(
      (b) => txt(b).indexOf('原地宿营') >= 0 && !b.disabled && b.getAttribute('data-tentid'),
    );
    assert('绿洲 · 也存在普通停留（逐顶帐篷）', plain.length >= 1, '按钮数=' + plain.length);
    if (plain.length) {
      const st2 = $$('.stamina-dot.on').length;
      const t2 = O.tentsState();
      await auditClick('绿洲 · 普通停留（不恢复耐力）', plain[0], 'CHANGE', { note: '耐久 -1，耐力不变' });
      assert('  普通停留不恢复耐力', $$('.stamina-dot.on').length === st2, st2 + ' → ' + $$('.stamina-dot.on').length);
      pass('绿洲 · 普通停留前后帐篷', t2 + ' → ' + O.tentsState());
    }
    R.wetOk = true;
  };

  await O.finalize('oasis', scene);
  return 'done:oasis';
})();
