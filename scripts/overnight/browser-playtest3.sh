export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis
URL="${1:-http://127.0.0.1:4173/}"
click_text() { agent-browser eval "(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('$1'));if(b&&!b.disabled){b.click();return 'CLICKED';}return 'NO';})()"; }
wait_ms() { agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),$1))" > /dev/null 2>&1; }
agent-browser close --all > /dev/null 2>&1
agent-browser open "$URL" > /dev/null 2>&1
click_text '我已阅读规则' > /dev/null; wait_ms 400
click_text '开始游戏' > /dev/null; wait_ms 700
echo "=== 关闭所有待确认反馈弹窗 ==="
for i in 1 2 3 4 5; do click_text '确定' > /dev/null; wait_ms 250; done
echo "=== grid-tile 类名分布 ==="
agent-browser eval "JSON.stringify([...new Set([...document.querySelectorAll('.grid-tile')].map(e=>e.className))])"
echo "=== 点击一个可前往格 ==="
agent-browser eval "(function(){const t=[...document.querySelectorAll('.grid-tile')].filter(e=>/legal|reach|avail|move/i.test(e.className));if(t.length){t[0].click();return 'CLICKED_LEGAL:'+t[0].className;}return 'NO_LEGAL_TILE';})()"
wait_ms 800
echo "=== 移动后状态 ==="
agent-browser eval "(function(){const t=document.body.innerText||'';return JSON.stringify({day:(t.match(/第\s*(\d+)\s*\//)||[])[1],cash:(t.match(/现金\s*(\d+)/)||[])[1],pos:(t.match(/地点\s*\((\d+,\d+)\)/)||[])[1],tail:(t.split('旅途日志')[1]||'').slice(-260)});})()"
