/**
 * 广义特征值求解：K·φ = λ·M·φ，λ = ω²。
 *
 * 两条求解路径：
 * - 小规模（自由自由度 ≤ denseThreshold，默认 600）：
 *   Cholesky 白化 M = L·Lᵀ，把广义问题化为对称标准问题 B = L⁻¹K L⁻ᵀ，
 *   再用 Householder 三对角化 + 隐式位移 QL（tred2 + tqli）求全部特征对，
 *   天然覆盖零（刚体）特征值与重合特征值，且严格按从小到大排列；
 * - 大规模：以 σ 平移的逆迭代子空间迭代（Rayleigh-Ritz）锁定低频端，
 *   向量组在 M 内积下反复正交归一（子空间迭代天然保留重频模态，不会漏掉重合频率），
 *   (K+σM) 的求逆用 Jacobi-PCG，σ 平移使约束不足时 K 半正定也能稳定求解。
 */
import { SingularMatrixError } from './types.js';
import { csrMultiply, type SparseMatrix } from './assembly.js';

export interface EigenPair {
  lambda: number;
  /** 在缩减（自由自由度）空间中的特征向量 */
  vector: Float64Array;
}

export interface EigenSolveOptions {
  denseThreshold?: number;
  /** 目标弹性模态数（子空间迭代据此取块大小） */
  wantModes: number;
  /** 判定刚体特征值的相对阈值：λ < rigidRelTol·λmax 视为刚体模态 */
  rigidRelTol?: number;
  tolerance?: number;
  maxIterations?: number;
}

export interface EigenSolveResult {
  pairs: EigenPair[];
  solver: 'dense-symmetric' | 'block-lanczos';
  iterations?: number;
}

/**
 * 求解缩减系统上的广义特征值问题，返回按 λ 升序的全部（稠密路径）
 * 或前若干阶（稀疏路径）特征对。
 */
export function solveGeneralEigen(
  Kr: SparseMatrix,
  Mr: SparseMatrix,
  opts: EigenSolveOptions,
): EigenSolveResult {
  const threshold = opts.denseThreshold ?? 600;
  if (Kr.n <= threshold) {
    return { pairs: solveDenseGeneralized(Kr, Mr), solver: 'dense-symmetric' };
  }
  const iters = { value: 0 };
  const pairs = solveSubspaceIteration(Kr, Mr, opts, iters);
  return { pairs, solver: 'block-lanczos', iterations: iters.value };
}

/* ----------------------------- 稠密路径 ----------------------------- */

/** 稠密广义特征值：Cholesky 白化 + 对称标准特征值 */
export function solveDenseGeneralized(K: SparseMatrix, M: SparseMatrix): EigenPair[] {
  const n = K.n;
  const A = toDense(K);
  const Md = toDense(M);

  // M = L·Lᵀ（质量矩阵必须正定）
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = Md[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (!(s > 0)) {
          throw new SingularMatrixError(
            '质量矩阵非正定：可能存在未连接任何单元的孤立节点，或密度/厚度参数无效。',
          );
        }
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }

  // B = L⁻¹·K·L⁻ᵀ（对称）
  // Y = L⁻¹·K：逐列前代
  const Y = new Float64Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let i = 0; i < n; i++) {
      let s = A[i * n + col];
      for (let k = 0; k < i; k++) s -= L[i * n + k] * Y[k * n + col];
      s /= L[i * n + i];
      Y[i * n + col] = s;
    }
  }
  // B = Y·L⁻ᵀ：取 B 的每一行 bᵀ，由 b·Lᵀ = y（即 L·bᵀ = yᵀ）做前代：
  // b[j] = (y[j] − Σ_{k<j} L[j,k]·b[k]) / L[j,j]
  const B = new Float64Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let j = 0; j < n; j++) {
      let s = Y[row * n + j];
      for (let k = 0; k < j; k++) s -= L[j * n + k] * B[row * n + k];
      B[row * n + j] = s / L[j * n + j];
    }
  }

  const { values, vectors } = symmetricEigen(B, n);

  // φ = L⁻ᵀ·z：逐列回代
  const pairs: EigenPair[] = [];
  for (let c = 0; c < n; c++) {
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = vectors[i * n + c];
    const phi = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = z[i];
      for (let k = i + 1; k < n; k++) s -= L[k * n + i] * phi[k];
      phi[i] = s / L[i * n + i];
    }
    // 数值上重新做质量归一化（白化解理论上已正交归一）
    massNormalizeInPlace(phi, M);
    orientSign(phi);
    pairs.push({ lambda: values[c], vector: phi });
  }
  pairs.sort((a, b) => a.lambda - b.lambda);
  return pairs;
}

