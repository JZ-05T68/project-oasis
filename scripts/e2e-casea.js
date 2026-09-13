// Case A：按 window.__PATH 走到沙漠，反复宿营直到沙尘暴 Modal，验证逐顶帐篷选择
// 依赖：window.__PATH = ['8:0',...]；已购买帐篷与指南针
(async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  const qa = (x) => [...document.querySelectorAll(x)];
  window.__out = null;
  const clr = async () => {
    for (let i = 0; i < 4; i++) {
      const acts = qa('.modal-actions button');
      if (acts.length) {
        const h = (document.querySelector('.modal-header') || {}).innerText || '';
        const find = (t) => acts.find((b) => b.innerText.includes(t));
        let b = null;
        if (h.includes('沙尘暴')) return 'STORM';
        else if (h.includes('暴雨')) b = acts.find((x) => x.innerText.includes('使用 Tent')) || acts[acts.length - 1];
        else if (h.includes('商队')) b = find('免费获取') || acts[0];
        else if (h.includes('盗贼')) b = find('放弃');
        else if (h.includes('市集')) b = find('八折购物');
        (b || acts[0]).click();
        await s(220);
        continue;
      }
      break;
    }
    return 'clear';
  };
  // 沿路径走
  for (const tile of window.__PATH) {
    const el = document.querySelector('[data-tileid="' + tile + '"]');
    if (el && el.classList.contains('clickable')) { el.click(); await s(260); }
    const r = await clr();
    if (r === 'STORM') break;
  }
  // 宿营循环：交替使用 Tent A / Tent B，直到沙尘暴 Modal
  let stormSeen = false;
  let camps = 0;
  const usedTents = [];
  for (let i = 0; i < 7; i++) {
    const r = await clr();
    if (r === 'STORM') { stormSeen = true; break; }
    const campBtns = qa('.action-btn').filter((b) => b.innerText.includes('原地宿营') && !b.disabled);
    if (campBtns.length === 0) break;
    const pick = campBtns.find((b) => b.innerText.includes('Tent ' + String.fromCharCode(65 + (i % 2))));
    const btn = pick || campBtns[0];
    usedTents.push((btn.innerText.match(/Tent ([A-Z])/) || [])[1]);
    btn.click();
    camps++;
    await s(300);
    const r2 = await clr();
    if (r2 === 'STORM') { stormSeen = true; break; }
  }
  let modalTentButtons = 0;
  let choseA = false;
  if (stormSeen) {
    const acts = qa('.modal-actions button');
    modalTentButtons = acts.filter((b) => b.innerText.includes('Tent')).length;
    const chooseA = acts.find((b) => b.innerText.includes('只用 Tent A'));
    if (chooseA) { choseA = true; chooseA.click(); await s(300); }
  }
  window.__out = JSON.stringify({
    stormSeen, camps, usedTents, modalTentButtons, choseA,
    tents: (document.body.innerText.match(/帐篷\s*([^\n]+)/) || [])[1],
    days: (document.body.innerText.match(/第 \d+ \/ \d+ 天/) || [])[0],
  });
})()
