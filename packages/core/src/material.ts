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
 * 质量密度：未显式给定时按钢材量级取默认值。
 * 在 mm-N-MPa 自洽单位制中 1 N = 1 kg·mm/s²，故密度以 kg/mm³ 计：
 * 钢 ρ = 7850 kg/m³ = 7.85×10⁻⁶ kg/mm³
 * （对应重力密度 ρg ≈ 7.7×10⁻² N/mm³，g=9810 mm/s²）。
 */
export const STEEL_DENSITY = 7.85e-6;

/** 取材料质量密度，缺省回退到钢材默认值 */
export function materialDensity(mat: Material): number {
  return mat.rho && mat.rho > 0 && Number.isFinite(mat.rho) ? mat.rho : STEEL_DENSITY;
}

/** 默认钢材参数：E=210 GPa（若使用 mm-N-MPa 单位制即 210000 MPa），ν=0.3 */
export const STEEL_MATERIAL: Material = {
  E: 210000,
  nu: 0.3,
  thickness: 10,
  model: 'planeStress',
  rho: STEEL_DENSITY,
};
