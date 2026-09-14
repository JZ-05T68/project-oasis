#!/usr/bin/env bash
# 第二段真人式流程：开局购买 → 移动 → 天气预报 → 日志/结算 UI 数值一致性
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis
URL="${1:-http://127.0.0.1:4173/}"

click_text() {
  agent-browser eval "(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('$1'));if(b&&!b.disabled){b.click();return 'CLICKED';}return 'NOT_FOUND_OR_DISABLED';})()"
}
wait_ms() { agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),$1))" > /dev/null 2>&1; }
state() {
  agent-browser eval "(function(){const t=(document.body.innerText||'');const g=(re)=>{const m=t.match(re);return m?m[1]:null;};return JSON.stringify({day:g(/第\s*(\d+)\s*\/\s*(\d+)\s*天/)?t.match(/第\s*(\d+)\s*\/\s*(\d+)\s*天/)[1]:null,maxDay:t.match(/第\s*\d+\s*\/\s*(\d+)\s*天/)?t.match(/第\s*\d+\s*\/\s*(\d+)\s*天/)[1]:null,cash:t.match(/现金\s*(\d+)\s*元/)?t.match(/现金\s*(\d+)\s*元/)[1]:null,stamina:(t.match(/耐力\s*([^\n]*)/)||[])[1]||null,tents:(t.match(/帐篷\s*([^\n]*)/)||[])[1]||null,forecast:(t.match(/预报次数\s*(\d+)/)||[])[1]||null,lastLog:(document.body.innerText||'').split('旅途日志')[1]||''});})()"
}

agent-browser close --all > /dev/null 2>&1
agent-browser open "$URL" > /dev/null 2>&1
click_text '我已阅读规则' > /dev/null
wait_ms 400
click_text '开始游戏' > /dev/null
wait_ms 700

echo "=== 开局状态 ==="
state

echo "=== 购买帐篷（应为 2000 → 1300） ==="
click_text '购买帐篷'
wait_ms 400
state

echo "=== 购买指南针（1300 → 1200） ==="
click_text '购买指南针'
wait_ms 400
state

echo "=== 购买天气预报包（最大天数 42→41，预报次数 0→4） ==="
click_text '购买天气预报包'
wait_ms 400
state

echo "=== 点击地图可前往的格子移动一格 ==="
agent-browser eval "(function(){const bs=[...document.querySelectorAll('button')];const cand=bs.filter(b=>(b.className||'').match(/legal|reachable|move|go|available/i));if(cand.length){cand[0].click();return 'CLICK_CELL_CLASS:'+cand[0].className;}const q=bs.filter(b=>(b.textContent||'').trim()==='?'&&!b.disabled);if(q.length){q[0].click();return 'CLICK_FIRST_Q:'+q.length;}return 'NO_CELL';})()"
wait_ms 800
state

echo "=== 地图格 class 抽样（确认可前往高亮存在） ==="
agent-browser eval "JSON.stringify([...document.querySelectorAll('button')].slice(0,6).map(b=>b.className+'|'+(b.textContent||'').trim()))"

echo "=== 截图 ==="
agent-browser screenshot reports/overnight-balance/raw/browser/playtest-02.png > /dev/null 2>&1
echo "ok"
