/**
 * 参数化几何模板。生成后顶点仍然是普通多边形顶点，可在画布上拖动微调。
 */
import type { Polygon, Vec2 } from '../types.js';

export type TemplateKind = 'rectangle' | 'lShape' | 'plateWithHole' | 'quarterPlateHole';

export interface TemplateParams {
  kind: TemplateKind;
  // 矩形
  length?: number;
  height?: number;
  // 圆弧离散段数
  arcSegments?: number;
}

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  rectangle: '矩形梁',
  lShape: 'L 形截面',
  plateWithHole: '带圆孔板',
  quarterPlateHole: '四分之一带孔板（推荐：单向拉伸孔边应力集中）',
};

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** 矩形梁：长 L、高 H，左下角在原点 */
export function rectangleTemplate(L: number, H: number): Polygon {
  return {
    outer: [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: H },
      { x: 0, y: H },
    ],
    holes: [],
  };
}

/**
 * L 形（悬臂支架常用）：宽 W、高 H、厚度 t（两腿等宽）。
 * 轮廓从 (0,0) 出发逆时针。
 */
export function lShapeTemplate(W: number, H: number, t: number): Polygon {
  return {
    outer: [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: t },
      { x: t, y: t },
      { x: t, y: H },
      { x: 0, y: H },
    ],
    holes: [],
  };
}

/**
 * 带中心圆孔的矩形板：宽 W、高 H、孔半径 r。
 * 外轮廓逆时针，内孔由 cdt2d 自动识别为洞。
 */
export function plateWithHoleTemplate(W: number, H: number, r: number, arcSegments = 24): Polygon {
  const outer: Vec2[] = [
    { x: -W / 2, y: -H / 2 },
    { x: W / 2, y: -H / 2 },
    { x: W / 2, y: H / 2 },
    { x: -W / 2, y: H / 2 },
  ];
  // 孔顺时针
  const hole: Vec2[] = [];
  for (let i = 0; i < arcSegments; i++) {
    const a = -2 * Math.PI * (i / arcSegments);
    hole.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return { outer, holes: [hole] };
}

/**
 * 四分之一带孔板（对称性模型）：
 * 半径 r 的孔位于原点，板范围 [r, W]×[r, H]。
 * 利用对称性时：底边竖直滑移（uy=0）、左边水平滑移（ux=0），
 * 右边施加 x 方向均布拉应力 σ0，孔边应力集中系数理论值 3.0。
 */
export function quarterPlateHoleTemplate(
  r: number,
  W: number,
  H: number,
  arcSegments = 16,
): Polygon {
  // 外轮廓逆时针：(r,0) → (W,0) → (W,H) → (0,H) → (0,r)，再沿孔弧回到 (r,0)
  const outer: Vec2[] = [
    { x: r, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
    { x: 0, y: r },
  ];
  // 孔弧：从 (0,r) 到 (r,0)，顺时针扫过第四象限圆弧（角度 π/2 → 0）
  const arc = arcPoints(0, 0, r, Math.PI / 2, 0, arcSegments);
  for (let i = 1; i < arc.length - 1; i++) outer.push(arc[i]);
  return { outer, holes: [] };
}

export function buildTemplate(params: TemplateParams): Polygon {
  const seg = params.arcSegments ?? 20;
  switch (params.kind) {
    case 'rectangle':
      return rectangleTemplate(params.length ?? 100, params.height ?? 20);
    case 'lShape':
      return lShapeTemplate(params.length ?? 60, params.height ?? 60, (params.length ?? 60) / 3);
    case 'plateWithHole':
      return plateWithHoleTemplate(100, 50, Math.min(10, (params.height ?? 50) / 4), seg);
    case 'quarterPlateHole':
      return quarterPlateHoleTemplate(10, 50, 50, seg);
  }
}
