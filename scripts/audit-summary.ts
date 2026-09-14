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

const SCENES = ['menu', 'storm', 'rain', 'oasis', 'oasisdry', 'feedback', 'forecast', 'layout', 'stormlabels', 'stormlabels2'];
const lines: string[] = [];
lines.push('# 浏览器逐按钮点击审计（v0.1.2b · Human Playtest Fix Round 1 + 两项追加修复）');
lines.push('');
lines.push('驱动：`scripts/run-browser-audit.sh`（agent-browser + 真实 Chromium，真实点击）。');
lines.push('审计对每个控件做：存在性 / disabled / 0 尺寸 / 指针命中（elementFromPoint）/');
lines.push('是否需要滚动才可达 / 真实点击后状态指纹是否按预期变化。');
lines.push('');
lines.push('追加修复的两项专项覆盖：');
lines.push('');
lines.push('- `forecast`：天气预报必须按真实地图方位排列（9 类位置：内部 / 四边 / 四角），');
lines.push('  断言卡片按 (dr,dc) 落在 3×3 固定格位、越界方向留空不补位、当前格居中、不泄漏迷雾；');
lines.push('- `stormlabels` / `stormlabels2`：沙尘暴装备按钮文案完整性，');
lines.push('  在 1366×768 / 1920×1080 / 窄窗口 / 640 极窄，以及 90%、100%、110% 缩放下逐视口测量；');
lines.push('  含 4 顶帐篷（A 3/3、B 3/3、C 2/3、D 1/3）与「没有指南针」的禁用态。');
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
  const head = (log.match(/=== scene=\S+[^\n]*===/) || [''])[0];
  // AUDIT DETAIL 可能是多行（例如 forecast 场景每个案例一局、每局一行 JSON），逐行解析后合并
  const block = (log.match(/--- AUDIT DETAIL ---\r?\n([\s\S]*?)\r?\n--- CONSOLE ERRORS ---/) || [])[1];
  if (!block) {
    lines.push('## ' + scene);
    lines.push('');
    lines.push('```');
    lines.push(head);
    lines.push('```');
    lines.push('');
    lines.push('（未捕获到审计明细，请看 ' + logPath + '）');
    lines.push('');
    continue;
  }
  let arr: Entry[] = [];
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(JSON.parse(t));
      if (Array.isArray(parsed)) arr = arr.concat(parsed as Entry[]);
    } catch {
      // 非 JSON 行（runner 的进度输出）忽略
    }
  }
  lines.push('## ' + scene);
  lines.push('');
  lines.push('```');
  lines.push(head);
  lines.push('```');
  lines.push('');
  if (arr.length === 0) {
    lines.push('（审计明细解析失败，请看 ' + logPath + '）');
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
  const realErrs = errs
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== '✗' && l !== '(no errors)' && l !== '✓ Done')
    .join('\n');
  lines.push('控制台错误：' + (realErrs ? '```' + realErrs + '```' : '无'));
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
