import { ModalShell } from './EventModal';
import RulesContent from './RulesContent';

/**
 * 游戏内规则查看 Modal：随时可打开，不消耗游戏天数。
 */
export default function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell title="远征规则（随时可查看，不消耗天数）" onClose={onClose} wide>
      <RulesContent />
    </ModalShell>
  );
}
