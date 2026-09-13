/**
 * Project Oasis 引擎公开入口。
 * UI 层只允许从这里导入引擎能力。
 */
export {
  createNewGame,
  getLegalMoves,
  hasLegalReturnPath,
  performMove,
  getAvailableActions,
  performAction,
  resolvePendingEvent,
  computeSettlement,
  getWeatherForDay,
  getCurrentWeather,
  getTerrainName,
  isTerrainKnown,
  getRouteSummary,
  buildForecastView,
} from './engine/engine';
export { starLabel } from './rules/routeScore';
export { weatherNames } from './rules/weather';
export { tentLabel } from './rules/equipment';
export { generateWorld } from './map/generate';
export { tileIdOf, parseTileId, gridNeighbors, manhattan } from './map/grid';
export { gameConfig } from './config/gameConfig';
export { randomSeed } from './random/rng';
export * from './types';
