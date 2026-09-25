/**
 * 内置标准算例（含解析/参考解），供界面一键载入与自动化对照。
 */
import type { FemModel, Material } from './types.js';
import { STEEL_DENSITY } from './material.js';
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
  /** 静力参考解析解 */
  reference: {
    label: string;
    tipDisplacement?: number;
    maxStress?: number;
    formula: string;
  };
  /** 自由振动参考解析解（用于频率对照） */
  vibration?: VibrationReference;
}

/** 自由振动解析参考：给定质量密度与网格，返回前若干阶理论频率与说明 */
export interface VibrationReference {
  label: string;
  formula: string;
  /**
   * 理论频率 (Hz) 对照表。label 描述模态性质（弯曲/纵向…）。
   * 数值按所选单位制由梁/杆闭式解计算。
   */
  frequencies: Array<{ order: number; label: string; hz: number; kind: 'bending' | 'longitudinal' | 'other' }>;
}

/**
 * 算例 1：悬臂梁（端部集中力）
 * L=100, H=10, t=10, E=210000 MPa, ν=0.3, P=100 N
 * 梁理论（Euler-Bernoulli）端部挠度 δ = PL³/(3EI)，I=th³/12
 */
export const cantileverExample: ExampleCase = (() => {
  const L = 100, H = 10, t = 10, E = 210000, P = 100;
  const rho = STEEL_DENSITY;
  const I = (t * H ** 3) / 12;
  const Asec = t * H;
  const tip = (P * L ** 3) / (3 * E * I);
  const sigmaMax = (P * L * (H / 2)) / I;

  // Euler-Bernoulli 悬臂弯曲固有频率：
  //   ω_n = β_n² · √(EI/(ρA·L⁴))，β_n L = 1.875104, 4.694091, 7.854757, ...
  // 一端固定一端自由杆的纵向振动：
  //   ω_n = (2n−1)π/(2L)·√(E/ρ)
  const betaRoots = [1.87510407, 4.69409113, 7.85475744];
  const bendFreqs = betaRoots.map((b, i) => ({
    order: i + 1,
    label: `第 ${i + 1} 阶弯曲`,
    hz: (b * b) / (2 * Math.PI) * Math.sqrt((E * I) / (rho * Asec * L ** 4)),
    kind: 'bending' as const,
  }));
  const longFreq = (n: number) => ({
    order: n,
    label: `第 ${n} 阶纵向`,
    hz: ((2 * n - 1) / (4 * L)) * Math.sqrt(E / rho),
    kind: 'longitudinal' as const,
  });

  return {
    id: 'cantilever',
    name: '悬臂梁（静力 + 自由振动）',
    description:
      '左端固定、右端中点受向下集中力 100 N（静力）；自由振动时无需任何外载。' +
      '材料钢 E=210000 MPa、ν=0.3、厚 10 mm、ρ=7.85×10⁻⁶ kg/mm³。' +
      '加密网格后端部最大挠度趋于梁理论解；低阶弯曲固有频率趋于 Euler-Bernoulli ' +
      '闭式解 f=β²/(2π)·√(EI/ρAL⁴)，纵向频率趋于 f=(2n−1)/(4L)·√(E/ρ)。',
    seed: 2,
    material: { E, nu: 0.3, thickness: t, model: 'planeStress', rho },
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
        material: { E, nu: 0.3, thickness: t, model: 'planeStress', rho },
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
    vibration: {
      label: 'Euler-Bernoulli 梁 / 轴向杆闭式解',
      formula:
        '弯曲：f_n = β_n²/(2π)·√(EI/(ρAL⁴))，β_nL = 1.8751, 4.6941, 7.8548；' +
        '纵向：f_n = (2n−1)/(4L)·√(E/ρ)',
      frequencies: [...bendFreqs, longFreq(1), longFreq(2)],
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

/**
 * 算例 3：一端固定一端自由细杆的纵向（轴向）自由振动。
 * 细长矩形 L=200, H=4，左端整边固定。
 * 解析解（一维轴向波动）：f_n = (2n−1)/(4L)·√(E/ρ)。
 * 取细网格时，整体质量矩阵的纵向模态应收敛到该闭式解的近旁
 * （CST 对纯轴向变形是精确的，偏差主要来自自由端边界的离散）。
 */
export const axialRodExample: ExampleCase = (() => {
  const L = 200, H = 4, t = 10, E = 210000;
  const rho = STEEL_DENSITY;
  const freqs = [1, 2, 3, 4].map((n) => ({
    order: n,
    label: `第 ${n} 阶纵向`,
    hz: ((2 * n - 1) / (4 * L)) * Math.sqrt(E / rho),
    kind: 'longitudinal' as const,
  }));
  return {
    id: 'axial-rod',
    name: '悬臂杆纵向自由振动（频率闭式解）',
    description:
      '细长矩形杆 L=200、H=4，左端整边固定，仅用于自由振动分析（无外载）。' +
      '一维轴向波动理论给出 f_n=(2n−1)/(4L)·√(E/ρ)，' +
      '随网格加密，FEM 解出的纵向模态频率（x 向动能占比≈1）收敛到该解析值。',
    seed: 4,
    material: { E, nu: 0.3, thickness: t, model: 'planeStress', rho },
    buildModel(seed: number) {
      const nx = Math.max(4, Math.round(L / seed));
      const ny = Math.max(1, Math.round(H / seed));
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
        material: { E, nu: 0.3, thickness: t, model: 'planeStress', rho },
        supports: [
          { id: 'fix', region: { kind: 'line', x1: 0, y1: -H / 2, x2: 0, y2: H / 2 }, type: 'fixed' },
        ],
        nodalLoads: [],
        tractionLoads: [],
      };
    },
    reference: {
      label: '一维轴向波动',
      formula: 'f_n = (2n−1)/(4L)·√(E/ρ)',
    },
    vibration: {
      label: '一端固定一端自由杆纵向振动闭式解',
      formula: 'f_n = (2n−1)/(4L)·√(E/ρ)',
      frequencies: freqs,
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

export const EXAMPLE_CASES: ExampleCase[] = [cantileverExample, axialRodExample, plateHoleExample];

export function getExample(id: string): ExampleCase | undefined {
  return EXAMPLE_CASES.find((c) => c.id === id);
}
