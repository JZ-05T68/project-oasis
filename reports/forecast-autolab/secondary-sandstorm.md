# Secondary Numeric Scan — sandstorm

- 每候选 250 局 × 4 Bot = 1000 局
- 控制变量：固定最终天气预报配置 packPrice=300 / chargesPerPack=3，其余全部参数不变

| 参数 | Bot | 胜率% | EV | 耐力死亡占比% | 平均买帐篷 | 平均天气伤害次数 | 平均结束耐力 | CV 胜率% |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| weather.sandstorm.staminaCost = 1 | ReasonablePlayerBot | 78.4 | 2553.5 | 21.6 | 2.41 | 2.17 | 2.42 | — |
| weather.sandstorm.staminaCost = 1 | VillageWorkerBot | 81.2 | 2759.45 | 18.4 | 2.56 | 2.29 | 2.49 | — |
| weather.sandstorm.staminaCost = 1 | AdaptiveForecastBot | 76.8 | 2352.05 | 22.8 | 2.28 | 2.05 | 2.58 | — |
| weather.sandstorm.staminaCost = 1 | NoForecastBot | 77.6 | 2400.9 | 22.4 | 2.49 | 2.24 | 2.44 | — |
| weather.sandstorm.staminaCost = 2 | ReasonablePlayerBot | 70 | 2079.1 | 30 | 2.37 | 2.1 | 2.2 | — |
| weather.sandstorm.staminaCost = 2 | VillageWorkerBot | 70.4 | 2191.42 | 29.2 | 2.52 | 2.22 | 2.19 | — |
| weather.sandstorm.staminaCost = 2 | AdaptiveForecastBot | 71.2 | 2035.32 | 28.4 | 2.28 | 1.98 | 2.41 | — |
| weather.sandstorm.staminaCost = 2 | NoForecastBot | 71.6 | 2079.8 | 28.4 | 2.46 | 2.18 | 2.24 | — |
