#!/usr/bin/env bash
# 真人式浏览器流程验证（WorkBuddy 内置浏览器 agent-browser，禁止系统 Chrome）。
# 本环境下跨 bash 调用会丢页面状态，因此整个流程必须在一次 open 之后连续执行。
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis
URL="${1:-http://127.0.0.1:4173/}"

click_text() {
  agent-browser eval "(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('$1'));if(b&&!b.disabled){b.click();return 'CLICKED';}return 'NOT_FOUND_OR_DISABLED';})()"
}
dump() {
  agent-browser eval "JSON.stringify({url:location.pathname,text:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,$1),buttons:[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(Boolean).slice(0,20)})"
}

echo "################ 真人式 E2E（内置浏览器） ################"
agent-browser close --all > /dev/null 2>&1
agent-browser open "$URL" > /dev/null 2>&1

echo "=== STEP 1 规则页 ==="
dump 200

echo "=== STEP 2 点击『我已阅读规则，开始远征』 ==="
click_text '我已阅读规则'
agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),400))" > /dev/null 2>&1
dump 400

echo "=== STEP 3 点击开始/出发按钮 ==="
click_text '开始'
agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),500))" > /dev/null 2>&1
click_text '出发'
agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),800))" > /dev/null 2>&1
dump 1500

echo "=== STEP 4 数值一致性检查（关键） ==="
agent-browser eval "JSON.stringify({
  hasTent700: document.body.innerHTML.includes('700'),
  hasTent400: document.body.innerHTML.includes('400 元'),
  hasForecast5: /获得 5 次预报/.test(document.body.innerText||document.body.innerHTML),
  hasForecast3: /获得 3 次预报/.test(document.body.innerText||document.body.innerHTML),
  hasCash2000: /2000/.test(document.body.innerText||''),
  hasStamina: /\d\/5/.test(document.body.innerText||''),
  rainMinus2: /-2|−2/.test(document.body.innerText||''),
  tentLabel: ([...document.querySelectorAll('button,td,span,div')].map(e=>(e.textContent||'')).filter(t=>t.includes('帐篷')&&t.includes('元'))[0]||'').slice(0,120),
  forecastLabel: ([...document.querySelectorAll('button,span,div')].map(e=>(e.textContent||'')).filter(t=>t.includes('预报')&&t.includes('次'))[0]||'').slice(0,160)
})"

echo "=== STEP 5 尝试移动一格（点击地图相邻格或方向按钮） ==="
agent-browser eval "(function(){const before=(document.body.innerText||'').match(/第\s*(\d+)\s*天/);const cells=[...document.querySelectorAll('[data-tile],.cell,.tile,button')].filter(e=>/^(↑|↓|←|→|上|下|左|右)$/.test((e.textContent||'').trim()));if(cells.length){cells[0].click();return 'ARROW_CLICKED:'+(cells[0].textContent||'').trim();}return 'NO_ARROW';})()"
agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),600))" > /dev/null 2>&1
dump 900

echo "=== STEP 6 截图 ==="
agent-browser screenshot reports/overnight-balance/raw/browser/playtest-01.png > /dev/null 2>&1
echo "screenshot -> reports/overnight-balance/raw/browser/playtest-01.png"

echo "=== DONE ==="
