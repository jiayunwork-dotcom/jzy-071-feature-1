/**
 * 振动算例的梁 / 杆理论闭式参考解，供自动化对照。
 *
 * 单位约定与内核一致（建议 mm-N-MPa，ρ 取 N·s²/mm⁴）。
 */

/** 悬臂 Euler-Bernoulli 梁弯曲特征方程 cosβ·coshβ = −1 的前若干个正根 βL */
export const CANTILEVER_BEAM_ROOTS = [1.875104069, 4.694091133, 7.854757438];

export interface BeamFrequencyRef {
  kind: 'bend';
  order: number;
  /** 圆频率 rad/s */
  omega: number;
  /** Hz */
  hz: number;
}

export interface RodFrequencyRef {
  kind: string;
  order: number;
  omega: number;
  hz: number;
}

/**
 * 悬臂梁（一端固定一端自由）弯曲固有频率：
 *   ω_n = (βL)_n² · √(EI/(ρA L⁴))
 *
 * 二维平面应力模型取矩形截面 A = t·h、I = t·h³/12。
 * 注意：平面应力梁在弯曲时存在泊松效应，梁理论是忽略它的一维近似，
 * 网格足够细（长度方向 << L、厚度方向有数层）时数值解收敛到该值邻域。
 */
export function cantileverBeamFrequencies(
  E: number,
  nu: number,
  rho: number,
  thickness: number,
  L: number,
  h: number,
  count = 3,
  opts: { planeStrain?: boolean } = {},
): BeamFrequencyRef[] {
  const A = thickness * h;
  const I = (thickness * h ** 3) / 12;
  // 平面应变等效弹性模量（教学近似），让二维模型与一维梁理论口径一致
  const Eeff = opts.planeStrain ? E / (1 - nu * nu) : E;
  const base = Math.sqrt((Eeff * I) / (rho * A * L ** 4));
  const out: BeamFrequencyRef[] = [];
  for (let n = 0; n < count; n++) {
    const root = n < CANTILEVER_BEAM_ROOTS.length
      ? CANTILEVER_BEAM_ROOTS[n]
      : (n + 0.5) * Math.PI; // 高阶根 (n+1/2)π 的渐近式
    const omega = root ** 2 * base;
    out.push({ kind: 'bend', order: n + 1, omega, hz: omega / (2 * Math.PI) });
  }
  return out;
}

/**
 * 一端固定一端自由杆的纵向振动：
 *   ω_n = (2n−1)π/(2L) · √(E/ρ)
 * 纵向运动无泊松耦合，二维有限元在网格足够细时严格收敛到该解，
 * 是比弯曲更干净的核验点。
 */
export function fixedFreeRodFrequencies(
  E: number,
  rho: number,
  L: number,
  count = 3,
): RodFrequencyRef[] {
  const c = Math.sqrt(E / rho);
  const out: RodFrequencyRef[] = [];
  for (let n = 1; n <= count; n++) {
    const omega = (((2 * n - 1) * Math.PI) / (2 * L)) * c;
    out.push({ kind: 'axial', order: n, omega, hz: omega / (2 * Math.PI) });
  }
  return out;
}
