/**
 * 广义特征值求解（自由振动核心）。
 *
 * 求解对称正定广义特征值问题  K·φ = λ·M·φ（λ = ω²）的最小若干个特征对。
 *
 * 策略：**移位-求逆子空间迭代（shift-invert subspace iteration）**
 *   y ← (K + σM)⁻¹ M x
 * 把「最小的特征值」翻转为算子最大的奇异方向，从而稳定锁定低频端
 * （直接对 K 做幂迭代只会拿到最高频）。迭代中始终对试探向量做
 * **关于 M 的 Gram–Schmidt 正交归一**，使重特征值（对称结构的重频）
 * 以一个子空间整体收敛，不会漏掉或并成一个。
 *
 * K 或 M 允许半定（结构欠约束时 K 存在刚体零空间）：
 * - 稠密路径对 (K+σM) 做常规 LDLᵀ 分解即可，刚体零空间被 σM 正则化，
 *   其对应方向被放大最多、最先收敛，由上层识别并剔除；
 * - 稀疏路径用 M 正交投影（约束迭代向量在刚性子空间之外）+ Jacobi-PCG
 *   求解正则化后的正定系统，避免分解奇异矩阵。
 */
import type { SparseMatrix } from './assembly.js';
import { csrMultiply } from './assembly.js';

export interface EigenPair {
  /** 特征值 λ = ω²（升序） */
  lambda: number;
  /** 特征向量 */
  vector: Float64Array;
}

export interface EigenSolveOptions {
  /** 需要的特征对数 */
  count: number;
  /** 子空间块大小（内部用，默认由 count 推导并留余量以加速收敛） */
  blockSize?: number;
  /** 收敛容差：相邻迭代 Ritz 值相对变化 */
  tolerance?: number;
  /** 最大逆迭代步数 */
  maxIterations?: number;
  /** 随机数种子（试探向量初始化），保证结果可复现 */
  seed?: number;
  /** 稠密路径（n <= denseThreshold）直接对 (K+σM) 稠密 LDLᵀ；否则走稀疏 PCG */
  denseThreshold?: number;
  /**
   * 刚性子空间基（关于 M 正交归一）。稀疏路径将把迭代向量投影到其正交补；
   * 稠密路径忽略（刚体模态会自然最先收敛，由上层过滤）。
   */
  rigidBasis?: Float64Array[];
}

export interface EigenSolveResult {
  pairs: EigenPair[];
  iterations: number;
  blockSize: number;
  /** 每个返回特征对的相对残差 |Kφ − λMφ| / (λ·|Mφ|) */
  residuals: number[];
}

/**
 * 求解广义特征值问题 Kφ = λMφ 最小的 count 个特征对。
 * K、M 为对称（半）正定 CSR，二者稀疏结构一致。
 */
