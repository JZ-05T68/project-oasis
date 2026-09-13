import { generateWorld } from './src/game/map/generate';
const glyph: Record<string, string> = { CITY: '城', DESERT: '沙', GRASS: '草', VILLAGE: '村', OASIS: '泉', MINE: '矿' };
for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
  const m = generateWorld(seed);
  console.log(`\n=== seed=${seed} ===`);
  for (let r = 0; r < m.rows; r++) {
    let line = '';
    for (let c = 0; c < m.cols; c++) line += glyph[m.tiles[`${r}:${c}`].terrain];
    console.log(line);
  }
  console.log(m.mines.map((x) => `Mine ${x.slot} (${x.row},${x.col}) ¥${x.gemPrice} score=${x.difficultyScore} risk=${x.estimatedRisk}★ detail=${JSON.stringify(x.detail)}`).join('\n'));
}
