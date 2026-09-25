/**
 * 线性方程求解：
 * - 小规模系统（默认 <= 500 自由度）：稠密 LDLᵀ 分解（无平方根的对称分解），
 *   同时通过小主元计数检测刚体模态 / 欠约束，给出机构自由度数量；
 * - 大规模系统：Jacobi 预处理共轭梯度法（PCG），对正定的约束后系统收敛稳定。
 */
import { SingularMatrixError } from './types.js';
import type { SparseMatrix } from './assembly.js';
import { csrMultiply } from './assembly.js';

export interface SolveOptions {
  denseThreshold?: number;
  cgTolerance?: number;
  cgMaxIterations?: number;
}

export interface SolveResult {
  x: Float64Array;
  solver: 'dense-direct' | 'cg-jacobi';
  iterations?: number;
  residual: number;
}

export function solveSystem(
  K: SparseMatrix,
  F: Float64Array,
  opts: SolveOptions = {},
): SolveResult {
  const threshold = opts.denseThreshold ?? 500;
  if (K.n <= threshold) {
    const x = denseLDLTSolve(K, F);
    const r = residualNorm(K, F, x);
    return { x, solver: 'dense-direct', residual: r };
  }
  return cgSolve(K, F, opts.cgTolerance ?? 1e-10, opts.cgMaxIterations ?? 200000);
}

/** 稠密 LDLᵀ 分解 + 小主元秩检测（把稀疏矩阵展开到稠密存储） */
function denseLDLTSolve(K: SparseMatrix, F: Float64Array): Float64Array {
  const n = K.n;
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
      A[i * n + K.colIdx[p]] = K.values[p];
    }
  }

  // 对角尺度用于设定主元容差
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i * n + i]));
  const pivotTol = Math.max(scale * 1e-10, 1e-14);

  const diag = new Float64Array(n);
  let nullity = 0;
  const nullDofs: number[] = [];

  for (let j = 0; j < n; j++) {
    // L·D 累积更新对角
    let djj = A[j * n + j];
    for (let k = 0; k < j; k++) {
      if (diag[k] !== 0) djj -= A[j * n + k] * A[j * n + k] * diag[k];
    }
    if (Math.abs(djj) < pivotTol) {
      // 奇异主元：该自由度对应无约束刚体/机构模态
      diag[j] = 0;
      nullity++;
      nullDofs.push(j);
      continue;
    }
    diag[j] = djj;
    for (let i = j + 1; i < n; i++) {
      let lij = A[i * n + j];
      for (let k = 0; k < j; k++) {
        if (diag[k] !== 0) lij -= A[i * n + k] * A[j * n + k] * diag[k];
      }
      A[i * n + j] = lij / djj;
    }
  }

  if (nullity > 0) {
    const dirs = nullDofs.slice(0, 6).map((d) => {
      const node = d >> 1;
      return `节点 ${node} 的 ${d % 2 === 0 ? 'x' : 'y'} 方向`;
    });
    throw new SingularMatrixError(
      `刚度矩阵奇异（检测到约 ${nullity} 个无约束自由度）。` +
        `模型约束不足，存在刚体位移或机构：请检查是否固定了足够的节点` +
        `（例如固定端应使用「固定」约束锁住两个方向）。首个未约束方向：${dirs.join('、')}。`,
      nullity,
    );
  }

  // 前代 L·y = F（单位下三角，L 存在 A 的严格下三角）
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = F[i];
    for (let k = 0; k < i; k++) s -= A[i * n + k] * y[k];
    y[i] = s;
  }
  // 对角回代 + 回代 Lᵀ
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] /= diag[i];
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= A[k * n + i] * x[k];
    x[i] = s;
  }
  return x;
}

/** Jacobi 预处理共轭梯度 */
function cgSolve(K: SparseMatrix, F: Float64Array, tol: number, maxIter: number): SolveResult {
  const n = K.n;
  const x = new Float64Array(n);
  const invDiag = new Float64Array(n);
  let minDiag = Infinity;
  for (let i = 0; i < n; i++) {
    const d = K.values[K.diagPos[i]];
    if (Math.abs(d) < 1e-30) {
      throw new SingularMatrixError(
        `刚度矩阵奇异：节点 ${i >> 1} 的 ${i % 2 === 0 ? 'x' : 'y'} 方向对角刚度为 0，` +
          `说明该节点完全没有约束或没有连接到任何单元。请补充约束后再求解。`,
      );
    }
    minDiag = Math.min(minDiag, Math.abs(d));
    invDiag[i] = 1 / d;
  }

  const fNorm = norm(F) || 1;
  let r = Float64Array.from(F, (v) => v); // r = F - K·0 = F
  let z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = r[i] * invDiag[i];
  let p = Float64Array.from(z);
  let rz = dot(r, z);

  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (norm(r) / fNorm < tol) break;
    const Kp = csrMultiply(K, p);
    let pKp = 0;
    for (let i = 0; i < n; i++) pKp += p[i] * Kp[i];
    if (pKp <= 0 || !Number.isFinite(pKp)) {
      throw new SingularMatrixError(
        '刚度矩阵非正定（PCG 中出现非正曲率）。模型很可能约束不足，存在刚体位移；' +
          '若确认约束充分，请检查材料参数与网格是否有效。',
      );
    }
    const alpha = rz / pKp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Kp[i];
    }
    for (let i = 0; i < n; i++) z[i] = r[i] * invDiag[i];
    const rzNew = dot(r, z);
    const beta = rzNew / rz;
    const pOld = p;
    p = new Float64Array(n);
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * pOld[i];
    rz = rzNew;
  }

  const res = norm(r) / fNorm;
  if (res > Math.max(tol * 100, 1e-6)) {
    throw new SingularMatrixError(
      `迭代求解未收敛（残差 ${res.toExponential(2)}，迭代 ${iter} 步）。` +
        '这通常意味着约束不足导致刚度矩阵奇异，请检查约束是否消除了全部刚体位移（共 3 个：x、y 平移与转动）。',
    );
  }
  return { x, solver: 'cg-jacobi', iterations: iter, residual: res };
}

export function norm(v: Float64Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function residualNorm(K: SparseMatrix, F: Float64Array, x: Float64Array): number {
  const Kx = csrMultiply(K, x);
  let s = 0;
  const fn = norm(F) || 1;
  for (let i = 0; i < K.n; i++) s += (Kx[i] - F[i]) ** 2;
  return Math.sqrt(s) / fn;
}
