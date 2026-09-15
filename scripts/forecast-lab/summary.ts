/** 打印指定 tag 的配对对比与关键遥测（用于最终候选决策）。 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tags = (process.argv[2] ?? 'b1,c1,d1').split(',');
const rows: Array<Record<string, unknown>> = [];
for (const t of tags) {
  const f = resolve(`reports/forecast-autolab/raw/sweep-${t}.jsonl`);
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
}
type S = {
  bot: string;
  winRate: number;
  evNetProfitAllRuns: number;
  avgEndStamina: number;
  avgWeatherHits: number;
  avgTentUses: number;
  avgCompassUses: number;
  forecast: Record<string, number>;
};
for (const r of rows) {
  const p = r.params as { packPrice: number; chargesPerPack: number; autoUseOnPurchase: number };
  const su = (r.summaries as S[]) || [];
  const m: Record<string, S> = Object.fromEntries(su.map((s) => [s.bot, s]));
  const ada = m['AdaptiveForecastBot'];
  const none = m['NoForecastBot'];
  const paired = (r.paired ?? {}) as Record<string, { wins: number; losses: number; ties: number; avgDelta: number; n: number }>;
  const pa = paired['AdaptiveForecastBot'];
  const tag = su.length ? '' : '??';
  console.log(
    `${String(p.packPrice).padStart(4)}/${p.chargesPerPack}/auto${p.autoUseOnPurchase} runs=${String(r.runs).padStart(5)} | score=${String((r.score as { total: number }).total).padStart(6)} | buy=${String(ada.forecast.purchaseRate).padStart(6)} packs=${ada.forecast.avgPacks} spent=${String(ada.forecast.avgMoneySpent).padStart(6)} use=${ada.forecast.packUsageRate} decU=${ada.forecast.decisionUtilityRate} | dmg/100=${ada.forecast.damageReductionPer100} | noFc WR=${none.winRate} EV=${none.evNetProfitAllRuns} | ada WR=${ada.winRate} EV=${ada.evNetProfitAllRuns} | paired ${pa ? `${pa.wins}W/${pa.losses}L/${pa.ties}T Δ${pa.avgDelta}` : '-'} ${tag}`,
  );
}
