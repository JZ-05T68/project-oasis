/**
 * 汇总浏览器审计日志 → reports/audit/SUMMARY.md
 * 用法：npx tsx scripts/audit-summary.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

interface Entry {
  name: string;
  ok: boolean;
  detail?: string;
  skipped?: string;
}

const SCENES = ['menu', 'storm', 'rain', 'oasis', 'oasisdry'];
const lines: string[] = [];
lines.push('# 浏览器逐按钮点击审计（v0.1.2b Human Playtest Fix Round 1）');
lines.push('');
lines.push('驱动：`scripts/run-browser-audit.sh`（agent-browser + 真实 Chromium，真实点击）。');
lines.push('审计对每个控件做：存在性 / disabled / 0 尺寸 / 指针命中（elementFromPoint）/');
lines.push('是否需要滚动才可达 / 真实点击后状态指纹是否按预期变化。');
lines.push('');

let totalAll = 0;
let failedAll = 0;
for (const scene of SCENES) {
  const logPath = `reports/audit/${scene}.log`;
  if (!existsSync(logPath)) {
    lines.push('## ' + scene + '（缺少日志）');
    lines.push('');
    continue;
  }
  const log = readFileSync(logPath, 'utf-8');
  const head = (log.match(/=== scene=\S+ viewport=\S+ url=\S+ ===/) || [''])[0];
  const m = log.match(/--- AUDIT DETAIL ---\r?\n(.*)\r?\n/);
  lines.push('## ' + scene);
  lines.push('');
  lines.push('```');
  lines.push(head);
  lines.push('```');
  lines.push('');
  if (!m) {
    lines.push('（未捕获到审计明细，请看 ' + logPath + '）');
    lines.push('');
    continue;
  }
  let arr: Entry[] = [];
  try {
    arr = JSON.parse(JSON.parse(m[1]));
  } catch {
    lines.push('（审计明细解析失败）');
    lines.push('');
    continue;
  }
  const failed = arr.filter((x) => !x.ok);
  const skipped = arr.filter((x) => x.skipped);
  totalAll += arr.length;
  failedAll += failed.length;
  lines.push('控件项：**' + arr.length + '** · 通过 ' + (arr.length - failed.length) + ' · 失败 ' + failed.length + ' · 跳过 ' + skipped.length);
  lines.push('');
  lines.push('| 结果 | 控件 | 备注 |');
  lines.push('| --- | --- | --- |');
  for (const r of arr) {
    const mark = r.ok ? (r.skipped ? '— 跳过' : '✅ 通过') : '❌ 失败';
    const note = (r.detail || r.skipped || '').replace(/\|/g, '\\|').slice(0, 180);
    lines.push('| ' + mark + ' | ' + r.name.replace(/\|/g, '\\|') + ' | ' + note + ' |');
  }
  lines.push('');
  const errs = (log.match(/--- CONSOLE ERRORS ---\r?\n([\s\S]*)$/) || [])[1]?.trim() || '';
  lines.push('控制台错误：' + (errs && errs !== '(no errors)' ? '```' + errs + '```' : '无'));
  lines.push('');
}

lines.unshift('');
lines.splice(
  1,
  0,
  '**总计：' + totalAll + ' 个控件项，失败 ' + failedAll + ' 个。**',
);
writeFileSync('reports/audit/SUMMARY.md', lines.join('\n') + '\n');
console.log('reports/audit/SUMMARY.md 已生成：总项 ' + totalAll + '，失败 ' + failedAll);
