import { readFileSync } from 'node:fs';
import { balanceScore } from './score';
import type { BotSummary } from '../../src/simulation/metrics';

const j = JSON.parse(readFileSync('reports/overnight-balance/raw/base-01.json', 'utf-8'));
const s = balanceScore(j.summaries as BotSummary[], 2000);
const r = (j.summaries as BotSummary[]).find((x) => x.bot === 'ReasonablePlayerBot')!;
console.log('median', r.finalAssetsWins.median, 'ratio', r.finalAssetsWins.median / 2000);
console.log('score', s.total, s.notes);
