import { getLegalMoves, isTerrainKnown } from '../game';
import type { GameState, NodeId, TerrainType } from '../game/types';

interface Props {
  game: GameState;
  onMove: (to: NodeId) => void;
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

const SCALE = 62;
const PAD = 46;

function nodePos(game: GameState, id: NodeId): { cx: number; cy: number } {
  const n = game.map.nodes[id];
  return { cx: PAD + n.x * SCALE, cy: PAD + n.y * SCALE };
}

/** 判断边 a-b 是否属于给定路线（相邻先后出现） */
function isRouteEdge(route: NodeId[], a: NodeId, b: NodeId): boolean {
  for (let i = 0; i < route.length - 1; i++) {
    if ((route[i] === a && route[i + 1] === b) || (route[i] === b && route[i + 1] === a)) {
      return true;
    }
  }
  return false;
}

export default function MapView({ game, onMove }: Props) {
  const known = (id: NodeId) => isTerrainKnown(game, id);
  const legal =
    game.status === 'ONGOING' && game.pendingEvents.length === 0
      ? new Set(getLegalMoves(game))
      : new Set<NodeId>();
  const outboundSet = new Set(game.visitedOutbound);
  const returnSet = new Set(game.visitedReturn);

  const bounds = Object.values(game.map.nodes).reduce(
    (acc, n) => ({
      maxX: Math.max(acc.maxX, n.x),
      maxY: Math.max(acc.maxY, n.y),
    }),
    { maxX: 0, maxY: 0 },
  );
  const width = PAD * 2 + bounds.maxX * SCALE;
  const height = PAD * 2 + bounds.maxY * SCALE;

  return (
    <div className="panel map-panel">
      <h3 className="panel-title">地图 · 道路网</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="游戏地图">
        {/* 道路（始终可见） */}
        {game.map.edges.map(([a, b], i) => {
          const pa = nodePos(game, a);
          const pb = nodePos(game, b);
          const onOut = isRouteEdge(game.visitedOutbound, a, b);
          const onRet = isRouteEdge(game.visitedReturn, a, b);
          return (
            <line
              key={i}
              x1={pa.cx}
              y1={pa.cy}
              x2={pb.cx}
              y2={pb.cy}
              stroke={onOut ? '#d9a94e' : onRet ? '#5d9dd8' : '#4a4232'}
              strokeWidth={onOut || onRet ? 3.4 : 1.6}
              strokeDasharray={onRet ? '7 4' : undefined}
              opacity={onOut || onRet ? 0.95 : 0.55}
            />
          );
        })}

        {/* 节点 */}
        {Object.values(game.map.nodes).map((n) => {
          const { cx, cy } = nodePos(game, n.id);
          const isKnown = known(n.id);
          const isLegal = legal.has(n.id);
          const isCurrent = game.position === n.id;
          const fill = isKnown ? TERRAIN_COLORS[n.terrain] : '#6b6355';
          const glyph = isKnown ? TERRAIN_GLYPH[n.terrain] : '?';
          const onOutbound = outboundSet.has(n.id);
          const onReturn = returnSet.has(n.id);
          return (
            <g
              key={n.id}
              className={`map-node ${isLegal ? 'clickable' : ''}`}
              onClick={isLegal ? () => onMove(n.id) : undefined}
            >
              {isLegal && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={21}
                  fill="none"
                  stroke="#7cb46b"
                  strokeWidth={2.4}
                  strokeDasharray="4 3"
                />
              )}
              {isCurrent && (
                <circle cx={cx} cy={cy} r={23} fill="none" stroke="#fff" strokeWidth={2.2} opacity={0.9} />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={16}
                fill={fill}
                stroke={onOutbound ? '#d9a94e' : onReturn ? '#5d9dd8' : '#141b18'}
                strokeWidth={onOutbound || onReturn ? 3 : 1.4}
                strokeDasharray={isKnown ? undefined : '3 2'}
                opacity={isKnown ? 1 : 0.72}
              />
              <text
                x={cx}
                y={cy + 4.5}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fill={isKnown ? '#141b18' : '#d8d2c0'}
                pointerEvents="none"
              >
                {glyph}
              </text>
              <text
                x={cx}
                y={cy + 34}
                textAnchor="middle"
                fontSize={11}
                fill={isKnown ? '#a89c82' : '#6b6355'}
                pointerEvents="none"
              >
                {isKnown ? n.name : '???'}
              </text>
            </g>
          );
        })}
      </svg>
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
