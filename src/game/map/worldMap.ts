import { GameMap, MapNode, NodeId, Edge } from '../types';

/**
 * 固定手工地图 v1（36 节点 / 59 条道路）。
 *
 * 地理设计意图（详见 docs/GAME_DESIGN.md §5）：
 * - 城市在西南角，有三条出城门：南线（sg1）、中线（mg1）、北线（w0）。
 * - 南矿区：南侧 ladder 双线 + 密集村庄/绿洲，补给最足、返程选择最多、风险最低。
 * - 中央矿区：沙漠与草地混合，需注意保持西侧通路（w0/w1 或 md1/wd1 一线）。
 * - 北矿区：西北草地长链 + 少量关键沙漠，无村庄绿洲，返程路线受限，综合风险最高。
 *
 * 合法性由测试保证：城市与每个矿区入口之间，删去任意单个非端点节点后仍然连通，
 * 即必然存在两条内部普通格完全不重合的合法往返路线。
 */

function node(id: string, terrain: MapNode['terrain'], name: string, x: number, y: number): MapNode {
  return { id, terrain, name, x, y };
}

const NODE_LIST: MapNode[] = [
  node('city', 'CITY', '起始城市', 2, 8),
  // 南侧 ladder（低风险走廊）
  node('sg1', 'GRASS', '南郊草地', 4, 8),
  node('sv', 'VILLAGE', '南境市集村', 6, 8),
  node('so', 'OASIS', '南境绿洲', 8, 8),
  node('sg2', 'GRASS', '东南草地', 10, 8),
  node('mineS', 'MINE', '南矿区入口', 12, 8),
  // 中部横线
  node('mg1', 'GRASS', '西郊草地', 3, 7),
  node('md1', 'DESERT', '边缘沙漠', 5, 7),
  node('mv', 'VILLAGE', '中境市集村', 7, 7),
  node('mo', 'OASIS', '中境绿洲', 9, 7),
  node('mg2', 'GRASS', '东境草地', 11, 7),
  // 西部纵线
  node('w0', 'GRASS', '西门外草地', 2, 7),
  node('w1', 'GRASS', '西境草地', 2, 6),
  node('wd1', 'DESERT', '西境沙漠', 4, 6),
  node('wo', 'OASIS', '西境绿洲', 6, 6),
  node('wg1', 'GRASS', '中境草地', 8, 6),
  node('wg2', 'GRASS', '东北草地', 10, 6),
  // 北部第二排
  node('n0', 'GRASS', '西北草地', 2, 5),
  node('nd1', 'DESERT', '西北沙漠', 5, 5),
  node('ng1', 'GRASS', '北中草地', 7, 5),
  node('nd2', 'DESERT', '东北沙漠', 9, 5),
  node('ng2', 'GRASS', '极东草地', 11, 5),
  // 北部第三排
  node('n3', 'GRASS', '西北荒地', 2, 4),
  node('n4', 'GRASS', '北境草地', 4, 4),
  node('n5', 'GRASS', '北中草地', 6, 4),
  node('cd1', 'DESERT', '北境沙漠', 8, 4),
  node('cg1', 'GRASS', '东北高地', 10, 4),
  node('n9', 'GRASS', '极东北草地', 11, 4),
  // 顶部横线
  node('t1', 'GRASS', '西北高坡', 3, 3),
  node('t2', 'GRASS', '北境高坡', 5, 3),
  node('t3', 'GRASS', '矿外环草地', 7, 3),
  node('t4', 'GRASS', '矿东环草地', 9, 3),
  node('t5', 'GRASS', '极北草地', 11, 3),
  node('t6', 'GRASS', '矿西环草地', 6, 2),
  // 矿区入口
  node('mineC', 'MINE', '中央矿区入口', 7, 2),
  node('mineN', 'MINE', '北矿区入口', 12, 3),
];

const EDGE_LIST: Edge[] = [
  // 城市三门
  ['city', 'sg1'],
  ['city', 'mg1'],
  ['city', 'w0'],
  // 南 ladder
  ['sg1', 'sv'],
  ['sg1', 'mg1'],
  ['sv', 'so'],
  ['sv', 'mv'],
  ['so', 'sg2'],
  ['so', 'mo'],
  ['sg2', 'mineS'],
  ['sg2', 'mg2'],
  // 中部横线
  ['mg1', 'md1'],
  ['md1', 'mv'],
  ['md1', 'wd1'],
  ['mv', 'mo'],
  ['mv', 'ng1'],
  ['mv', 'wg1'],
  ['mo', 'mg2'],
  ['mg2', 'mineS'],
  ['mg2', 'wg2'],
  // 西部纵线
  ['w0', 'w1'],
  ['w1', 'wd1'],
  ['w1', 'n0'],
  ['wd1', 'wo'],
  ['wd1', 'nd1'],
  ['wo', 'wg1'],
  ['wo', 'ng1'],
  ['wg1', 'nd2'],
  ['wg1', 'cd1'],
  ['wg1', 'wg2'],
  ['wg2', 'ng2'],
  ['wg2', 'cg1'],
  // 西北 pocket
  ['n0', 'n3'],
  ['n3', 't1'],
  ['t1', 't2'],
  ['t1', 'n4'],
  ['t2', 't3'],
  ['t2', 't6'],
  ['n4', 'n5'],
  ['n4', 'nd1'],
  ['n5', 'ng1'],
  ['n5', 'cd1'],
  // 东北
  ['nd2', 'cd1'],
  ['nd2', 'cg1'],
  ['nd2', 'ng2'],
  ['cd1', 't3'],
  ['cd1', 't4'],
  ['cg1', 't4'],
  ['cg1', 'n9'],
  ['t3', 'mineC'],
  ['t3', 't4'],
  ['t3', 'ng1'],
  ['t6', 'mineC'],
  ['t4', 't5'],
  ['t5', 'mineN'],
  ['t5', 'n9'],
  ['n9', 'mineN'],
  ['n9', 'ng2'],
];

function buildAdjacency(nodes: Record<string, MapNode>, edges: Edge[]): Record<NodeId, NodeId[]> {
  const adj: Record<NodeId, NodeId[]> = {};
  for (const id of Object.keys(nodes)) adj[id] = [];
  for (const [a, b] of edges) {
    if (!nodes[a] || !nodes[b]) {
      throw new Error(`地图边引用了不存在的节点: ${a}-${b}`);
    }
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

export function buildMap(nodes: MapNode[], edges: Edge[]): GameMap {
  const nodeMap: Record<string, MapNode> = {};
  for (const n of nodes) {
    if (nodeMap[n.id]) throw new Error(`地图节点 id 重复: ${n.id}`);
    nodeMap[n.id] = n;
  }
  return {
    nodes: nodeMap,
    edges,
    adjacency: buildAdjacency(nodeMap, edges),
    cityId: nodes.find((n) => n.terrain === 'CITY')!.id,
    mineIds: nodes.filter((n) => n.terrain === 'MINE').map((n) => n.id),
  };
}

export const worldMap: GameMap = buildMap(NODE_LIST, EDGE_LIST);
