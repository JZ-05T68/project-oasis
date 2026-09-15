# Secondary Numeric Scan — thief

- 每候选 250 局 × 4 Bot = 1000 局
- 控制变量：固定最终天气预报配置 packPrice=300 / chargesPerPack=3，其余全部参数不变

| 参数 | Bot | 盗贼次数/千局 | 市集次数/千局 | 盗贼现金均值 | 平均村庄经过 | 胜率% | EV |
|---|---|---:|---:|---:|---:|---:|---:|
| encounter.villageThiefRatio = 0.3 | ReasonablePlayerBot | 328 | 624 | -63.66 | 3.76 | 80 | 2667.45 |
| encounter.villageThiefRatio = 0.3 | VillageWorkerBot | 312 | 636 | -81.79 | 3.58 | 82 | 2842.06 |
| encounter.villageThiefRatio = 0.3 | AdaptiveForecastBot | 280 | 644 | -67.43 | 4.01 | 77.2 | 2389.38 |
| encounter.villageThiefRatio = 0.3 | NoForecastBot | 260 | 680 | -48.92 | 3.92 | 79.2 | 2536.98 |
| encounter.villageThiefRatio = 0.7 | ReasonablePlayerBot | 680 | 272 | -75.88 | 3.73 | 76.4 | 2422.23 |
| encounter.villageThiefRatio = 0.7 | VillageWorkerBot | 672 | 280 | -74.05 | 3.58 | 81.2 | 2732.31 |
| encounter.villageThiefRatio = 0.7 | AdaptiveForecastBot | 636 | 296 | -59.37 | 3.98 | 75.6 | 2245.21 |
| encounter.villageThiefRatio = 0.7 | NoForecastBot | 656 | 284 | -64.76 | 3.93 | 77.2 | 2342.58 |
