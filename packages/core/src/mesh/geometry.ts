/** 多边形 / 点-边几何工具 */
import type { Polygon, Vec2 } from '../types.js';

export function v(x: number, y: number): Vec2 {
  return { x, y };
}

/** 有向面积（逆时针为正），二阶 Shoelace 公式 */
export function signedArea(loop: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 保证外轮廓逆时针、孔顺时针（cdt2d 对方向不敏感，但便于校验与渲染） */
export function orientPolygon(poly: Polygon): Polygon {
  const outer = signedArea(poly.outer) < 0 ? [...poly.outer].reverse() : poly.outer;
  const holes = poly.holes.map((h) => (signedArea(h) > 0 ? [...h].reverse() : h));
  return { outer, holes };
}

/** 射线法判断点是否在闭合环内 */
export function pointInLoop(p: Vec2, loop: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const pi = loop[i], pj = loop[j];
    const intersect =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 点是否位于分析区域内（外轮廓内且不在任何孔内） */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  if (!pointInLoop(p, poly.outer)) return false;
  for (const h of poly.holes) {
    if (pointInLoop(p, h)) return false;
  }
  return true;
}

/** 点到线段的距离 */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 点到任意闭合环边界的最短距离 */
export function distanceToLoop(p: Vec2, loop: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < loop.length; i++) {
    d = Math.min(d, distanceToSegment(p, loop[i], loop[(i + 1) % loop.length]));
  }
  return d;
}

/** 点到整个区域边界（外轮廓+所有孔）的最短距离 */
export function distanceToBoundary(p: Vec2, poly: Polygon): number {
  let d = distanceToLoop(p, poly.outer);
  for (const h of poly.holes) d = Math.min(d, distanceToLoop(p, h));
  return d;
}

export interface PolygonBounds {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export function polygonBounds(poly: Polygon): PolygonBounds {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const loop of [poly.outer, ...poly.holes]) {
    for (const p of loop) {
      xmin = Math.min(xmin, p.x);
      ymin = Math.min(ymin, p.y);
      xmax = Math.max(xmax, p.x);
      ymax = Math.max(ymax, p.y);
    }
  }
  return { xmin, ymin, xmax, ymax };
}

/**
 * 将环的每条边按目标间距 seed 细分，返回新的点列与环上边索引对。
 * 原有顶点一定保留（模板顶点拖动后仍可识别）。
 */
export function subdivideLoop(
  loop: Vec2[],
  seed: number,
  tol: number,
): { points: Vec2[]; edges: [number, number][] } {
  const points: Vec2[] = [];
  const edges: [number, number][] = [];
  for (const p of loop) {
    if (!points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol)) points.push({ ...p });
  }
  // 每条边插入中间点
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(dist / seed));
    let prevIdx = points.findIndex((q) => Math.hypot(q.x - a.x, q.y - a.y) < tol);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const np = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const existing = points.findIndex((q) => Math.hypot(q.x - np.x, q.y - np.y) < tol);
      const idx = existing >= 0 ? existing : points.push(np) - 1;
      edges.push([prevIdx, idx]);
      prevIdx = idx;
    }
    const bIdx = points.findIndex((q) => Math.hypot(q.x - b.x, q.y - b.y) < tol);
    edges.push([prevIdx, bIdx]);
  }
  return { points, edges };
}

/** 合并两个点列/边列（去重容差 tol） */
export function mergeSubdivisions(
  acc: { points: Vec2[]; edges: [number, number][] },
  part: { points: Vec2[]; edges: [number, number][] },
  tol: number,
): void {
  const map = new Map<number, number>();
  for (let i = 0; i < part.points.length; i++) {
    const p = part.points[i];
    const existing = acc.points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol);
    map.set(i, existing >= 0 ? existing : acc.points.push(p) - 1);
  }
  for (const [a, b] of part.edges) acc.edges.push([map.get(a)!, map.get(b)!]);
}

/** 生成带抖动的内部候选点（抖动避免规则网格下退化三角形） */
export function generateInteriorPoints(poly: Polygon, seed: number): Vec2[] {
  const b = polygonBounds(poly);
  const out: Vec2[] = [];
  const clearance = seed * 0.55;
  const nx = Math.max(1, Math.ceil((b.xmax - b.xmin) / seed));
  const ny = Math.max(1, Math.ceil((b.ymax - b.ymin) / seed));
  const sx = (b.xmax - b.xmin) / nx;
  const sy = (b.ymax - b.ymin) / ny;
  let row = 0;
  for (let j = 0; j < ny; j++) {
    const offset = row % 2 === 0 ? 0.25 : -0.25;
    for (let i = 0; i < nx; i++) {
      const jx = (Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1; // 确定性伪随机
      const jy = (Math.sin(i * 39.346 + j * 11.135) * 24634.6345) % 1;
      const px = b.xmin + (i + 0.5 + offset + jx * 0.3) * sx;
      const py = b.ymin + (j + 0.5 + jy * 0.3) * sy;
      const p = { x: px, y: py };
      if (
        pointInPolygon(p, poly) &&
        distanceToBoundary(p, poly) > clearance
      ) {
        out.push(p);
      }
    }
    row++;
  }
  return out;
}
