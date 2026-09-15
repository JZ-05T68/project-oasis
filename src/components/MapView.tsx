import { useEffect, useRef } from 'react';
import { getLegalMoves, isTerrainKnown } from '../game';
import type { GameState, TerrainType, TileId } from '../game/types';

interface Props {
  game: GameState;
  onMove: (to: TileId) => void;
}

const TERRAIN_COLORS: Record<TerrainType, string> = {
  CITY: '#d8d2c0',
  DESERT: '#e0c068',
  GRASS: '#7cb46b',
  VILLAGE: '#c98d5a',
  OASIS: '#4fb3bf',
  MINE: '#d9a94e',
};

const TERRAIN_GLYPH: Record<TerrainType, string> = {
  CITY: '城',
  DESERT: '沙',
  GRASS: '草',
  VILLAGE: '村',
  OASIS: '泉',
  MINE: '矿',
};

const TERRAIN_NAMES: Record<TerrainType, string> = {
  CITY: '城市',
  DESERT: '沙漠',
  GRASS: '草地',
  VILLAGE: '村庄',
  OASIS: '绿洲',
  MINE: '矿区',
};

/**
 * v0.1.2：CSS Grid 格子地图。
 *
 * v0.1.2b 布局修复：地图尺寸不再有任何固定值 / 旧 10×12 遗留值。
 *
 * v0.1.4 轨迹可读性修复（Human Playtest 确认问题）：
 *  原先只有「去程 / 返程」两种边框色，且**完全靠颜色**区分，导致：
 *   1. 看不出哪些去程格在返程已经禁入；
 *   2. 色觉障碍 / 小尺寸下三种边框几乎无法分辨；
 *   3. 没有图例解释这些边框。
 *  现在的规则：
 *   - 轨迹用**角标文字**（去 / 回）+ 边框图案共同表达，不依赖颜色；
 *   - 返程阶段把「去程走过、返程不能再进」的格子标上 × 禁入角标；
 *   - 轨迹只改边框 / 角标 / 极淡的斜纹 overlay，**地形底色与地形字完全保留**。
 */
