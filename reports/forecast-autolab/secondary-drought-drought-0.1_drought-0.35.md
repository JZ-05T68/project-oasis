# Secondary Numeric Scan — drought

- 每候选 250 局 × 4 Bot = 1000 局
- 控制变量：固定最终天气预报配置 packPrice=300 / chargesPerPack=3，其余全部参数不变

| 参数 | Bot | 平均绿洲经过 | 修整率% | 平均结束耐力 | 胜率% | EV |
|---|---|---:|---:|---:|---:|---:|
| oasisDroughtChance = 0.1 | ReasonablePlayerBot | 1.86 | 40.8 | 2.46 | 78.8 | 2566.86 |
| oasisDroughtChance = 0.1 | VillageWorkerBot | 1.9 | 44.4 | 2.56 | 82.4 | 2825.14 |
| oasisDroughtChance = 0.1 | AdaptiveForecastBot | 1.88 | 35.6 | 2.6 | 76.8 | 2349.55 |
| oasisDroughtChance = 0.1 | NoForecastBot | 1.86 | 43.2 | 2.52 | 77.2 | 2373.04 |
| oasisDroughtChance = 0.35 | ReasonablePlayerBot | 1.86 | 32.8 | 2.36 | 78.4 | 2562.86 |
| oasisDroughtChance = 0.35 | VillageWorkerBot | 1.89 | 36.8 | 2.42 | 80 | 2719.99 |
| oasisDroughtChance = 0.35 | AdaptiveForecastBot | 1.88 | 30 | 2.52 | 76.8 | 2347.91 |
| oasisDroughtChance = 0.35 | NoForecastBot | 1.86 | 31.6 | 2.38 | 76 | 2344.85 |