export function solveLowestGeneralized(
  K: SparseMatrix,
  M: SparseMatrix,
  opts: EigenSolveOptions,
): EigenSolveResult {
  const n = K.n;
  const count = Math.min(opts.count, n);
  // 块比目标多取一些：求逆子空间迭代对第 j 个特征值的收敛率为
  // ((λ_j+σ)/(λ_{block+1}+σ))²，块留余量才能让目标阶次（含可能的重频）
  // 在合理步数内收敛，又不至于让大问题的稠密 Ritz 投影过贵。
  const blockSize = Math.min(
    n,
    Math.max(count + 8, Math.min(n, count * 2 + 8)),
  );
  const tol = opts.tolerance ?? 1e-10;
  const maxIter = opts.maxIterations ?? 200;
  const useDense = n <= (opts.denseThreshold ?? 1100);

  // 初始块：确定性的伪随机向量，M 正交归一。
  // 注：稀疏路径不再向刚性子空间投影（刚体模态由 σM 正则化、逆迭代
  // 最先收敛后在顶层剔除），故初始向量含全部方向。
  const rng = mulberry32(opts.seed ?? 1234567);
  let Q: Float64Array[] = [];
  for (let j = 0; j < blockSize; j++) {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = rng() - 0.5;
    Q.push(v);
  }
  massOrthonormalize(M, Q);

  // 移位 σ：
  //  - 必须为正，以把可能存在的刚体零空间正则化为正定、可解的系统；
  //  - 又要显著小于所求最低弹性特征值 λ1，使求逆算子 (K+σM)⁻¹M
  //    对低频方向放大最强（子空间迭代才能稳定锁定低频端）。
  // 用 min_i(K_ii/M_ii)（而非 max）估计弹性尺度的量级下界，
  // 再取其 1e-3；该值对 PCG 而言条件数友好，对逆迭代又足够小。
  let ratioMin = Infinity;
  for (let i = 0; i < n; i++) {
    const mii = Math.abs(M.values[M.diagPos[i]]);
    if (mii > 0) ratioMin = Math.min(ratioMin, Math.abs(K.values[K.diagPos[i]]) / mii);
  }
  if (!Number.isFinite(ratioMin) || ratioMin <= 0) ratioMin = 1;
  // 两阶段移位：
  //  阶段 1 用相对大的 σ₀=1e-4·尺度，把可能的刚体零空间充分正则化、
  //    让 IC(0) 分解稳定，先迭代几步拿到最低弹性 Ritz 值 λ̂₁ 的量级；
  //  阶段 2 改用 σ=1e-3·λ̂₁（远小于所求 λ，不引入可见偏置），
  //    锁定精确的低频特征对。纯正定系统（无刚体模态）直接从阶段 2 起步也可，
  //    但统一走两阶段更稳健、代码路径单一。
  const sigma0 = 1e-4 * ratioMin;
  let shiftSolve = useDense
    ? makeDenseShiftSolver(K, M, sigma0)
    : makeSparseShiftSolver(K, M, sigma0, opts.rigidBasis ?? []);
  let sigmaCur = sigma0;
  let refined = false;

  let ritz = new Array<number>(blockSize).fill(0);
  let iter = 0;
  let residuals: number[] = [];
  let ritzVectors: Float64Array[] = Q;

  for (iter = 1; iter <= maxIter; iter++) {
    // 1) 求逆：Z = (K+σM)⁻¹ M Q
    const Z: Float64Array[] = new Array(blockSize);
    for (let j = 0; j < blockSize; j++) {
      Z[j] = shiftSolve(csrMultiply(M, Q[j]));
    }
    // 2) 关于 M 正交归一（刚体模态不投影，由移位系统正则化后顶层剔除）
    massOrthonormalize(M, Z);

    // 3) Ritz 投影：在 Z 张成的子空间里解 k×k 稠密广义特征值问题。
    // KZ、MZ 各只算一次并在全部内积中复用（切勿在内层循环里重复做稀疏乘）。
    const k = Z.length;
    const Kproj = new Float64Array(k * k);
    const Mproj = new Float64Array(k * k);
    const KZ: Float64Array[] = new Array(k);
    const MZ: Float64Array[] = new Array(k);
    for (let a = 0; a < k; a++) {
      KZ[a] = csrMultiply(K, Z[a]);
      MZ[a] = csrMultiply(M, Z[a]);
    }
    for (let a = 0; a < k; a++) {
      for (let b = a; b < k; b++) {
        let kab = 0, mab = 0;
        const Kb = KZ[b], Mb = MZ[b], za = Z[a];
        for (let i = 0; i < n; i++) {
          kab += za[i] * Kb[i];
          mab += za[i] * Mb[i];
        }
        Kproj[a * k + b] = kab;
        Kproj[b * k + a] = kab;
        Mproj[a * k + b] = mab;
        Mproj[b * k + a] = mab;
      }
    }

    // 解小广义特征值问题：先对 Mproj 做 Cholesky，化为标准对称问题再 Jacobi
    const small = smallGeneralizedEigen(Kproj, Mproj, k);
    const newRitz = small.values;

    // 4) 由 Z 与小问题特征向量组合出新的 Ritz 向量
    const ritzVec: Float64Array[] = new Array(k);
    for (let j = 0; j < k; j++) {
      const v = new Float64Array(n);
      for (let a = 0; a < k; a++) {
        const ca = small.vectors[a * k + j];
        if (ca === 0) continue;
        for (let i = 0; i < n; i++) v[i] += ca * Z[a][i];
      }
      ritzVec[j] = v;
    }
    // ritzVec = Z·q_j，而 Z 已 M 正交归一、q_j 在 B=ZᵀMZ=I 下正交归一，
    // 故 ritzVec 自动 M 正交归一（仅数值漂移时偶尔重正交即可）。
    if (iter % 4 === 0) massOrthonormalize(M, ritzVec);

    // 阶段 1 → 阶段 2：初步拿到最低非零 Ritz 值后，把 σ 收紧到其 1e-3，
    // 重建求逆算子，使后续迭代严格锁定真实低频端（σ₀ 仅用于稳定起步）。
    if (!refined && iter >= 3) {
      let firstElastic = 0;
      for (const v of newRitz) {
        if (v > 1e-8 * Math.max(Math.abs(newRitz[newRitz.length - 1] ?? 0), 1)) { firstElastic = v; break; }
      }
      if (firstElastic > 0) {
        const sigmaNew = Math.min(sigmaCur, 1e-3 * firstElastic);
        // 只有在能显著减小 σ 且不小于零空间正则化下限时才重建
        if (sigmaNew < sigmaCur * 0.5) {
          sigmaCur = Math.max(sigmaNew, 1e-12 * ratioMin);
          shiftSolve = useDense
            ? makeDenseShiftSolver(K, M, sigmaCur)
            : makeSparseShiftSolver(K, M, sigmaCur, opts.rigidBasis ?? []);
        }
      }
      refined = true;
    }

    // 5) 收敛判定（前 count 个 Ritz 对，可能含 λ≈0 的刚体模态）：
    //  - 刚体/近零模态：|Δλ| < tol·λ_elastic1（首个弹性特征值尺度）即可；
    //  - 弹性模态：除特征值漂移外，还要求特征向量相对残差 < √tol，
    //    防止特征值先收敛、振型尚未收敛时提前停止。
    // σ 收紧（iter=3 触发）之前不下结论，避免被起步阶段的大 σ 偏置锁住。
    if (iter >= 4) {
      // 首个显著非零 Ritz 值作为「弹性尺度」
      let elastic1 = 0;
      for (const v of newRitz) {
        if (v > 1e-8 * Math.max(Math.abs(newRitz[newRitz.length - 1] ?? 0), 1)) { elastic1 = v; break; }
      }
      if (elastic1 === 0) elastic1 = Math.max(...newRitz.map(Math.abs), 1e-300);
      let allConv = true;
      for (let j = 0; j < Math.min(count, newRitz.length); j++) {
        const lam = Math.max(0, newRitz[j]);
        const drift = Math.abs(newRitz[j] - (ritz[j] ?? 0));
        const isRigidish = lam < 1e-8 * elastic1;
        if (isRigidish) {
          if (drift > tol * elastic1) { allConv = false; }
        } else {
          if (drift / lam > tol) { allConv = false; break; }
          const res = ritzResidual(K, M, ritzVec[j], lam);
          if (res > Math.sqrt(tol) * 10) { allConv = false; }
        }
      }
      ritz = newRitz;
      Q = ritzVec;
      ritzVectors = ritzVec;
      if (allConv) break;
    } else {
      ritz = newRitz;
      Q = ritzVec;
      ritzVectors = ritzVec;
    }
  }

  // 残差核算并按 λ 升序输出前 count 个。
  // 相对残差取 |Kφ−λMφ| / (|Kφ| + λ|Mφ|)，对刚体（λ≈0）模态也良定义。
  const pairs: EigenPair[] = [];
  residuals = [];
  for (let j = 0; j < Math.min(count, ritz.length); j++) {
    const phi = ritzVectors[j];
    const lam = Math.max(0, ritz[j]);
    const Kp = csrMultiply(K, phi);
    const Mp = csrMultiply(M, phi);
    let rr = 0, kk = 0, mm = 0;
    for (let i = 0; i < n; i++) {
      const d = Kp[i] - lam * Mp[i];
      rr += d * d;
      kk += Kp[i] * Kp[i];
      mm += Mp[i] * Mp[i];
    }
    const denom = Math.sqrt(kk) + lam * Math.sqrt(mm);
    const rel = denom > 0 ? Math.sqrt(rr) / denom : 0;
    pairs.push({ lambda: lam, vector: phi });
    residuals.push(Number.isFinite(rel) ? rel : 0);
  }

  return { pairs, iterations: iter, blockSize, residuals };
}

