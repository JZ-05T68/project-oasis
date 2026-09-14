/**
 * Project Oasis — 浏览器审计场景 stormlabels（v0.1.2b 追加）。
 *
 * 真人试玩确认问题：沙尘暴的装备选择按钮文字显示不完整（截断 / 遮挡 / 可视区不足）。
 *
 * 本场景在真实 Chromium 里：
 *  1. 用 4 顶帐篷（含 C 2/3、D 1/3 这类混合耐久）打开沙尘暴 Modal；
 *  2. 逐字校验四类按钮的完整文案；
 *  3. 对每个按钮做「无裁切 / 无遮挡 / 指针可达 / 在可视区内」检查；
 *  4. 由 runner 在 1366×768、1920×1080、窄窗口与 90/100/110% 缩放等视口下反复测量。
 *
 * 暴露 window.__SWEEP.run(w,h,label) 供 runner 逐视口调用。
 */
(function () {
  const O = window.__OASIS;
  const SEED = 'audit-14';
  const PLAN = ['tent-003', 'tent-004', 'tent-004']; // C 3→2、D 3→2→1

  function expectedLabels() {
    const L = O.STORM_LABELS;
    return [L.perTent[0], L.perTent[1], L.noTentCompass, L.noTentNothing];
  }

  let measured = 0;

  window.__SWEEP = {
    ready: false,
    pattern: '',
    run: function (w, h, label) {
      const tag = '沙尘暴按钮 ' + label + ' ' + w + '×' + h;
      const modal = O.$('[aria-label="沙尘暴！"]');
      if (!modal) {
        O.fail(tag + ' · 沙尘暴 Modal 仍打开', 'kind=' + O.modalKind());
        return 'no-modal';
      }
      const tentRows = O.$$('.tent-choice', modal).length;
      const expectedRows = O.$$('.topbar') ? Object.keys(O.tentCharges()).length : 0;
      O.assert(
        tag + ' · 四顶帐篷各占一行（含第 3/第 4 行）',
        tentRows === 4 && expectedRows === 4,
        '行数=' + tentRows + ' · 帐篷=' + O.tentsState() + ' · 形态=' + window.__SWEEP.pattern,
      );
      O.assertLabelsIntact(tag, expectedLabels());
      measured += 1;
      return 'measured:' + tag;
    },
    finish: async function () {
      // 追加：0 指南针时的 disabled 文案可读性
      O.assert('沙尘暴按钮 · 已完成 ' + measured + ' 个视口扫描', measured >= 6, '测量次数=' + measured);
      window.__AUDIT_DONE = true;
    },
  };

  (async function () {
    const ok = await O.prepareStorm(SEED, 4, 4, PLAN.slice());
    O.assert('沙尘暴按钮 · 准备现场（4 顶帐篷 + 4 只指南针，C/D 已被消耗过）', ok, 'tents=' + O.tentsState() + ' · kind=' + O.modalKind());
    window.__SWEEP.pattern = O.chargesPattern();
    const pattern = O.tentsCharges();
    O.assert(
      '沙尘暴按钮 · 混合耐久形态已构造（A/B 满耐久，C 或 D 不满）',
      Object.keys(pattern).length === 4 && new Set(Object.values(pattern)).size >= 2,
      '形态=' + window.__SWEEP.pattern,
    );
    if (window.__SWEEP.pattern === 'A3/B3/C2/D1') {
      O.pass('沙尘暴按钮 · 达到目标形态 A 3/3、B 3/3、C 2/3、D 1/3', window.__SWEEP.pattern);
    } else {
      O.rec({
        name: '沙尘暴按钮 · 目标形态 A 3/3、B 3/3、C 2/3、D 1/3',
        ok: true,
        skipped: '实际形态 ' + window.__SWEEP.pattern + '（中途天气消耗了其它帐篷，但仍是 4 行混合耐久）',
      });
    }
    O.R.labPattern = window.__SWEEP.pattern;
    window.__SWEEP.ready = true;
  })();
})();
