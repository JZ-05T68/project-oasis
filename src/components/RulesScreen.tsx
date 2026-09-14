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
        <p className="subtitle">PROJECT OASIS · Random Expedition · v0.1.2b</p>
        {/* 规则正文独立滚动，确认按钮固定在滚动区之外——否则矮窗口下按钮会被裁剪 */}
        <div className="start-card rules-card">
          <div className="rules-scroll">
            <RulesContent />
          </div>
          <div className="rules-actions">
            <button type="button" className="btn gold block" onClick={onConfirm}>
              我已阅读规则，开始远征
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
