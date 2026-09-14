/**
 * 浏览器审计场景 oasisdry：干涸绿洲禁止修整。
 * Seed audit-0：城市邻格 (6,0) 是干涸绿洲。
 */
(async () => {
  const O = window.__OASIS;
  const { $$, txt, rec, assert, auditClick } = O;
  const R = O.R;

  const scene = async () => {
    const ready = await O.gotoGame('audit-0', { tents: 2, compasses: 2 });
    assert('准备：2 顶帐篷 + 2 只指南针', ready, O.tentsState());
    await O.stepAnywhere();
    assert('第一步到达绿洲格 (6,0)', O.currentTile() === '6:0' && /绿洲/.test(O.terrainHere()), O.terrainHere());
    await O.clearModals();

    const rest = $$('.action-btn').filter((b) => txt(b).indexOf('绿洲修整') >= 0);
    assert(
      '干涸绿洲 · 存在修整按钮但必须禁用',
      rest.length > 0 && rest.every((b) => b.disabled),
      '按钮数=' + rest.length + ' · ' + (rest[0] ? txt(rest[0]) : ''),
    );
    if (rest.length) {
      await auditClick('干涸绿洲 · 修整被禁用', rest[0], null, { allowDisabled: true, note: txt(rest[0]) });
      assert('  禁用原因明确说明「已干涸」', /干涸/.test(txt(rest[0])), txt(rest[0]));
    }
    const plain = $$('.action-btn').filter((b) => txt(b).indexOf('原地宿营') >= 0 && !b.disabled);
    assert('干涸绿洲 · 仍可作为普通野外宿营停留（需要帐篷）', plain.length >= 1, '按钮数=' + plain.length);
    if (plain.length) {
      await auditClick('干涸绿洲 · 普通野外宿营', plain[0], 'CHANGE', { note: '耐久 -1' });
    }
    R.dryOk = rest.length > 0 && rest.every((b) => b.disabled);
    rec({ name: '干涸绿洲：不能通过花一天获得任何恢复效果', ok: rest.length > 0 && rest.every((b) => b.disabled) });
  };

  await O.finalize('oasisdry', scene);
  return 'done:oasisdry';
})();
