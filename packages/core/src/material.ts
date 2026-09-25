import type { Material } from './types.js';

/**
 * 平面应力本构矩阵：
 * D = E/(1-ν²) [1   ν    0   ;
 *               ν   1    0   ;
 *               0   0  (1-ν)/2]
 *
 * 平面应变本构矩阵：
 * D = E/((1+ν)(1-2ν)) [1-ν  ν    0        ;
 *                       ν   1-ν   0        ;
 *                       0    0   (1-2ν)/2]
 */
export function constitutiveMatrix(mat: Material): Float64Array {
  const { E, nu, model } = mat;
  const D = new Float64Array(9);
  if (model === 'planeStress') {
    const f = E / (1 - nu * nu);
    D[0] = f;
    D[1] = f * nu;
    D[3] = f * nu;
    D[4] = f;
    D[8] = f * (1 - nu) / 2;
  } else {
    const f = E / ((1 + nu) * (1 - 2 * nu));
    D[0] = f * (1 - nu);
    D[1] = f * nu;
    D[3] = f * nu;
    D[4] = f * (1 - nu);
    D[8] = f * (1 - 2 * nu) / 2;
  }
  return D;
}

/** 计算用厚度：平面应变问题在物理上取单位厚度，但为了与外载（面力、体力）
 *  保持量纲一致，内部始终使用材料面板给出的厚度 t —— K 与 F 同时乘 t，
 *  位移结果不受影响，平面应力/平面应变的差异完全由 D 体现。 */
export function effectiveThickness(mat: Material): number {
  return mat.thickness;
}

/**
 * 钢材默认质量密度（mm-N-MPa 单位制）：
 * ρ = 7850 kg/m³ = 7.85×10⁻⁹ N·s²/mm⁴。
 * 因为频率 ∝ √(E/ρ)，只要 E 与 ρ 的单位制自洽，频率结果即为 rad/s。
 */
export const STEEL_DENSITY = 7.85e-9;

/** 取材料密度，缺省时使用钢材默认值 */
export function effectiveDensity(mat: Material): number {
  return mat.density && mat.density > 0 ? mat.density : STEEL_DENSITY;
}

/** 默认钢材参数：E=210 GPa（若使用 mm-N-MPa 单位制即 210000 MPa），ν=0.3 */
export const STEEL_MATERIAL: Material = {
  E: 210000,
  nu: 0.3,
  thickness: 10,
  model: 'planeStress',
  density: STEEL_DENSITY,
};
