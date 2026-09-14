#!/usr/bin/env bash
# Phase C —— 围绕 Top 候选（enc25+tent700 / enc25+storm2）聚焦微调
set -u
export PATH="/usr/bin:/bin:/mingw64/bin:/d/nodejs:$PATH"
cd /d/Games/project-oasis

RUNS=1500
WORKERS=4
OUT=reports/overnight-balance/raw
LOG=reports/overnight-balance/raw/phase-c-console.log

run_one () {
  local label="$1"; shift
  local cfg="$1"; shift
  echo "=== $(date '+%H:%M:%S') START $label cfg=$cfg" | tee -a "$LOG"
  npx tsx scripts/overnight/lab.ts --label "$label" --config "$cfg" \
    --runs "$RUNS" --workers "$WORKERS" --timeout 120 --out "$OUT" 2>&1 \
    | tr '\r' '\n' | grep -v "分片" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
}

run_one c01-enc25-tent700-storm2 '{"encounter":{"baseProbability":0.25},"tentPrice":700,"weather":{"sandstorm":{"staminaCost":2}}}'
run_one c02-enc25-tent650        '{"encounter":{"baseProbability":0.25},"tentPrice":650}'
run_one c03-enc25-tent800        '{"encounter":{"baseProbability":0.25},"tentPrice":800}'
run_one c04-enc22-tent700        '{"encounter":{"baseProbability":0.22},"tentPrice":700}'
run_one c05-enc30-tent700        '{"encounter":{"baseProbability":0.30},"tentPrice":700}'
run_one c06-enc25-tent700-fc5    '{"encounter":{"baseProbability":0.25},"tentPrice":700,"forecast":{"chargesPerPack":5}}'
run_one c07-enc25-tent700-mb150  '{"encounter":{"baseProbability":0.25},"tentPrice":700,"mineValuation":{"base":150,"clampMin":150}}'

echo "=== $(date '+%H:%M:%S') Phase C 全部完成" | tee -a "$LOG"
