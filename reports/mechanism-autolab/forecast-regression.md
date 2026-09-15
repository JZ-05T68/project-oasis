# Forecast 回归检查（正式机制落盘后）

- 样本：2500 局 / Bot × 5 Bot，shared seed（prefix `mechlab`）
- 生效覆盖：`{}`
- 结论：**300 / 3 仍然健康，不需要重新标定**

| 检查 | 内容 | 结果 | 实测 |
|---|---|:--:|---|
| FC1 | Adaptive 购买率 ≥ 15% | ✅ | 23.6% |
| FC2 | Adaptive 购买率 ≤ 80% | ✅ | 23.6% |
| FC3 | Forecast ΔEV > -5% | ✅ | -1.42% |
| FC4 | ForecastAbuser 不是最高 EV 策略 | ✅ | abuser EV=1272.12 |
| FC5 | Forecast Score ≥ 70 | ✅ | 79.91 |

## Forecast Score 明细

- 总分 **79.91**（noFc=18.06 div=10.49 evBal=20 decUtil=6.36 packUse=15 dmgEff=10 abuse=-0 domOpen=-0）

## 预报梯度明细

| Bot | 胜率% | EV | 购买率% | 平均包数 | 套餐使用率% | 有效预报率% | 花费 |
|---|---:|---:|---:|---:|---:|---:|---:|
| NoForecastBot | 71.24 | 2024.53 | 0 | 0 | 0 | 0 | 0 |
| LightForecastBot | 71.32 | 2009.57 | 17.2 | 0.17 | 94.42 | 15.52 | 51.6 |
| AdaptiveForecastBot | 71.52 | 1995.72 | 23.6 | 0.29 | 96.1 | 19.07 | 87.24 |
| HeavyForecastBot | 67.64 | 1740.55 | 100 | 1 | 100 | 27.97 | 300 |
| ForecastAbuserBot | 61.8 | 1272.12 | 100 | 1.99 | 100 | 21.8 | 597.72 |

