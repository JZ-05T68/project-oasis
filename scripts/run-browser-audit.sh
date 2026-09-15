#!/bin/bash
# Project Oasis — 浏览器逐项点击审计 runner（v0.1.2b Human Playtest Fix Round 1）。
#
# 用法：bash scripts/run-browser-audit.sh [scene] [width] [height]
#   scene: menu | storm | rain | oasis | oasisdry | feedback | layout | all（默认 all）
#
# 依赖：vite 开发服务器已在 AUDIT_URL（默认 http://127.0.0.1:5199/）运行。
# 备注：本机 Git Bash 环境下 agent-browser 的输出必须重定向到文件才能稳定捕获。
export PATH="/usr/bin:/bin:/mingw64/bin:$PATH"
cd "D:/Games/project-oasis" 2>/dev/null || exit 1

URL="${AUDIT_URL:-http://127.0.0.1:5199/}"
SCENE_ARG="${1:-all}"
WIDTH="${2:-1280}"
HEIGHT="${3:-620}"
OUTDIR="${AUDIT_OUTDIR:-reports/audit}"
mkdir -p "$OUTDIR"

# 视口扫描表：label width height zoom
# 90%/110% 浏览器缩放等价于 CSS 视口变宽/变窄（缩放不改变布局规则，只改变可用 CSS 像素）
LAYOUT_COMBOS=(
  "桌面 1366 768 100"
  "桌面 1518 853 90"
  "桌面 1242 698 110"
  "全高清 1920 1080 100"
  "全高清 2133 1200 90"
  "全高清 1745 982 110"
  "窄窗口 1024 768 100"
  "窄窗口 900 700 100"
)

# 装备按钮 / 文案完整性扫描：覆盖需求里要求的 1366×768、1920×1080、窄窗口与 90/100/110%
SWEEP_COMBOS=(
  "桌面 1366 768 100"
  "桌面 1518 853 90"
  "桌面 1242 698 110"
  "全高清 1920 1080 100"
  "全高清 2133 1200 90"
  "全高清 1745 982 110"
  "窄窗口 1024 768 100"
  "窄窗口 900 700 100"
  "极窄 640 700 100"
)

summarize() {
  local scene="$1"
  agent-browser eval "JSON.stringify({viewport:[window.innerWidth,window.innerHeight],total:(window.__AUDIT||[]).length,failed:(window.__AUDIT||[]).filter(function(x){return !x.ok;}).length,result:window.__OASIS?window.__OASIS.R:null})" |
    sed 's/^"//; s/"$//; s/\\"/"/g' >"$OUTDIR/$scene.summary.json"
  echo "--- AUDIT DETAIL ---"
  agent-browser eval "JSON.stringify(window.__AUDIT||[])"
  echo "--- CONSOLE ERRORS ---"
  agent-browser errors
}

run_scene() {
  local scene="$1"
  local log="$OUTDIR/$scene.log"
  : >"$log"
  {
    echo "=== scene=$scene viewport=${WIDTH}x${HEIGHT} url=$URL ==="
    agent-browser open "$URL"
    agent-browser wait 1500
    agent-browser set viewport "$WIDTH" "$HEIGHT"
    agent-browser wait 400
    agent-browser eval "$(cat scripts/e2e-audit-lib.js)"
    agent-browser eval "$(cat scripts/e2e-audit-scene-$scene.js)"
    for i in $(seq 1 200); do
      local st
      st=$(agent-browser eval "window.__AUDIT_DONE ? 'DONE' : 'WAIT'")
      if echo "$st" | grep -q DONE; then break; fi
      sleep 2
    done
    summarize "$scene"
  } >"$log" 2>&1
  echo "场景 $scene → $log"
}

# forecast 场景：9 类位置各用一局全新页面（去返程烧格规则下无法在同一局里走遍）
run_forecast() {
  local log="$OUTDIR/forecast.log"
  local parts="$OUTDIR/.forecast-parts.jsonl"
  rm -f "$parts"
  : >"$log"
  {
    echo "=== scene=forecast fresh-page-per-case url=$URL cases=${FC_CASES:-0 1 2 3 4 5 6 7 8} ==="
    for i in ${FC_CASES:-0 1 2 3 4 5 6 7 8}; do
      agent-browser open "$URL"
      agent-browser wait 1400
      agent-browser set viewport 1366 768
      agent-browser wait 300
      agent-browser eval "$(cat scripts/e2e-audit-lib.js)"
      agent-browser eval "window.__FC_CASE=$i"
      agent-browser eval "$(cat scripts/e2e-audit-scene-forecast.js)"
      for j in $(seq 1 120); do
        local st
        st=$(agent-browser eval "window.__AUDIT_DONE ? 'DONE' : 'WAIT'")
        if echo "$st" | grep -q DONE; then break; fi
        sleep 1
      done
      agent-browser eval "JSON.stringify(window.__AUDIT||[])" >>"$parts"
    done
    echo "--- AUDIT DETAIL ---"
    cat "$parts"
    echo "--- CONSOLE ERRORS ---"
    agent-browser errors
  } >"$log" 2>&1
  rm -f "$parts"
  echo "场景 forecast → $log"
}

