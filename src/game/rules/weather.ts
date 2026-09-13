import { GameMap, NodeId, WeatherType } from '../types';
import { gameConfig } from '../config/gameConfig';
import { nextRandom } from '../random/rng';

/**
 * 天气系统：开局按 Seed 预生成每节点 × 每天的天气表。
 * 天气只在「进入格子的当天」生效；宝库格永远安全。
 */

/** 预生成天数（覆盖 42 天 + 迷路/泥沼溢出的富余） */
export const WEATHER_TABLE_DAYS = gameConfig.maxDays + 4;

function pickWeather(terrain: string, roll: number): WeatherType {
  const dist = gameConfig.weatherProbability[terrain] ?? { SUNNY: 1 };
  let acc = 0;
  for (const [weather, p] of Object.entries(dist)) {
    acc += p;
    if (roll < acc) return weather as WeatherType;
  }
  // 浮点兜底：返回最后一个
  const keys = Object.keys(dist);
  return keys[keys.length - 1] as WeatherType;
}

export function generateWeatherTable(
  map: GameMap,
  rngState: number,
): { weather: Record<NodeId, WeatherType[]>; rngState: number } {
  const weather: Record<NodeId, WeatherType[]> = {};
  let state = rngState;
  for (const nodeId of Object.keys(map.nodes)) {
    const terrain = map.nodes[nodeId].terrain;
    const list: WeatherType[] = [];
    for (let d = 0; d < WEATHER_TABLE_DAYS; d++) {
      const [roll, next] = nextRandom(state);
      state = next;
      list.push(pickWeather(terrain, roll));
    }
    weather[nodeId] = list;
  }
  return { weather, rngState: state };
}

/** 查询某节点某天（1-based 游戏日）的天气；超出预生成范围时按晴处理 */
export function weatherForDay(
  weather: Record<NodeId, WeatherType[]>,
  nodeId: NodeId,
  day: number,
): WeatherType {
  const list = weather[nodeId];
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
