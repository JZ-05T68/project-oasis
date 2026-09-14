#!/usr/bin/env bash
# 用 WorkBuddy 内置浏览器（agent-browser）在一次会话内完成真人式流程验证。
# 注意：本环境下每次 bash 调用之间页面状态会丢失，因此必须在同一条命令里 open + 连续操作。
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis
OUT=reports/overnight-balance/raw/browser
mkdir -p "$OUT"
URL="${1:-http://127.0.0.1:4173/}"

say() { echo "--- $1 ---"; }

agent-browser close --all > /dev/null 2>&1
agent-browser open "$URL" > /dev/null 2>&1

say "STEP1 规则页：按钮列表 + 关键文案"
agent-browser eval "JSON.stringify({h1: document.querySelector('h1')?.textContent, h4s: [...document.querySelectorAll('h4')].slice(0,3).map(e=>e.textContent), buttons: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,12), has2000: document.body.innerHTML.includes('2000'), has42: document.body.innerHTML.includes('42 天')})"
