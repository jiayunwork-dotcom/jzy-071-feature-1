/**
 * 三节点常应变三角形（CST）单元。
 *
 * 单元自由度：[ux_i, uy_i, ux_j, uy_j, ux_k, uy_k]
 * 形函数 N_i = (a_i + b_i x + c_i y) / (2A)
 * 应变-位移矩阵 B 的系数：b_i = y_j - y_k，c_i = x_k - x_j（循环排列）
 */
import type { Vec2 } from './types.js';

export interface CstElement {
  /** 三个节点的全局编号 */
  nodes: [number, number, number];
  /** 面积 A（带符号，CCW 为正），通常取 |A| */
  area: number;
  /** B 矩阵 3×6：[b_i 0 b_j 0 b_k 0; 0 c_i 0 c_j 0 c_k; c_i b_i c_j b_j c_k b_k] / (2A) */
  B: Float64Array;
  /** 形函数梯度（每节点 ∂N/∂x, ∂N/∂y），扁平化长度 6 */
  gradN: Float64Array;
}

/** 由三个节点坐标构造单元几何信息 */
export function createCst(p0: Vec2, p1: Vec2, p2: Vec2, nodes: [number, number, number]): CstElement {
  const xi = p0.x, yi = p0.y;
  const xj = p1.x, yj = p1.y;
  const xk = p2.x, yk = p2.y;

  // b/c 系数，索引 i,j,k 循环
  const bi = yj - yk, bj = yk - yi, bk = yi - yj;
  const ci = xk - xj, cj = xi - xk, ck = xj - xi;

  // 两倍有向面积
  const twoA = bi * cj - bj * ci; // = (xj-xi)(yk-yi) - (xk-xi)(yj-yi)
  const area = Math.abs(twoA) * 0.5;
  const d = twoA; // 带符号分母
  const inv = 1 / d;

  // B (3×6)，行：εx, εy, γxy；列按 (ux_i, uy_i, ux_j, uy_j, ux_k, uy_k)
  const B = new Float64Array(18);
  const cols: [number, number, number] = [bi, bj, bk];
  const rows: [number, number, number] = [ci, cj, ck];
  for (let n = 0; n < 3; n++) {
    const b = cols[n] * inv;
    const c = rows[n] * inv;
    B[0 * 6 + n * 2 + 0] = b; // ∂εx/∂ux
    B[1 * 6 + n * 2 + 1] = c; // ∂εy/∂uy
    B[2 * 6 + n * 2 + 0] = c; // ∂γxy/∂ux
    B[2 * 6 + n * 2 + 1] = b; // ∂γxy/∂uy
  }

  const gradN = new Float64Array(6);
  for (let n = 0; n < 3; n++) {
    gradN[n * 2] = cols[n] * inv;
    gradN[n * 2 + 1] = rows[n] * inv;
  }

  return { nodes, area, B, gradN };
}

/** 单元刚度矩阵 Ke = t·A·Bᵀ·D·B，返回 6×6（行主序） */
export function elementStiffness(
  elem: CstElement,
  D: Float64Array,
  thickness: number,
): Float64Array {
  const B = elem.B;
  // DB = D(3×3) · B(3×6)
  const DB = new Float64Array(18);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += D[i * 3 + k] * B[k * 6 + j];
      DB[i * 6 + j] = s;
    }
  }
  // Ke = t A · Bᵀ · DB，6×6
  const Ke = new Float64Array(36);
  const scale = thickness * elem.area;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += B[k * 6 + i] * DB[k * 6 + j];
      Ke[i * 6 + j] = scale * s;
    }
  }
  return Ke;
}

/** 单元一致体力载荷：fe = t·A·[bx, by, bx, by, bx, by]/3 */
export function bodyForceLoad(elem: CstElement, thickness: number, bx: number, by: number): Float64Array {
  const fe = new Float64Array(6);
  const q = (thickness * elem.area) / 3;
  for (let n = 0; n < 3; n++) {
    fe[n * 2] = q * bx;
    fe[n * 2 + 1] = q * by;
  }
  return fe;
}

/** 单元常应变 ε = B·ue */
export function elementStrain(elem: CstElement, ue: Float64Array | number[]): [number, number, number] {
  const B = elem.B;
  const ex = B[0] * ue[0] + B[1] * ue[1] + B[2] * ue[2] + B[3] * ue[3] + B[4] * ue[4] + B[5] * ue[5];
  const ey = B[6] * ue[0] + B[7] * ue[1] + B[8] * ue[2] + B[9] * ue[3] + B[10] * ue[4] + B[11] * ue[5];
  const gxy = B[12] * ue[0] + B[13] * ue[1] + B[14] * ue[2] + B[15] * ue[3] + B[16] * ue[4] + B[17] * ue[5];
  return [ex, ey, gxy];
}

/** 单元常应力 σ = D·ε，返回 [σx, σy, τxy] */
export function elementStressFromStrain(D: Float64Array, ex: number, ey: number, gxy: number): [number, number, number] {
  return [
    D[0] * ex + D[1] * ey + D[2] * gxy,
    D[1] * ex + D[4] * ey + D[5] * gxy,
    D[2] * ex + D[5] * ey + D[8] * gxy,
  ];
}

/** von Mises 等效应力（按平面内 σz=0 计算，平面应变下作教学近似处理） */
export function vonMises(sx: number, sy: number, txy: number): number {
  return Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
}

/** 三角形内角（弧度），顺序 p0-p1-p2，返回三个角 */
export function triangleAngles(p0: Vec2, p1: Vec2, p2: Vec2): [number, number, number] {
  function angle(pa: Vec2, pb: Vec2, pc: Vec2): number {
    const v1x = pa.x - pb.x, v1y = pa.y - pb.y;
    const v2x = pc.x - pb.x, v2y = pc.y - pb.y;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    const c = Math.max(-1, Math.min(1, dot / (m1 * m2)));
    return Math.acos(c);
  }
  return [angle(p2, p0, p1), angle(p0, p1, p2), angle(p1, p2, p0)];
}

/** 单元质量：2 r_in / r_out，正三角形为 1，退化三角形趋于 0 */
export function triangleQuality(p0: Vec2, p1: Vec2, p2: Vec2): number {
  const a = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const b = Math.hypot(p2.x - p0.x, p2.y - p0.y);
  const c = Math.hypot(p0.x - p1.x, p0.y - p1.y);
  const s = (a + b + c) / 2;
  const area = Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2;
  if (area < 1e-30) return 0;
  const rIn = area / s;
  const rOut = (a * b * c) / (4 * area);
  return rOut > 0 ? (2 * rIn) / rOut : 0;
}
