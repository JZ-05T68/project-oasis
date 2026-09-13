import { useCallback, useState } from 'react';
import {
  createNewGame,
  performMove,
  performAction,
  resolvePendingEvent,
  randomSeed,
} from '../game';
import type { EventChoice, ForecastView, GameAction, GameState, NodeId } from '../game/types';
import StartScreen from '../components/StartScreen';
import TopBar from '../components/TopBar';
import MapView from '../components/MapView';
import SidePanel from '../components/SidePanel';
import EventModal, { ForecastModal } from '../components/EventModal';
import Settlement from '../components/Settlement';

/**
 * 页面根组件：持有唯一的 GameState。
 * 所有规则都来自引擎；组件只负责调用引擎并整体替换状态。
 */
export default function GamePage() {
  const [game, setGame] = useState<GameState | null>(null);
  const [dismissedForecast, setDismissedForecast] = useState<ForecastView | null>(null);

  const startGame = useCallback((seed: string) => {
    setDismissedForecast(null);
    setGame(createNewGame(seed));
  }, []);

  const handleMove = useCallback((to: NodeId) => {
    setGame((g) => (g ? performMove(g, to) : g));
  }, []);

  const handleAction = useCallback((action: GameAction) => {
    setGame((g) => (g ? performAction(g, action) : g));
  }, []);

  const handleChoice = useCallback((eventId: string, choice: EventChoice) => {
    setGame((g) => (g ? resolvePendingEvent(g, eventId, choice) : g));
  }, []);

  if (!game) {
    return <StartScreen onStart={startGame} randomSeed={randomSeed} />;
  }

  if (game.status !== 'ONGOING') {
    return <Settlement game={game} onRestart={() => setGame(null)} />;
  }

  return (
    <div className="app-shell">
      <TopBar game={game} />
      <div className="game-layout">
        <MapView game={game} onMove={handleMove} />
        <SidePanel
          game={game}
          onAction={handleAction}
        />
      </div>
      {game.pendingEvents.length > 0 && (
        <EventModal game={game} onChoice={handleChoice} />
      )}
      {game.pendingEvents.length === 0 && game.lastForecast && game.lastForecast !== dismissedForecast && (
        <ForecastModal
          game={game}
          onClose={() => setDismissedForecast(game.lastForecast)}
        />
      )}
    </div>
  );
}
