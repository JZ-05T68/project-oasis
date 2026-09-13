import type { TileId, WeatherType } from '../types';

/** 预生成天数（覆盖 maxDays + 迷路/泥沼溢出的富余） */
export const WEATHER_TABLE_DAYS = 46;

/** 查询某格子某天（1-based 游戏日）的天气；超出预生成范围时按晴处理 */
export function weatherForDay(
  weather: Record<TileId, WeatherType[]>,
  tileId: TileId,
  day: number,
): WeatherType {
  const list = weather[tileId];
  if (!list || day < 1 || day > list.length) return 'SUNNY';
  return list[day - 1];
}

export const weatherNames: Record<WeatherType, string> = {
  SUNNY: '晴',
  CLOUDY: '阴',
  HEAT: '高温',
  SANDSTORM: '沙尘暴',
  RAINSTORM: '暴雨',
  MUD: '泥沼',
};
