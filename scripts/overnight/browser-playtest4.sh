export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis
click_text() { agent-browser eval "(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('$1'));if(b&&!b.disabled){b.click();return 'CLICKED';}return 'NO';})()"; }
wait_ms() { agent-browser eval "new Promise(r=>setTimeout(()=>r('ok'),$1))" > /dev/null 2>&1; }
agent-browser close --all > /dev/null 2>&1
agent-browser open "http://127.0.0.1:4173/" > /dev/null 2>&1
click_text '我已阅读规则' > /dev/null; wait_ms 400
click_text '开始游戏' > /dev/null; wait_ms 700
echo "=== 移动 3 步（每步点击 .grid-tile.clickable） ==="
for i in 1 2 3; do
  agent-browser eval "(function(){const t=[...document.querySelectorAll('.grid-tile.clickable')];if(!t.length)return 'NO_CLICKABLE';t[0].click();return 'CLICKED '+t.length+' 个可前往格';})()"
  wait_ms 700
  agent-browser eval "(function(){const t=document.body.innerText||'';return JSON.stringify({step:'$i',day:(t.match(/第\s*(\d+)\s*\//)||[])[1],cash:(t.match(/现金\s*(\d+)/)||[])[1],pos:(t.match(/地点\s*\((\d+,\d+)\)/)||[])[1],terrain:(t.match(/地点\s*\(\d+,\d+\)\s*(\S+)/)||[])[1]});})()"
done
echo "=== 旅途日志尾部 ==="
agent-browser eval "((document.body.innerText||'').split('旅途日志')[1]||'').slice(-400)"
echo "=== 截图 ==="
agent-browser screenshot reports/overnight-balance/raw/browser/playtest-03.png > /dev/null 2>&1; echo ok
