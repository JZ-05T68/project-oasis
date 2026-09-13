import RulesContent from './RulesContent';

/**
 * 开局规则说明页（v0.1.2a）：
 * 玩家必须阅读完整规则并点击确认按钮后才能进入游戏。
 */
export default function RulesScreen({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="app-shell">
      <div className="start-screen">
        <h1>绿洲计划 · 远征规则</h1>
        <p className="subtitle">PROJECT OASIS · Random Expedition · v0.1.2a</p>
        <div className="start-card rules-card">
          <RulesContent />
          <button className="btn gold block" onClick={onConfirm} style={{ marginTop: 16 }}>
            我已阅读规则，开始远征
          </button>
        </div>
      </div>
    </div>
  );
}
