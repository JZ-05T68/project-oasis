/**
 * Project Oasis — 浏览器审计场景 stormlabels2（v0.1.2b 追加）。
 *
 * 沙尘暴 Modal 在「没有指南针」时的 disabled 状态：
 *  - 「+ 指南针（安全通过）」必须仍然完整可读（只是禁用，不是被裁掉）；
 *  - 「只用指南针」不渲染、「什么都不用」必须完整可读；
 *  - 所有可点/不可点按钮的文案都必须能被用户看清。
 */
(function () {
  const O = window.__OASIS;
  const SEED = 'audit-14';

  window.__SWEEP = {
    ready: false,
    run: function (w, h, label) {
      const tag = '沙尘暴禁用态 ' + label + ' ' + w + '×' + h;
      const modal = O.$('[aria-label="沙尘暴！"]');
      if (!modal) {
        O.fail(tag + ' · 沙尘暴 Modal 仍打开', 'kind=' + O.modalKind());
        return 'no-modal';
      }
      O.assert(
        tag + ' · 四顶帐篷各占一行',
        O.$$('.tent-choice', modal).length === 4,
        '行数=' + O.$$('.tent-choice', modal).length,
      );
      const compassBtn = O.byTextOne('.modal-body button', '+ 指南针（安全通过）', modal);
      O.assert(
        tag + ' · 没有指南针时「+ 指南针（安全通过）」禁用但仍然完整可见',
        !!compassBtn && compassBtn.disabled === true,
        compassBtn ? 'disabled=' + compassBtn.disabled : '找不到按钮',
      );
      O.assertLabelsIntact(tag, [O.STORM_LABELS.perTent[1], O.STORM_LABELS.noTentNothing]);
      const noCompassOption = O.byTextOne('.modal-actions button', '只用指南针');
      O.assert(tag + ' · 没有指南针时不渲染「只用指南针」', !noCompassOption, noCompassOption ? O.txt(noCompassOption) : '未渲染');
      return 'measured:' + tag;
    },
    finish: async function () {
      window.__AUDIT_DONE = true;
    },
  };

  (async function () {
    const ok = await O.prepareStorm(SEED, 4, 0, []);
    O.assert('沙尘暴禁用态 · 准备现场（4 顶帐篷 + 0 指南针）', ok, 'kind=' + O.modalKind());
    window.__SWEEP.ready = true;
  })();
})();
