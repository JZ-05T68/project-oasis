#!/usr/bin/env bash
# Phase D —— 最终大样本验证（同尺度对比 22:00 基线 vs 06:00 最终配置）
set -u
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis

RUNS=6000
WORKERS=4
OUT=reports/overnight-balance/raw
LOG=reports/overnight-balance/raw/phase-d-console.log

run_one () {
  local label="$1"; shift
  local cfg="$1"; shift
  echo "=== $(date '+%H:%M:%S') START $label cfg=$cfg" | tee -a "$LOG"
  npx tsx scripts/overnight/lab.ts --label "$label" --config "$cfg" \
    --runs "$RUNS" --workers "$WORKERS" --timeout 120 --out "$OUT" 2>&1 \
    | tr '\r' '\n' | grep -v "分片" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
}

# 1) 22:00 基线配置（用覆盖还原旧值，与最终配置同尺度对比）
run_one d01-baseline-6k '{"tentPrice":400,"encounter":{"baseProbability":0.35},"forecast":{"chargesPerPack":3}}'
# 2) 06:00 最终配置（= 当前 gameConfig，空覆盖）
run_one d02-final-6k '{}'

echo "=== $(date '+%H:%M:%S') Phase D 全部完成" | tee -a "$LOG"