/** 单个 Ritz 对的相对残差 |Kφ−λMφ| / (|Kφ| + λ|Mφ|) */
function ritzResidual(K: SparseMatrix, M: SparseMatrix, phi: Float64Array, lam: number): number {
  const n = K.n;
  let rr = 0, kk = 0, mm = 0;
  for (let i = 0; i < n; i++) {
    let ki = 0, mi = 0;
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) ki += K.values[p] * phi[K.colIdx[p]];
    for (let p = M.rowPtr[i]; p < M.rowPtr[i + 1]; p++) mi += M.values[p] * phi[M.colIdx[p]];
    rr += (ki - lam * mi) ** 2;
    kk += ki * ki;
    mm += mi * mi;
  }
  const denom = Math.sqrt(kk) + lam * Math.sqrt(mm);
  return denom > 0 ? Math.sqrt(rr) / denom : 0;
}

/**
 * 关于 M 的修正 Gram–Schmidt 正交归一（带一次重正交）。
 * rigidBasis 非空时，先把每个向量投影到刚性子空间的 M 正交补。
 * 与 M 内积近零（退化）的向量会被原地置零，调用方应按零向量剔除。
 *
 * 实现上先一次性算出全部 M·V（避免在二重循环里反复做矩阵-向量乘），
 * 投影后增量维护 M·v，整体代价约 O(nnz(M)·k + n·k²)。
 */