export default function MapView({ game, onMove }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { rows, cols } = game.map;
  const known = (id: TileId) => isTerrainKnown(game, id);
  const legal =
    game.status === 'ONGOING' && game.pendingEvents.length === 0
      ? new Set(getLegalMoves(game))
      : new Set<TileId>();
  const outboundSet = new Set(game.visitedOutbound);
  const returnSet = new Set(game.visitedReturn);

  /** 返程规则是否已经生效（矿区阶段就开始生效：收手那一刻起，去程足迹就是禁入区） */
  const returnRuleActive = game.phase === 'RETURN' || game.phase === 'MINING';

  /**
   * 返程禁入集合 —— 与引擎 `getLegalMoves` 的 RETURN 分支逐条对齐：
   *   去程 ∪ 返程已用普通格（城市与**当前矿区**豁免，另一个矿区禁入）。
   * 一定要和引擎一致，否则玩家会看到「标了禁入其实能走」或反之。
   */
  const forbiddenReturn = new Set<TileId>();
  if (returnRuleActive) {
    const isNormal = (id: TileId) => {
      const t = game.map.tiles[id]?.terrain;
      return t !== 'CITY' && t !== 'MINE';
    };
    for (const id of [...game.visitedOutbound, ...game.visitedReturn]) {
      if (isNormal(id)) forbiddenReturn.add(id);
    }
    forbiddenReturn.delete(game.map.cityId);
    if (game.mineEntranceId) forbiddenReturn.delete(game.mineEntranceId);
    for (const m of game.map.mines) {
      if (m.tileId !== game.mineEntranceId) forbiddenReturn.add(m.tileId);
    }
  }

  const tiles = Object.values(game.map.tiles).sort((a, b) =>
    a.row === b.row ? a.col - b.col : a.row - b.row,
  );

  /**
   * 窗口较矮时地图容器会出现内部滚动。把玩家当前格滚入可视区，
   * 保证「当前位置 + 四个可点击邻格」永远在可点范围内（可达性审计要求）。
   */
  useEffect(() => {
    const tile = scrollRef.current?.querySelector('.grid-tile.current');
    if (tile instanceof HTMLElement) {
      tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [game.position]);

  return (
    <div className="panel map-panel">
      <h3 className="panel-title">
        地图 · {game.map.rows}×{game.map.cols}（左下城市 · 右侧双矿）
      </h3>
      <div className="grid-scroll" ref={scrollRef} data-testid="map-scroll">
        <div
          className="grid-map"
          data-testid="map-grid"
          data-rows={rows}
          data-cols={cols}
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(30px, 1fr))`,
            // 宽度 = min(容器宽, (可用高度 - 安全余量) × 列数/行数)：
            // 8 行只有 7 个行间隙、9 列有 8 个列间隙，加上 padding 后行方向会多出
            // 约 0.7px；再算上容器 1px 边框，留 8px 余量即可保证整图完整可见、
            // 不触发纵向滚动条（滚动条会让地图中心偏移半个滚动条宽度）。
            width: `min(100%, calc((var(--map-max-h, 620px) - 8px) * ${cols} / ${rows}))`,
          }}
          role="grid"
          aria-label="游戏地图"
        >
          {tiles.map((t) => {
            const isKnown = known(t.id);
            const isLegal = legal.has(t.id);
            const isCurrent = game.position === t.id;
            const onOut = outboundSet.has(t.id);
            const onRet = returnSet.has(t.id);
            const locked = returnRuleActive && forbiddenReturn.has(t.id);
            const glyph = isKnown ? TERRAIN_GLYPH[t.terrain] : '?';
            const style: React.CSSProperties = {};
            if (isKnown) style.background = TERRAIN_COLORS[t.terrain];
            const mine = t.terrain === 'MINE' && t.mineSlot ? t.mineSlot : undefined;
            // 轨迹角标：去 / 回（不靠颜色也能读）
            const trail = onRet ? 'ret' : onOut ? 'out' : 'none';
            const trailBadge = onRet ? '回' : onOut ? '去' : '';
            const trailName = onRet ? '返程轨迹' : onOut ? '去程轨迹' : '';
            return (
              <button
                key={t.id}
                type="button"
                data-tileid={t.id}
                data-trail={trail}
                data-locked={locked ? '1' : '0'}
                data-current={isCurrent ? '1' : '0'}
                data-legal={isLegal ? '1' : '0'}
                className={[
                  'grid-tile',
                  isLegal ? 'clickable' : '',
                  isCurrent ? 'current' : '',
                  onOut ? 'on-out' : '',
                  onRet ? 'on-ret' : '',
                  locked ? 'locked' : '',
                  isKnown ? '' : 'unknown',
                ].join(' ')}
                style={style}
                onClick={isLegal ? () => onMove(t.id) : undefined}
                disabled={!isLegal}
                title={
                  [
                    `(${t.row},${t.col})`,
                    isKnown ? TERRAIN_NAMES[t.terrain] : '未知',
                    mine ? `Mine ${mine} · 价格返城鉴定` : '',
                    trailName,
                    locked ? '返程禁入（已走过）' : '',
                    isLegal ? '可以前往' : '',
                    isCurrent ? '当前位置' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }
              >
                {trailBadge && <span className="tile-trail-badge" aria-hidden="true">{trailBadge}</span>}
                {locked && (
                  <span className="tile-locked-badge" aria-hidden="true">
                    ×
                  </span>
                )}
                <span className="grid-glyph">{glyph}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 图例：地形 + 轨迹 + 禁入 + 当前，顺序与玩家阅读地图的顺序一致 */}
      <div className="map-legend" data-testid="map-legend">
        {(['CITY', 'DESERT', 'GRASS', 'VILLAGE', 'OASIS', 'MINE'] as TerrainType[]).map((t) => (
          <span className="legend-item" key={t}>
            <span className="legend-swatch" style={{ background: TERRAIN_COLORS[t] }} />
            {TERRAIN_NAMES[t]}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#3a3831' }} />
          未知 ?
        </span>
        <span className="legend-item">
          <span className="legend-mark legend-current">●</span>
          当前
        </span>
        <span className="legend-item">
          <span className="legend-mark legend-out">去</span>
          去程轨迹
        </span>
        <span className="legend-item">
          <span className="legend-mark legend-ret">回</span>
          返程轨迹
        </span>
        <span className="legend-item">
          <span className="legend-mark legend-locked">×</span>
          返程禁入（已走过）
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'none', border: '2px dashed #7cb46b' }} />
          当前可走
        </span>
      </div>
    </div>
  );
}