function toDense(A: SparseMatrix): Float64Array {
  const n = A.n;
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      D[i * n + A.colIdx[p]] = A.values[p];
    }
  }
  return D;
}

/**
 * 实对称矩阵全部特征对（升序）：
 * Householder 约化三对角（tred2）+ 隐式位移 QL（tqli）。
 * 矩阵 a 为 n×n 行主序，会被覆盖；返回特征向量 Q（列向量）。
 */
export function symmetricEigen(a: Float64Array, n: number): {
  values: Float64Array;
  vectors: Float64Array;
} {
  const d = new Float64Array(n);
  const e = new Float64Array(n);

  // ---- tred2：Householder 三对角化，a 最终累积为正交阵 Q ----
  for (let ii = n - 1; ii > 0; ii--) {
    const l = ii - 1;
    let h = 0;
    let scale = 0;
    if (l > 0) {
      for (let k = 0; k <= l; k++) scale += Math.abs(a[ii * n + k]);
      if (scale === 0) {
        e[ii] = a[ii * n + l];
      } else {
        for (let k = 0; k <= l; k++) {
          a[ii * n + k] /= scale;
          h += a[ii * n + k] * a[ii * n + k];
        }
        let f = a[ii * n + l];
        const g = f >= 0 ? -Math.sqrt(h) : Math.sqrt(h);
        e[ii] = scale * g;
        h -= f * g;
        a[ii * n + l] = f - g;
        f = 0;
        for (let j = 0; j <= l; j++) {
          a[j * n + ii] = a[ii * n + j] / h;
          let gg = 0;
          for (let k = 0; k <= j; k++) gg += a[j * n + k] * a[ii * n + k];
          for (let k = j + 1; k <= l; k++) gg += a[k * n + j] * a[ii * n + k];
          e[j] = gg / h;
          f += e[j] * a[ii * n + j];
        }
        const hh = f / (h + h);
        for (let j = 0; j <= l; j++) {
          f = a[ii * n + j];
          let gg = e[j] - hh * f;
          e[j] = gg;
          for (let k = 0; k <= j; k++) {
            a[j * n + k] -= f * e[k] + gg * a[ii * n + k];
          }
        }
      }
    } else {
      e[ii] = a[ii * n + l];
    }
    d[ii] = h;
  }
  d[0] = 0;
  e[0] = 0;
  for (let ii = 0; ii < n; ii++) {
    const l = ii;
    if (d[ii] !== 0) {
      for (let j = 0; j < l; j++) {
        let g = 0;
        for (let k = 0; k < l; k++) g += a[ii * n + k] * a[k * n + j];
        for (let k = 0; k < l; k++) a[k * n + j] -= g * a[k * n + ii];
      }
    }
    d[ii] = a[ii * n + ii];
    a[ii * n + ii] = 1;
    for (let j = 0; j < l; j++) {
      a[j * n + ii] = 0;
      a[ii * n + j] = 0;
    }
  }

  // ---- tqli：隐式位移 QL，累积特征向量到 a ----
  // tred2 给出的次对角在 e[i]（连接 d[i-1] 与 d[i]），
  // tqli 约定 e[i] 连接 d[i] 与 d[i+1]，先做一步移位。
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  for (let l = 0; l < n; l++) {
    let iter = 0;
    let m = l;
    // eslint-disable-next-line no-constant-condition
    outer: while (true) {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1]);
        if (Math.abs(e[m]) + dd === dd) break;
      }
      if (m === l) break;
      if (iter++ >= 60) {
        throw new SingularMatrixError('对称特征值 QL 迭代不收敛（内部数值错误，请检查网格与材料参数）。');
      }
      let g = (d[l + 1] - d[l]) / (2 * e[l]);
      let r = pythag(g, 1);
      g = d[m] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
      let s = 1, c = 1, p = 0;
      let i = l;
      let failed = false;
      for (i = m - 1; i >= l; i--) {
        const f = s * e[i];
        const b = c * e[i];
        r = pythag(f, g);
        e[i + 1] = r;
        if (r === 0) {
          d[i + 1] -= p;
          e[m] = 0;
          failed = true;
          break;
        }
        s = f / r;
        c = g / r;
        g = d[i + 1] - p;
        r = (d[i] - g) * s + 2 * c * b;
        d[i + 1] = g + (p = s * r);
        g = c * r - b;
        for (let k = 0; k < n; k++) {
          const fk = a[k * n + i + 1];
          a[k * n + i + 1] = s * a[k * n + i] + c * fk;
          a[k * n + i] = c * a[k * n + i] - s * fk;
        }
      }
      if (failed && i >= l) continue outer;
      d[l] -= p;
      e[l] = g;
      e[m] = 0;
    }
  }

  // 升序排列特征值并置换特征向量列
  const order = [...Array(n).keys()].sort((u, v) => d[u] - d[v]);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  for (let c = 0; c < n; c++) {
    values[c] = d[order[c]];
    for (let i = 0; i < n; i++) vectors[i * n + c] = a[i * n + order[c]];
  }
  return { values, vectors };
}

