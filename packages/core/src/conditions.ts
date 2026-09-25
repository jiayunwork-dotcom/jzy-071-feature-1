/**
 * 把用几何位置描述的约束/载荷映射到当前网格自由度。
 * 重新剖分网格后只需重新映射，用户不必重新点选。
 */
import type {
  BodyLoad,
  FemModel,
  Mesh,
  NodalLoad,
  Region,
  Support,
  SupportType,
  TractionLoad,
  Vec2,
} from './types.js';
import { createCst } from './element.js';

/** 节点全局自由度编号：节点 i → (2i, 2i+1) */
export function dofOf(node: number): [number, number] {
  return [2 * node, 2 * node + 1];
}

function pointInRegion(p: Vec2, r: Region, tol: number): boolean {
  switch (r.kind) {
    case 'point':
      return Math.hypot(p.x - r.x, p.y - r.y) <= tol;
    case 'box':
      return p.x >= r.xmin - tol && p.x <= r.xmax + tol && p.y >= r.ymin - tol && p.y <= r.ymax + tol;
    case 'line':
      return distancePointSegment(p, { x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }) <= tol;
  }
}

/** region 命中的全部节点；point 区域只吸附距离最近的单个节点 */
function selectNodes(mesh: Mesh, r: Region, tol: number): number[] {
  if (r.kind === 'point') {
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < mesh.nodes.length; i++) {
      const d = Math.hypot(mesh.nodes[i].x - r.x, mesh.nodes[i].y - r.y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? [best] : [];
  }
  const hits: number[] = [];
  for (let i = 0; i < mesh.nodes.length; i++) {
    if (pointInRegion(mesh.nodes[i], r, tol)) hits.push(i);
  }
  return hits;
}

function distancePointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 解析约束为被固定的自由度集合（返回每个自由度固定到的值，这里为 0） */
export function resolveSupports(
  mesh: Mesh,
  supports: Support[],
  snapTol: number,
): Map<number, number> {
  const prescribed = new Map<number, number>();
  for (const s of supports) {
    const val = s.value ?? 0;
    for (const i of selectNodes(mesh, s.region, snapTol)) {
      const [dofX, dofY] = dofOf(i);
      if (constrainsX(s.type)) prescribed.set(dofX, val);
      if (constrainsY(s.type)) prescribed.set(dofY, val);
    }
  }
  return prescribed;
}

function constrainsX(type: SupportType): boolean {
  return type === 'fixed' || type === 'slideX';
}
function constrainsY(type: SupportType): boolean {
  return type === 'fixed' || type === 'slideY';
}

/**
 * 组装外力向量 F：
 * - 节点集中力：region 内所有节点按给定分量施加（若为线段/框区域，自动按节点数平均）；
 * - 分布面力：找与 region 线段重合的边界边，按 (t·L/2) 凝聚到两端；
 * - 体力：按单元 t·A/3 分配。
 */
export function assembleLoads(model: FemModel, snapTol: number): Float64Array {
  const { mesh, nodalLoads, tractionLoads, bodyLoad, material } = model;
  const ndof = mesh.nodes.length * 2;
  const F = new Float64Array(ndof);
  const thickness = material.thickness;

  for (const load of nodalLoads) {
    const hits = selectNodes(mesh, load.region, snapTol);
    if (hits.length === 0) continue;
    // point 区域通常唯一命中；line/box 区域平均分配，保证合力不变
    const share = 1 / hits.length;
    for (const n of hits) {
      F[2 * n] += load.fx * share;
      F[2 * n + 1] += load.fy * share;
    }
  }

  for (const tr of tractionLoads) {
    applyTraction(mesh, tr, thickness, F);
  }

  if (bodyLoad && (bodyLoad.fx !== 0 || bodyLoad.fy !== 0)) {
    for (const tri of mesh.elements) {
      const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
      const qx = (thickness * elem.area * bodyLoad.fx) / 3;
      const qy = (thickness * elem.area * bodyLoad.fy) / 3;
      for (const n of tri) {
        F[2 * n] += qx;
        F[2 * n + 1] += qy;
      }
    }
  }

  return F;
}

/** 将线段分布面力凝聚到与之重合的边界边端点 */
function applyTraction(
  mesh: Mesh,
  tr: TractionLoad,
  thickness: number,
  F: Float64Array,
): void {
  if (tr.region.kind === 'point' || tr.region.kind === 'box') return; // 面力只对线段有意义
  const a = { x: tr.region.x1, y: tr.region.y1 };
  const b = { x: tr.region.x2, y: tr.region.y2 };
  const rex = b.x - a.x, rey = b.y - a.y;
  const rLen = Math.hypot(rex, rey);
  if (rLen === 0) return;
  const rnX = rex / rLen, rnY = rey / rLen;
  // 距离容差取包围盒的 1e-3（对边界边上额外插入点的情形也稳健；
  // 真正的匹配由「平行 + 端点投影在线段范围内」两道条件保证）
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const p of mesh.nodes) {
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  const distTol = Math.max(xmax - xmin, ymax - ymin) * 1e-3;

  for (const [n1, n2] of mesh.boundaryEdges) {
    const p1 = mesh.nodes[n1], p2 = mesh.nodes[n2];
    const elx = p2.x - p1.x, ely = p2.y - p1.y;
    const eLen = Math.hypot(elx, ely);
    // 1) 方向必须近似平行（共线），过滤掉垂直相交的边
    const parallel = Math.abs((elx * rnX + ely * rnY) / eLen);
    if (parallel < 0.85) continue;
    // 2) 两个端点都要投影在载荷线段的参数范围 [0,1] 内，且到线段距离 < tol
    const checks = [p1, p2].map((p) => {
      const t = ((p.x - a.x) * rex + (p.y - a.y) * rey) / (rLen * rLen);
      const projX = a.x + t * rex, projY = a.y + t * rey;
      const d = Math.hypot(p.x - projX, p.y - projY);
      return t >= -0.35 && t <= 1.35 && d < distTol;
    });
    if (!checks[0] || !checks[1]) continue;
    // 面力方向以用户定义的载荷线段方向为准（不依赖网格边的存储顺序，
    // 因为边界边由 findBoundaryEdges 规范化为无向边，方向不保证）
    const qx = (thickness * eLen * tr.tx) / 2;
    const qy = (thickness * eLen * tr.ty) / 2;
    F[2 * n1] += qx;
    F[2 * n1 + 1] += qy;
    F[2 * n2] += qx;
    F[2 * n2 + 1] += qy;
  }
}