export function massOrthonormalize(
  M: SparseMatrix,
  V: Float64Array[],
  rigidBasis: Float64Array[] | null = null,
): void {
  const n = M.n;
  const basis = rigidBasis ?? [];
  const Mrigid = basis.map((r) => csrMultiply(M, r));
  // 已接受（已 M 归一）列的 M·u
  const accM: Float64Array[] = [];

  for (let j = 0; j < V.length; j++) {
    const v = V[j];
    // 对刚性基 M 正交（两轮以稳健消除刚体分量）
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < basis.length; b++) {
        const r = basis[b], Mr = Mrigid[b];
        let c = 0;
        for (let i = 0; i < n; i++) c += v[i] * Mr[i];
        for (let i = 0; i < n; i++) v[i] -= c * r[i];
      }
    }
    // 修正 Gram–Schmidt：投影 + 一次重正交（重正交前重算 M·v）
    let Mv = csrMultiply(M, v);
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < j; q++) {
        const u = V[q], Mu = accM[q];
        let c = 0;
        for (let i = 0; i < n; i++) c += v[i] * Mu[i];
        for (let i = 0; i < n; i++) v[i] -= c * u[i];
        for (let i = 0; i < n; i++) Mv[i] -= c * Mu[i];
      }
      if (pass === 0) Mv = csrMultiply(M, v);
    }
    let nrmSq = 0;
    for (let i = 0; i < n; i++) nrmSq += v[i] * Mv[i];
    if (nrmSq < 1e-22 || !Number.isFinite(nrmSq)) {
      v.fill(0);
      Mv.fill(0);
      accM[j] = Mv;
      continue;
    }
    const inv = 1 / Math.sqrt(nrmSq);
    for (let i = 0; i < n; i++) { v[i] *= inv; Mv[i] *= inv; }
    accM[j] = Mv;
  }
}

/** 稠密移位求逆：对 (K+σM) 做一次稠密 LDLᵀ，之后反复回代 */
function makeDenseShiftSolver(K: SparseMatrix, M: SparseMatrix, sigma: number) {
  const n = K.n;
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
      A[i * n + K.colIdx[p]] += K.values[p];
    }
    for (let p = M.rowPtr[i]; p < M.rowPtr[i + 1]; p++) {
      A[i * n + M.colIdx[p]] += sigma * M.values[p];
    }
  }
  const { linSolve } = denseLDLT(A, n);
  return (b: Float64Array): Float64Array => linSolve(b);
}

/** 稠密 LDLᵀ 分解（允许近半定：σM 已保证正定），返回求解器 */
function denseLDLT(A: Float64Array, n: number) {
  const diag = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let djj = A[j * n + j];
    for (let k = 0; k < j; k++) djj -= A[j * n + k] * A[j * n + k] * diag[k];
    diag[j] = djj;
    const invD = 1 / djj;
    for (let i = j + 1; i < n; i++) {
      let lij = A[i * n + j];
      for (let k = 0; k < j; k++) lij -= A[i * n + k] * A[j * n + k] * diag[k];
      A[i * n + j] = lij * invD;
    }
  }
  const linSolve = (bIn: Float64Array): Float64Array => {
    const b = Float64Array.from(bIn);
    for (let i = 0; i < n; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= A[i * n + k] * b[k];
      b[i] = s;
    }
    for (let i = 0; i < n; i++) b[i] /= diag[i];
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let k = i + 1; k < n; k++) s -= A[k * n + i] * b[k];
      b[i] = s;
    }
    return b;
  };
  return { linSolve };
}