# 多视口场景（沙尘暴按钮文案完整性等）：同一现场反复切换视口测量
run_sweep() {
  local scene="$1"
  local log="$OUTDIR/$scene.log"
  : >"$log"
  {
    echo "=== scene=$scene multi-viewport url=$URL ==="
    agent-browser open "$URL"
    agent-browser wait 1500
    agent-browser eval "$(cat scripts/e2e-audit-lib.js)"
    agent-browser eval "$(cat scripts/e2e-audit-scene-$scene.js)"
    for i in $(seq 1 120); do
      local st
      st=$(agent-browser eval "window.__SWEEP && window.__SWEEP.ready ? 'READY' : 'WAIT'")
      if echo "$st" | grep -q READY; then break; fi
      sleep 1
    done
    for combo in "${SWEEP_COMBOS[@]}"; do
      set -- $combo
      agent-browser set viewport "$2" "$3"
      agent-browser wait 450
      echo "--- viewport $1 $2x$3 @$4% ---"
      agent-browser eval "window.__SWEEP.run($2,$3,'$1',$4)"
    done
    agent-browser eval "window.__SWEEP.finish()"
    for i in $(seq 1 40); do
      local st2
      st2=$(agent-browser eval "window.__AUDIT_DONE ? 'DONE' : 'WAIT'")
      if echo "$st2" | grep -q DONE; then break; fi
      sleep 1
    done
    summarize "$scene"
  } >"$log" 2>&1
  echo "场景 $scene → $log"
}

# layout 场景：同一局游戏内切换多个视口反复测量排版
run_layout() {
  local log="$OUTDIR/layout.log"
  : >"$log"
  {
    echo "=== scene=layout multi-viewport url=$URL ==="
    agent-browser open "$URL"
    agent-browser wait 1500
    agent-browser eval "$(cat scripts/e2e-audit-lib.js)"
    agent-browser eval "$(cat scripts/e2e-audit-scene-layout.js)"
    for i in $(seq 1 60); do
      local st
      st=$(agent-browser eval "window.__LAYOUT && window.__LAYOUT.ready ? 'READY' : 'WAIT'")
      if echo "$st" | grep -q READY; then break; fi
      sleep 1
    done
    for combo in "${LAYOUT_COMBOS[@]}"; do
      set -- $combo
      agent-browser set viewport "$2" "$3"
      agent-browser wait 500
      echo "--- viewport $1 $2x$3 @$4% ---"
      agent-browser eval "window.__LAYOUT.run($2,$3,'$1',$4)"
    done
    summarize layout
  } >"$log" 2>&1
  echo "场景 layout → $log"
}

# cashforecast 场景（v0.1.3 天气预报现金计价专项）：需要告知期望单价
run_cashforecast() {
  local log="$OUTDIR/cashforecast.log"
  : >"$log"
  {
    echo "=== scene=cashforecast viewport=${WIDTH}x${HEIGHT} url=$URL expectPrice=${FC_PRICE:-200} ==="
    agent-browser open "$URL"
    agent-browser wait 1500
    agent-browser set viewport "$WIDTH" "$HEIGHT"
    agent-browser wait 400
    agent-browser eval "$(cat scripts/e2e-audit-lib.js)"
    agent-browser eval "window.__EXPECT_PRICE=${FC_PRICE:-200}"
    agent-browser eval "$(cat scripts/e2e-audit-scene-cashforecast.js)"
    for i in $(seq 1 200); do
      local st
      st=$(agent-browser eval "window.__AUDIT_DONE ? 'DONE' : 'WAIT'")
      if echo "$st" | grep -q DONE; then break; fi
      sleep 2
    done
    summarize cashforecast
  } >"$log" 2>&1
  echo "场景 cashforecast → $log"
}

if [ "$SCENE_ARG" = "layout" ]; then
  run_layout
  exit 0
fi
if [ "$SCENE_ARG" = "forecast" ]; then
  run_forecast
  exit 0
fi
if [ "$SCENE_ARG" = "fullrun" ]; then
  run_scene fullrun
  exit 0
fi
if [ "$SCENE_ARG" = "trail" ]; then
  run_scene trail
  exit 0
fi
if [ "$SCENE_ARG" = "cashforecast" ]; then
  run_cashforecast
  exit 0
fi
if [ "$SCENE_ARG" = "stormlabels" ] || [ "$SCENE_ARG" = "stormlabels2" ]; then
  run_sweep "$SCENE_ARG"
  exit 0
fi
if [ "$SCENE_ARG" != "all" ]; then
  run_scene "$SCENE_ARG"
  exit 0
fi
run_scene menu
run_scene storm
run_scene rain
run_scene oasis
run_scene oasisdry
run_scene feedback
run_forecast
run_layout
run_sweep stormlabels
run_sweep stormlabels2