function pythag(a: number, b: number): number {
  const x = Math.abs(a), y = Math.abs(b);
  if (x > y) return x * Math.sqrt(1 + (y / x) ** 2);
  return y === 0 ? 0 : y * Math.sqrt(1 + (x / y) ** 2);
}

/* --------------------------- M 内积线性代数 --------------------------- */

export function mDot(M: SparseMatrix, a: Float64Array, b: Float64Array): number {
  const Mb = csrMultiply(M, b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * Mb[i];
  return s;
}

/** 原地质量归一化，返回归一化前的 M 范数平方 */
export function massNormalizeInPlace(v: Float64Array, M: SparseMatrix): number {
  let mm = mDot(M, v, v);
  if (!(mm > 0)) {
    throw new SingularMatrixError('质量内积非正：质量矩阵可能奇异（检查密度参数与网格连通性）。');
  }
  const s = 1 / Math.sqrt(mm);
  for (let i = 0; i < v.length; i++) v[i] *= s;
  return mm;
}

/** 确定性符号约定：令绝对值最大的分量为正，显示与测试更稳定 */
export function orientSign(v: Float64Array): void {
  let idx = 0;
  for (let i = 1; i < v.length; i++) {
    if (Math.abs(v[i]) > Math.abs(v[idx])) idx = i;
  }
  if (v[idx] < 0) for (let i = 0; i < v.length; i++) v[i] = -v[i];
}

/* --------------------------- 稀疏：子空间迭代 --------------------------- */

function solveSubspaceIteration(
  K: SparseMatrix,
  M: SparseMatrix,
  opts: EigenSolveOptions,
  iterCounter: { value: number },
): EigenPair[] {
  const n = K.n;
  const need = opts.wantModes;
  const tol = opts.tolerance ?? 1e-11;
  const maxIter = opts.maxIterations ?? 400;
  // 子空间要留出刚体模态与加速收敛的富余项
  const p = Math.min(n, Math.max(need + 8, 2 * need + 2));

  // σ 平移：既能让约束不足的半正定 K 变为 (K+σM) 正定可求逆，
  // 又使平移逆算子的优势端仍对应最小 λ。
  let trK = 0, trM = 0;
  for (let i = 0; i < n; i++) {
    trK += K.values[K.diagPos[i]];
    trM += M.values[M.diagPos[i]];
  }
  const sigma = Math.max((trK / Math.max(trM, 1e-300)) * 1e-10, 1e-300);

  // 初始向量：确定性伪随机 + 一个对角型向量，保证可复现
  const X = Array.from({ length: p }, (_v, j) => randomVector(n, j));
  mOrthonormalize(X, M);

  let prev = new Float64Array(p).fill(NaN);
  let ritzPairs: EigenPair[] = [];

  for (let iter = 0; iter < maxIter; iter++) {
    iterCounter.value = iter + 1;
    // Y = (K+σM)⁻¹·M·X：对每个基向量做一次平移逆迭代
    for (let j = 0; j < p; j++) {
      const rhs = csrMultiply(M, X[j]);
      const y = shiftedPCG(K, M, sigma, rhs, X[j]);
      X[j] = y;
    }
    // 关于 M 重新正交归一（Gram-Schmidt），重频模态因此不会塌缩成同一个
    mOrthonormalize(X, M);

    // Rayleigh-Ritz：在子空间上解 p×p 广义特征值问题
    ritzPairs = rayleighRitz(K, M, X);

    let converged = 0;
    for (let j = 0; j < Math.min(need, ritzPairs.length); j++) {
      const lam = ritzPairs[j].lambda;
      if (Number.isFinite(prev[j]) && Math.abs(lam - prev[j]) <= tol * Math.max(1, lam)) {
        converged++;
      }
    }
    if (converged >= Math.min(need, ritzPairs.length) && iter > 2) break;
    prev = Float64Array.from(ritzPairs.map((rp) => rp.lambda));

    // 用 Ritz 向量刷新迭代基
    for (let j = 0; j < p; j++) X[j] = ritzPairs[j].vector;
  }

  return ritzPairs.slice(0, p);
}

/** 修改的 Gram-Schmidt：把一组向量在 M 内积下正交归一化 */
function mOrthonormalize(X: Float64Array[], M: SparseMatrix): void {
  for (let j = 0; j < X.length; j++) {
    const Mv = csrMultiply(M, X[j]);
    for (let k = 0; k < j; k++) {
      let proj = 0;
      for (let i = 0; i < X[j].length; i++) proj += X[k][i] * Mv[i];
      for (let i = 0; i < X[j].length; i++) X[j][i] -= proj * X[k][i];
    }
    // 重正交一次（数值稳定性）
    const Mv2 = csrMultiply(M, X[j]);
    for (let k = 0; k < j; k++) {
      let proj = 0;
      for (let i = 0; i < X[j].length; i++) proj += X[k][i] * Mv2[i];
      for (let i = 0; i < X[j].length; i++) X[j][i] -= proj * X[k][i];
    }
    massNormalizeInPlace(X[j], M);
  }
}

/** Rayleigh-Ritz 投影：在 M 正交基 X 上形成 Kp = XᵀKX、Mp = XᵀMX = I，求标准特征值 */
function rayleighRitz(K: SparseMatrix, M: SparseMatrix, X: Float64Array[]): EigenPair[] {
  const p = X.length;
  const n = K.n;
  const KX = X.map((x) => csrMultiply(K, x));
  const Kp = new Float64Array(p * p);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[a][i] * KX[b][i];
      Kp[a * p + b] = s;
      Kp[b * p + a] = s;
    }
  }
  const { values, vectors } = symmetricEigen(Kp, p);
  const out: EigenPair[] = [];
  for (let c = 0; c < p; c++) {
    const v = new Float64Array(n);
    for (let a = 0; a < p; a++) {
      const ca = vectors[a * p + c];
      for (let i = 0; i < n; i++) v[i] += ca * X[a][i];
    }
    massNormalizeInPlace(v, M);
    orientSign(v);
    // 平移逆迭代给出的是 1/(λ+σ) 优势端，Ritz 值即 λ（由投影直接得到），
    // 数值噪声可能让零特征值出现极小负值，截到 0。
    out.push({ lambda: Math.max(0, values[c]), vector: v });
  }
  out.sort((a, b) => a.lambda - b.lambda);
  return out;
}

