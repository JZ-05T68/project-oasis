#!/usr/bin/env bash
# Phase A —— 单变量敏感性扫描（无人值守，workers=4，分片看门狗 120s）
set -u
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis

RUNS=1000
WORKERS=4
OUT=reports/overnight-balance/raw
LOG=reports/overnight-balance/raw/phase-a-console.log

run_one () {
  local label="$1"; shift
  local cfg="$1"; shift
  echo "=== $(date '+%H:%M:%S') START $label cfg=$cfg" | tee -a "$LOG"
  npx tsx scripts/overnight/lab.ts --label "$label" --config "$cfg" \
    --runs "$RUNS" --workers "$WORKERS" --timeout 120 --out "$OUT" 2>&1 \
    | tr '\r' '\n' | grep -v "分片$" | tail -12 | tee -a "$LOG"
  echo "" | tee -a "$LOG"
}

run_one a01-startCash-1800      '{"startCash":1800}'
run_one a02-startCash-1600      '{"startCash":1600}'
run_one a03-tentPrice-600       '{"tentPrice":600}'
run_one a04-encounter-0.25      '{"encounter":{"baseProbability":0.25}}'
run_one a05-grassRain-1         '{"weather":{"grassRain":{"staminaLossWithoutTent":1}}}'
run_one a06-maxStamina-4        '{"maxStamina":4,"startStamina":4}'
run_one a07-mineBase-110        '{"mineValuation":{"base":110,"clampMin":110}}'
run_one a08-sandstorm-2         '{"weather":{"sandstorm":{"staminaCost":2}}}'

echo "=== $(date '+%H:%M:%S') Phase A 全部完成" | tee -a "$LOG"
