# Secondary Numeric Scan — workpay

- 每候选 250 局 × 4 Bot = 1000 局
- 控制变量：固定最终天气预报配置 packPrice=300 / chargesPerPack=3，其余全部参数不变

| workPay | Bot | 打工局占比% | 平均打工天数 | 打工收入均值 | 平均采矿天数 | 胜率% | EV |
|---:|---|---:|---:|---:|---:|---:|---:|
| workPay = 500 | ReasonablePlayerBot | 0 | 0 | 0 | 12.52 | 78.4 | 2553.5 |
| workPay = 500 | VillageWorkerBot | 23.2 | 0.29 | 144 | 12.3 | 81.2 | 2759.45 |
| workPay = 500 | AdaptiveForecastBot | 0 | 0 | 0 | 12.4 | 76.8 | 2352.05 |
| workPay = 500 | NoForecastBot | 0 | 0 | 0 | 12.2 | 77.6 | 2400.9 |
