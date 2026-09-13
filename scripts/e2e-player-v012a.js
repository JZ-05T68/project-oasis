(function () {
  if (window.__playerInstalled) return 'already';
  window.__playerInstalled = true;
  window.__result = null;
  window.__trail = [];
  window.__phase = 'OUTBOUND';
  const qa = (s) => [...document.querySelectorAll(s)];
  const man = (a, b) => {
    const p = a.split(':').map(Number), q = b.split(':').map(Number);
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
  };
  const sleep = () => new Promise((r) => setTimeout(r, 150));
  async function step() {
    const bodyText = document.body.innerText;
    if (!document.querySelector('.grid-tile')) {
      window.__result = {
        outcome: bodyText.includes('成功返城') ? 'VICTORY' : 'DEFEAT',
        text: bodyText.slice(0, 300),
      };
      return;
    }
    const acts = qa('.modal-actions button');
    if (acts.length) {
      const h = (document.querySelector('.modal-header') || {}).innerText || '';
      const find = (t) => acts.find((b) => b.innerText.includes(t));
      let b = null;
      if (h.includes('沙尘暴')) b = acts.find((x) => x.innerText.includes('Tent') && x.innerText.includes('指南针') && !x.disabled) || acts.find((x) => x.innerText.includes('Tent') && !x.disabled) || acts[acts.length - 1];
      else if (h.includes('暴雨')) b = acts.find((x) => x.innerText.includes('使用 Tent')) || acts[acts.length - 1];
      else if (h.includes('商队')) b = find('免费获取') || acts[0];
      else if (h.includes('盗贼')) b = find('放弃');
      else if (h.includes('市集')) b = find('八折购物');
      (b || acts[0]).click();
      return;
    }
    const mineBtn = qa('button').find((b) => b.innerText.includes('挖矿（+'));
    const retBtn = qa('button').find((b) => b.innerText.includes('开始返程'));
    if (mineBtn) {
      window.__phase = 'MINING';
      if ((window.__mined || 0) < 2) { window.__mined = (window.__mined || 0) + 1; mineBtn.click(); }
      else if (retBtn) { retBtn.click(); window.__phase = 'RETURN'; }
      return;
    }
    if (window.__phase === 'MINING' && retBtn) { retBtn.click(); window.__phase = 'RETURN'; return; }
    const cur = document.querySelector('.grid-tile.current');
    if (!cur) return;
    const curId = cur.getAttribute('data-tileid');
    const returnPhase = window.__phase === 'RETURN' || !!document.querySelector('.grid-tile.on-ret');
    const clickable = qa('.grid-tile.clickable');
    if (!clickable.length) { window.__result = { outcome: 'STUCK', at: curId }; return; }
    let target;
    if (returnPhase) target = '9:0';
    else {
      const mines = qa('.grid-tile').filter((t) => t.innerText.includes('矿'));
      target = mines.map((t) => t.getAttribute('data-tileid')).sort((a, b) => man(curId, a) - man(curId, b))[0];
    }
    const cands = clickable.filter((t) => returnPhase || t.getAttribute('data-tileid') === target || !t.innerText.includes('矿'));
    const pool = cands.length ? cands : clickable;
    let bestT = null, bestD = 1e9;
    for (const t of pool) {
      const d = man(t.getAttribute('data-tileid'), target);
      if (d < bestD) { bestD = d; bestT = t; }
    }
    window.__trail.push(bestT.getAttribute('data-tileid'));
    bestT.click();
  }
  (async () => {
    for (let i = 0; i < 400 && !window.__result; i++) { await sleep(); await step(); }
    if (!window.__result) window.__result = { outcome: 'TIMEOUT_LOOP' };
  })();
  return 'installed';
})()
