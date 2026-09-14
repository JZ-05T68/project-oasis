#!/usr/bin/env bash
# Phase B —— 组合候选搜索（基于 Phase A 敏感性：encounter > tentPrice > sandstorm）
set -u
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis

RUNS=1500
WORKERS=4
OUT=reports/overnight-balance/raw
LOG=reports/overnight-balance/raw/phase-b-console.log

run_one () {
  local label="$1"; shift
  local cfg="$1"; shift
  echo "=== $(date '+%H:%M:%S') START $label cfg=$cfg" | tee -a "$LOG"
  npx tsx scripts/overnight/lab.ts --label "$label" --config "$cfg" \
    --runs "$RUNS" --workers "$WORKERS" --timeout 120 --out "$OUT" 2>&1 \
    | tr '\r' '\n' | grep -v "分片" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
}

run_one b01-enc25-tent600        '{"encounter":{"baseProbability":0.25},"tentPrice":600}'
run_one b02-enc25-storm2         '{"encounter":{"baseProbability":0.25},"weather":{"sandstorm":{"staminaCost":2}}}'
run_one b03-enc25-tent600-storm2 '{"encounter":{"baseProbability":0.25},"tentPrice":600,"weather":{"sandstorm":{"staminaCost":2}}}'
run_one b04-enc28-tent600        '{"encounter":{"baseProbability":0.28},"tentPrice":600}'
run_one b05-enc20-tent600        '{"encounter":{"baseProbability":0.20},"tentPrice":600}'
run_one b06-enc25-tent700        '{"encounter":{"baseProbability":0.25},"tentPrice":700}'
run_one b07-enc25-tent600-fc5    '{"encounter":{"baseProbability":0.25},"tentPrice":600,"forecast":{"chargesPerPack":5}}'
run_one b08-enc25-tent600-rain3  '{"encounter":{"baseProbability":0.25},"tentPrice":600,"weather":{"grassRain":{"staminaLossWithoutTent":3}}}'

echo "=== $(date '+%H:%M:%S') Phase B 全部完成" | tee -a "$LOG"