/**
 * 稀疏移位求逆：IC(0) 预处理共轭梯度求解
 *   (K + σM) y = b。
 * 不做刚性子空间投影（投影与不完全 Cholesky 预条件不相容，会导致 PCG 发散）；
 * 自由/欠约束结构由 σM 把刚体零空间正则化为正定，刚体模态最先被逆迭代
 * 放大并在顶层被识别剔除。σ 的选取见主函数（两阶段移位）。
 */
function makeSparseShiftSolver(
  K: SparseMatrix,
  M: SparseMatrix,
  sigma: number,
  _rigidBasis: Float64Array[],
): (b: Float64Array) => Float64Array {
  const n = K.n;
  // 组装 A = K + σM（保持 K 的 CSR 模式）
  const Avals = Float64Array.from(K.values);
  for (let i = 0; i < n; i++) {
    for (let p = M.rowPtr[i]; p < M.rowPtr[i + 1]; p++) {
      const col = M.colIdx[p];
      let lo = K.rowPtr[i], hi = K.rowPtr[i + 1] - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (K.colIdx[mid] === col) { Avals[mid] += sigma * M.values[p]; break; }
        if (K.colIdx[mid] < col) lo = mid + 1; else hi = mid - 1;
      }
    }
  }
  const A: SparseMatrix = { n, rowPtr: K.rowPtr, colIdx: K.colIdx, values: Avals, diagPos: K.diagPos };

  // IC(0) 不完全 Cholesky 预处理：2D 弹性问题下 PCG 迭代数几乎不随网格爆炸
  const { applyPrecond } = makeIC0Preconditioner(A);
  const amul = (x: Float64Array): Float64Array => csrMultiply(A, x);
  const nrm2 = (x: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * x[i];
    return Math.sqrt(s);
  };

  return (bIn: Float64Array): Float64Array => {
    const b = Float64Array.from(bIn);
    const x = new Float64Array(n);
    let Ax = amul(x);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = b[i] - Ax[i];
    let z = applyPrecond(r);
    const p = Float64Array.from(z);
    let rz = dot(r, z);
    const bnorm = nrm2(b) || 1;

    // 外层逆迭代要求内解很准，取 1e-12 相对残差
    for (let it = 0; it < 60000; it++) {
      if (nrm2(r) / bnorm < 1e-12) break;
      const Ap = amul(p);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (!(pAp > 0) || !Number.isFinite(pAp)) {
        // 罕见数值崩溃：以 Jacobi 重启
        z = new Float64Array(n);
        for (let i = 0; i < n; i++) z[i] = r[i] / Avals[A.diagPos[i]];
        for (let i = 0; i < n; i++) p[i] = z[i];
        rz = dot(r, z);
        continue;
      }
      const alpha = rz / pAp;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
      const znew = applyPrecond(r);
      let rzNew = 0;
      for (let i = 0; i < n; i++) rzNew += r[i] * znew[i];
      const beta = rzNew / rz;
      for (let i = 0; i < n; i++) p[i] = znew[i] + beta * p[i];
      rz = rzNew;
      z = znew;
    }
    return x;
  };
}

/**
 * IC(0) 不完全 Cholesky（零填充，L·D·Lᵀ 形式）：只在 A 的下三角已有
 * 稀疏位置上分解 A ≈ L·D·Lᵀ（L 单位下三角）。
 *   l_ij = (a_ij − Σ_{k<j,(i,k),(j,k)∈S} l_ik d_k l_jk) / d_j
 *   d_i  = a_ii − Σ_{k<i,(i,k)∈S} l_ik² d_k
 * 对角加正性保护（必要时做小幅对角增强）。
 * 返回预条件作用 z = (L D Lᵀ)⁻¹ r（前代 + 对角 + 后代）。
 */
