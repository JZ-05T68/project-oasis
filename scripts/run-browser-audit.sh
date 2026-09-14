#!/bin/bash
# Project Oasis — 浏览器逐项点击审计 runner（v0.1.2b）。
#
# 用法：bash scripts/run-browser-audit.sh [scene] [width] [height]
#   scene: menu | tents（默认两个都跑）
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
    agent-browser eval "JSON.stringify({viewport:[window.innerWidth,window.innerHeight],total:(window.__AUDIT||[]).length,failed:(window.__AUDIT||[]).filter(function(x){return !x.ok;}).length,result:window.__OASIS?window.__OASIS.R:null})" |
      sed 's/^"//; s/"$//; s/\\"/"/g' >"$OUTDIR/$scene.summary.json"
    echo "--- AUDIT DETAIL ---"
    agent-browser eval "JSON.stringify(window.__AUDIT||[])"
    echo "--- CONSOLE ERRORS ---"
    agent-browser errors
  } >"$log" 2>&1
  echo "场景 $scene → $log"
}

if [ "$SCENE_ARG" != "all" ]; then
  run_scene "$SCENE_ARG"
  exit 0
fi
run_scene menu
run_scene storm
run_scene rain
run_scene oasis
run_scene oasisdry
