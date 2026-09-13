import { generateWorld } from '../src/game/map/generate';

// 快速价格分布扫描（不含 Bot 对局）
let min = 999, max = 0, sum = 0, n = 0, atClampMin = 0, atClampMax = 0;
for (let i = 0; i < 500; i++) {
  const map = generateWorld('dist-scan-' + i);
  for (const m of map.mines) {
    min = Math.min(min, m.gemPrice);
    max = Math.max(max, m.gemPrice);
    sum += m.gemPrice;
    n++;
    if (m.gemPrice === 80) atClampMin++;
    if (m.gemPrice === 320) atClampMax++;
  }
}
console.log('price min=' + min + ' max=' + max + ' avg=' + Math.round(sum / n) + ' at80=' + atClampMin + ' at320=' + atClampMax + ' n=' + n);
