import { useCallback, useState } from 'react';
import {
  createNewGame,
  performMove,
  performAction,
  resolvePendingEvent,
  dismissPendingResult,
  randomSeed,
} from '../game';
import type { EventChoice, ForecastView, GameAction, GameState, TileId } from '../game/types';
import RulesScreen from '../components/RulesScreen';
import RulesModal from '../components/RulesModal';
import StartScreen from '../components/StartScreen';
import TopBar from '../components/TopBar';
import MapView from '../components/MapView';
import SidePanel from '../components/SidePanel';
import EventModal, { ForecastModal } from '../components/EventModal';
import ResultModal from '../components/ResultModal';
import Settlement from '../components/Settlement';

/**
 * 页面根组件：持有唯一的 GameState。
 * v0.1.2a：首次进入必须经过规则说明页；游戏中可随时重看规则（不耗天数）。
 * v0.1.2b：关键资源变化加入统一结果弹窗（ResultModal）即时反馈，
 *          右下角日志继续保留为历史记录（同一事件两边同时记录）。
 * 所有规则都来自引擎；组件只负责调用引擎并整体替换状态。
 */
export default function GamePage() {
  const [rulesSeen, setRulesSeen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [game, setGame] = useState<GameState | null>(null);
  const [dismissedForecast, setDismissedForecast] = useState<ForecastView | null>(null);

  const startGame = useCallback((seed: string) => {
    setDismissedForecast(null);
    setGame(createNewGame(seed));
  }, []);

  const handleMove = useCallback((to: TileId) => {
    setGame((g) => (g ? performMove(g, to) : g));
  }, []);

  const handleAction = useCallback((action: GameAction) => {
    setGame((g) => (g ? performAction(g, action) : g));
  }, []);

  const handleChoice = useCallback((eventId: string, choice: EventChoice) => {
    setGame((g) => (g ? resolvePendingEvent(g, eventId, choice) : g));
  }, []);

  /** 玩家确认了一条结算反馈 */
  const dismissResult = useCallback(() => {
    setGame((g) => (g ? dismissPendingResult(g) : g));
  }, []);

  if (!rulesSeen) {
    return <RulesScreen onConfirm={() => setRulesSeen(true)} />;
  }

  if (!game) {
    return <StartScreen onStart={startGame} randomSeed={randomSeed} />;
  }

  // 即时反馈队列：一次只显示一条；必须先处理事件选择，再展示结算结果，最后才是预报
  const result = game.pendingResults[0];
  const resultModal = result ? (
    <ResultModal result={result} remaining={game.pendingResults.length - 1} onClose={dismissResult} />
  ) : null;

  if (game.status !== 'ONGOING') {
    // 失败/成功也能看到最后一次结算的原因（例如「耐力 2/5 → 0/5 · 耐力耗尽」）
    return (
      <>
        <Settlement game={game} onRestart={() => setGame(null)} />
        {resultModal}
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar game={game} onOpenRules={() => setShowRules(true)} />
      <div className="game-layout">
        <MapView game={game} onMove={handleMove} />
        <SidePanel game={game} onAction={handleAction} />
      </div>
      {game.pendingEvents.length > 0 ? (
        <EventModal game={game} onChoice={handleChoice} />
      ) : (
        <>
          {resultModal}
          {/* 结果弹窗与预报弹窗不叠在一起：先看结算结果，确认后才是天气预报 */}
          {!resultModal && game.lastForecast && game.lastForecast !== dismissedForecast && (
            <ForecastModal game={game} onClose={() => setDismissedForecast(game.lastForecast)} />
          )}
        </>
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}