function makeIC0Preconditioner(A: SparseMatrix): { applyPrecond: (r: Float64Array) => Float64Array } {
  const n = A.n;
  const { rowPtr, colIdx } = A;
  // L 的下三角数值（单位对角），与 A 同一 CSR 位置；对角行只留 d[]
  const Lv = Float64Array.from(A.values);

  const locate = (i: number, j: number): number => {
    let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (colIdx[mid] === j) return mid;
      if (colIdx[mid] < j) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };
  let diagScale = 0;
  for (let i = 0; i < n; i++) diagScale = Math.max(diagScale, Math.abs(A.values[A.diagPos[i]]));
  const minPivot = diagScale * 1e-10;

  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // 先算该行各下三角 l_ij（j 升序，依赖已完成的行与 d）
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const j = colIdx[p];
      if (j >= i) continue;
      let sum = A.values[p];
      // Σ_{k<j 且 (i,k)、(j,k) 都在模式内} l_ik d_k l_jk
      for (let q = rowPtr[i]; q < rowPtr[i + 1]; q++) {
        const k = colIdx[q];
        if (k >= j) break; // 行内列升序
        const lik = Lv[q];
        const ljkPos = locate(j, k);
        if (ljkPos >= 0) sum -= lik * d[k] * Lv[ljkPos];
      }
      Lv[p] = sum / d[j];
    }
    // d_i = a_ii − Σ_{k<i,(i,k)} l_ik² d_k
    let dacc = A.values[A.diagPos[i]];
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const k = colIdx[p];
      if (k < i) dacc -= Lv[p] * Lv[p] * d[k];
    }
    d[i] = dacc > minPivot ? dacc : minPivot;
  }

  return {
    applyPrecond(rhs: Float64Array): Float64Array {
      // 前代 L y = r（L 单位下三角）
      const y = Float64Array.from(rhs);
      for (let i = 0; i < n; i++) {
        let s = y[i];
        for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
          if (colIdx[p] < i) s -= Lv[p] * y[colIdx[p]];
        }
        y[i] = s;
      }
      for (let i = 0; i < n; i++) y[i] /= d[i];
      // 后代 Lᵀ z = y
      for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
          const j = colIdx[p];
          if (j > i) {
            const q = locate(j, i); // L[j,i]
            if (q >= 0) s -= Lv[q] * y[j];
          }
        }
        y[i] = s;
      }
      return y;
    },
  };
}

/**
 * 小规模稠密广义对称特征值问题 A q = μ B q（B 正定）：
 * Cholesky B = L·Lᵀ → C = L⁻¹·A·L⁻ᵀ 标准对称问题 → 循环 Jacobi。
 * 返回升序特征值与对应（原广义问题的）特征向量。
 */
export function smallGeneralizedEigen(
  A: Float64Array,
  B: Float64Array,
  n: number,
): { values: number[]; vectors: Float64Array } {
  // Cholesky B = L Lᵀ（下三角 L）
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = j; i < n; i++) {
      let s = B[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + j] = Math.sqrt(Math.max(s, 1e-300));
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  // Linv = L⁻¹
  const Linv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    Linv[i * n + i] = 1 / L[i * n + i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s += L[i * n + k] * Linv[k * n + j];
      Linv[i * n + j] = -s / L[i * n + i];
    }
  }
  // C = Linv · A · Linvᵀ
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let a = 0; a < n; a++) {
        if (Linv[i * n + a] === 0) continue;
        for (let b = 0; b < n; b++) {
          s += Linv[i * n + a] * A[a * n + b] * Linv[j * n + b];
        }
      }
      C[i * n + j] = s;
    }
  }
  const { values, vectors: z } = jacobiSymmetric(C, n);
  // 广义特征向量 q = Linvᵀ · z
  const q = new Float64Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = i; k < n; k++) s += Linv[k * n + i] * z[k * n + col];
      q[i * n + col] = s;
    }
  }
  return { values, vectors: q };
}

/** 实对称矩阵循环 Jacobi 特征值分解，返回升序特征值与特征向量（列） */
export function jacobiSymmetric(A: Float64Array, n: number): { values: number[]; vectors: Float64Array } {
  const a = Float64Array.from(A);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;

  for (let sweep = 0; sweep < 120; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off < 1e-26) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = a[p * n + p], aqq = a[q * n + q];
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        a[p * n + p] = app - t * apq;
        a[q * n + q] = aqq + t * apq;
        a[p * n + q] = 0;
        a[q * n + p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[p * n + k] = a[k * n + p];
          a[k * n + q] = s * akp + c * akq;
          a[q * n + k] = a[k * n + q];
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((i, j) => a[i * n + i] - a[j * n + j]);
  const values = idx.map((i) => a[i * n + i]);
  const vectors = new Float64Array(n * n);
  for (let col = 0; col < n; col++) {
    for (let k = 0; k < n; k++) vectors[k * n + col] = V[k * n + idx[col]];
  }
  return { values, vectors };
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 确定性伪随机数发生器（mulberry32），让特征值结果可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