/** 求解 (K+σM)·x = b 的 Jacobi-PCG；x0 可作为热启动初值 */
function shiftedPCG(
  K: SparseMatrix,
  M: SparseMatrix,
  sigma: number,
  b: Float64Array,
  x0: Float64Array,
): Float64Array {
  const n = K.n;
  const x = Float64Array.from(x0);
  const invDiag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = K.values[K.diagPos[i]] + sigma * M.values[M.diagPos[i]];
    invDiag[i] = 1 / d;
  }
  const ax = (v: Float64Array): Float64Array => {
    const Kv = csrMultiply(K, v);
    const Mv = csrMultiply(M, v);
    for (let i = 0; i < n; i++) Kv[i] += sigma * Mv[i];
    return Kv;
  };
  let Ax = ax(x);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = b[i] - Ax[i];
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = r[i] * invDiag[i];
  const p = Float64Array.from(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const bNorm = norm2(b) || 1;

  for (let it = 0; it < 5000; it++) {
    if (norm2(r) / bNorm < 1e-12) break;
    const Ap = ax(p);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    for (let i = 0; i < n; i++) z[i] = r[i] * invDiag[i];
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }
  return x;
}

function norm2(v: Float64Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** 确定性的伪随机初始向量（线性同余），含若干低频倾向的种子模式 */
function randomVector(n: number, salt: number): Float64Array {
  const v = new Float64Array(n);
  let seed = ((n + 1) * 2654435761 + salt * 40503 + 12345) >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    v[i] = seed / 4294967296 - 0.5;
  }
  return v;
}
