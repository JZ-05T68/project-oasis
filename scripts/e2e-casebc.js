// Case B/C：按 window.__PATH 行走后执行检查
// mode = 'village'：免费等待 3 天（按钮无 Tent 后缀、帐篷不变、无遭遇刷新）
// mode = 'oasis-wet'：验证修整逐顶选择 + 停留/修整区分
// mode = 'oasis-dry'：验证干涸绿洲不能修整
(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  const qa = (x) => [...document.querySelectorAll(x)];
  window.__out = null;
  const mode = window.__MODE;
  const clr = async () => {
    for (let i = 0; i < 6; i++) {
      const acts = qa('.modal-actions button');
      if (acts.length) {
        const h = (document.querySelector('.modal-header') || {}).innerText || '';
        const find = (t) => acts.find((b) => b.innerText.includes(t));
        let b = null;
        if (h.includes('沙尘暴')) b = acts.find((x) => x.innerText.includes('Tent') && !x.disabled) || acts[acts.length - 1];
        else if (h.includes('暴雨')) b = acts.find((x) => x.innerText.includes('使用 Tent')) || acts[acts.length - 1];
        else if (h.includes('商队')) b = find('免费获取') || acts[0];
        else if (h.includes('盗贼')) b = find('放弃');
        else if (h.includes('市集')) b = find('八折购物');
        (b || acts[0]).click();
        await s(260);
        continue;
      }
      // 预报结果 Modal（无 actions，有 ×/关闭）
      const closeBtn = document.querySelector('.modal-close');
      if (closeBtn) { closeBtn.click(); await s(200); continue; }
      return 'clear';
    }
    return 'clear';
  };
  for (const tile of window.__PATH) {
    const el = document.querySelector('[data-tileid="' + tile + '"]');
    if (el && el.classList.contains('clickable')) { el.click(); await s(300); }
    let r = await clr();
    let guard = 0;
    while (r !== 'clear' && guard++ < 5) { r = await clr(); }
  }
  const tentsBefore = (document.body.innerText.match(/帐篷\s*([^\n]+)/) || [])[1];
  const daysBefore = (document.body.innerText.match(/第 (\d+) \/ (\d+) 天/) || [])[0];
  const waitBtns = qa('.action-btn').filter((b) => b.innerText.includes('原地停留'));
  const restBtns = qa('.action-btn').filter((b) => b.innerText.includes('绿洲修整'));
  const campBtns = qa('.action-btn').filter((b) => b.innerText.includes('原地宿营'));

  if (mode === 'village') {
    for (let i = 0; i < 3; i++) {
      const btn = qa('.action-btn').find((b) => b.innerText.includes('原地停留') && !b.disabled);
      if (!btn) break;
      btn.click();
      await s(280);
      await clr();
    }
    const tentsAfter = (document.body.innerText.match(/帐篷\s*([^\n]+)/) || [])[1];
    const daysAfter = (document.body.innerText.match(/第 (\d+) \/ (\d+) 天/) || [])[0];
    window.__out = JSON.stringify({
      waitBtnFree: waitBtns.length === 1 && !waitBtns[0].innerText.includes('Tent'),
      tentsBefore, tentsAfter, daysBefore, daysAfter,
      noEncounterModal: !qa('.modal-actions button').length,
    });
  } else if (mode === 'oasis-wet') {
    // 修整按钮应有逐顶帐篷选择
    const restPerTent = qa('.action-btn').filter((b) => b.innerText.includes('绿洲修整') && b.innerText.includes('Tent'));
    const staminaBefore = (document.body.innerText.match(/耐力/) ? qa('.stamina-dot.on').length : -1);
    const tentABefore = (document.body.innerText.match(/帐篷\s*([^\n]+)/) || [])[1];
    if (restPerTent.length > 0) {
      restPerTent[0].click(); // 用 Tent A
      await s(300);
      await clr();
    }
    const staminaAfter = qa('.stamina-dot.on').length;
    const tentAAfter = (document.body.innerText.match(/帐篷\s*([^\n]+)/) || [])[1];
    window.__out = JSON.stringify({
      restPerTentCount: restPerTent.length,
      campWaitAlsoAvailable: campBtns.length > 0,
      staminaBefore, staminaAfter,
      tentABefore, tentAAfter,
      days: (document.body.innerText.match(/第 \d+ \/ \d+ 天/) || [])[0],
    });
  } else if (mode === 'oasis-dry') {
    const restAll = qa('.action-btn').filter((b) => b.innerText.includes('绿洲修整'));
    const disabled = restAll.length > 0 && restAll.every((b) => b.disabled);
    const reason = restAll.length ? (restAll[0].innerText.match(/干涸[^\n]*/) || [''])[0] : '';
    window.__out = JSON.stringify({ restAllCount: restAll.length, disabled, reason });
  }
})()
