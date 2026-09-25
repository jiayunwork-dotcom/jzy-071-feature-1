/**
 * 内置标准算例（含解析/参考解），供界面一键载入与自动化对照。
 */
import type { FemModel, Material } from './types.js';
import { triangulate } from './mesh/triangulate.js';
import { structuredRectangle } from './mesh/structured.js';

export interface ExampleCase {
  id: string;
  name: string;
  description: string;
  /** 初始种子间距 */
  seed: number;
  material: Material;
  buildModel: (seed: number) => FemModel;
  /** 参考解析解 */
  reference: {
    label: string;
    tipDisplacement?: number;
    maxStress?: number;
    formula: string;
  };
}

/**
 * 算例 1：悬臂梁（端部集中力）
 * L=100, H=10, t=10, E=210000 MPa, ν=0.3, P=100 N
 * 梁理论（Euler-Bernoulli）端部挠度 δ = PL³/(3EI)，I=th³/12
 */
export const cantileverExample: ExampleCase = (() => {
  const L = 100, H = 10, t = 10, E = 210000, P = 100;
  const I = (t * H ** 3) / 12;
  const tip = (P * L ** 3) / (3 * E * I);
  const sigmaMax = (P * L * (H / 2)) / I;
  return {
    id: 'cantilever',
    name: '悬臂梁（端部集中力）',
    description:
      '左端固定、右端中点受向下集中力 100 N。材料钢 E=210000 MPa、ν=0.3、厚 10 mm。' +
      '加密网格后端部最大挠度趋于梁理论解，固定端上下边缘应力趋于 σ=Mc/I。',
    seed: 2,
    material: { E, nu: 0.3, thickness: t, model: 'planeStress' },
    buildModel(seed: number) {
      const nx = Math.max(2, Math.round(L / seed));
      const ny = Math.max(2, Math.round(H / seed));
      const mesh = structuredRectangle(0, -H / 2, L, H / 2, nx, ny);
      return {
        polygon: {
          outer: [
            { x: 0, y: -H / 2 }, { x: L, y: -H / 2 },
            { x: L, y: H / 2 }, { x: 0, y: H / 2 },
          ],
          holes: [],
        },
        mesh,
        material: { E, nu: 0.3, thickness: t, model: 'planeStress' },
        supports: [
          { id: 'fix', region: { kind: 'line', x1: 0, y1: -H / 2, x2: 0, y2: H / 2 }, type: 'fixed' },
        ],
        nodalLoads: [
          { id: 'p', region: { kind: 'point', x: L, y: 0 }, fx: 0, fy: -P },
        ],
        tractionLoads: [],
      };
    },
    reference: {
      label: 'Euler-Bernoulli 梁理论',
      tipDisplacement: tip,
      maxStress: sigmaMax,
      formula: 'δ = PL³/(3EI)，I = th³/12；固定端 σ = Mc/I',
    },
  };
})();

/**
 * 算例 2：带中心圆孔板单向拉伸（四分之一对称模型）
 * r=10, 板 50×50（四分之一），远端 σ0=10 MPa
 * Kirsch 解析解：孔边 (r,0) 处 σx = 3σ0（应力集中系数 3）
 */
export const plateHoleExample: ExampleCase = (() => {
  const r = 10, W = 50, H = 50, sigma0 = 10;
  return {
    id: 'plate-hole',
    name: '带圆孔板单向拉伸（四分之一模型）',
    description:
      '利用对称性建立四分之一模型：底边 uy=0、左边 ux=0，右边施加 x 向均布拉应力 10 MPa。' +
      'Kirsch 解析解给出孔边应力集中系数 K=3，即孔边 σx 最大值约 30 MPa。',
    seed: 5,
    material: { E: 210000, nu: 0.3, thickness: 10, model: 'planeStress' },
    buildModel(seed: number) {
      const poly = {
        outer: [
          { x: r, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }, { x: 0, y: r },
          ...arcInterior(r, 20),
        ],
        holes: [],
      };
      const mesh = triangulate(poly, { globalSeed: seed });
      return {
        polygon: poly,
        mesh,
        material: { E: 210000, nu: 0.3, thickness: 10, model: 'planeStress' },
        supports: [
          { id: 'bot', region: { kind: 'line', x1: r, y1: 0, x2: W, y2: 0 }, type: 'slideY' },
          { id: 'left', region: { kind: 'line', x1: 0, y1: r, x2: 0, y2: H }, type: 'slideX' },
          { id: 'pin', region: { kind: 'point', x: 0, y: H }, type: 'fixed' },
        ],
        nodalLoads: [],
        tractionLoads: [
          { id: 'pull', region: { kind: 'line', x1: W, y1: 0, x2: W, y2: H }, tx: sigma0, ty: 0 },
        ],
      };
    },
    reference: {
      label: 'Kirsch 无限大板孔边应力',
      maxStress: 3 * sigma0,
      formula: 'σ_hole = 3σ0（应力集中系数 K=3）',
    },
  };
})();

function arcInterior(r: number, n: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i < n; i++) {
    const a = Math.PI / 2 - (Math.PI / 2) * (i / n);
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
}

export const EXAMPLE_CASES: ExampleCase[] = [cantileverExample, plateHoleExample];

export function getExample(id: string): ExampleCase | undefined {
  return EXAMPLE_CASES.find((c) => c.id === id);
}
