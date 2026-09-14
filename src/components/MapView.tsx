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
 *  - 列数、行数全部从 gameConfig.map 派生（game.map.rows / game.map.cols）；
 *  - 格子用 aspect-ratio 1/1 保持接近正方形；
 *  - 地图宽度 = min(容器宽度, 可用高度 × 列数 / 行数)，因此整张地图永远完整可见，
 *    并在自己的主游戏区域内水平居中（右侧日志宽度变化不会牵动地图中心）；
 *  - 原来 min-width:420px（12 列 × 34px 的硬编码）是左侧留白/偏移的根因，已彻底移除。
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
            const glyph = isKnown ? TERRAIN_GLYPH[t.terrain] : '?';
            const style: React.CSSProperties = {};
            if (isKnown) style.background = TERRAIN_COLORS[t.terrain];
            const mine = t.terrain === 'MINE' && t.mineSlot ? t.mineSlot : undefined;
            return (
              <button
                key={t.id}
                type="button"
                data-tileid={t.id}
                className={[
                  'grid-tile',
                  isLegal ? 'clickable' : '',
                  isCurrent ? 'current' : '',
                  onOut ? 'on-out' : '',
                  onRet ? 'on-ret' : '',
                  isKnown ? '' : 'unknown',
                ].join(' ')}
                style={style}
                onClick={isLegal ? () => onMove(t.id) : undefined}
                disabled={!isLegal}
                title={
                  isKnown
                    ? `(${t.row},${t.col}) ${TERRAIN_NAMES[t.terrain]}${mine ? ` Mine ${mine} · 价格返城鉴定` : ''}`
                    : `(${t.row},${t.col}) 未知`
                }
              >
                <span className="grid-glyph">{glyph}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="map-legend">
        {(['CITY', 'DESERT', 'GRASS', 'VILLAGE', 'OASIS', 'MINE'] as TerrainType[]).map((t) => (
          <span className="legend-item" key={t}>
            <span className="legend-swatch" style={{ background: TERRAIN_COLORS[t] }} />
            {TERRAIN_NAMES[t]}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: '#6b6355' }} />未知 ?
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'none', border: '2px dashed #7cb46b' }} />可前往
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'none', border: '2px solid #d9a94e' }} />去程足迹
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'none', border: '2px dashed #5d9dd8' }} />返程足迹
        </span>
      </div>
    </div>
  );
}
