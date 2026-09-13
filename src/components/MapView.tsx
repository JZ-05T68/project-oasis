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

/** v0.1.2：CSS Grid 格子地图 */
export default function MapView({ game, onMove }: Props) {
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

  return (
    <div className="panel map-panel">
      <h3 className="panel-title">
        地图 · {game.map.rows}×{game.map.cols}（左下城市 · 右侧双矿）
      </h3>
      <div className="grid-scroll">
        <div
          className="grid-map"
          style={{ gridTemplateColumns: `repeat(${game.map.cols}, minmax(34px, 1fr))` }}
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
