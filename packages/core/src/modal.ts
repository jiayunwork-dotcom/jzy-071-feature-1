/**
 * 自由振动分析流水线（与静力 analyze 平级的独立能力）：
 *
 *   装配 K、M → 按自由度约束缩减（消去被固定/滑移锁住的方向）
 *   → 解广义特征值问题 (K − ω²M)φ = 0 → 识别并剔除刚体模态
 *   → 振型质量归一化、残差与 Rayleigh 商核验 → 频率换算。
 *
 * 约束在缩减系统上处理而不是事后修补：被约束自由度不参与特征值求解，
 * 因而不会出现「沿被锁住方向」的假模态；约束不足留下的真实刚体模态
 * （λ≈0）则由阈值识别后剔除，只保留弹性模态。
 */
import type {
  FemModel,
  MassFormulation,
  ModalAnalysisResult,
  ModeShape,
} from './types.js';
import { SingularMatrixError } from './types.js';
import { assembleStiffness, csrMultiply, type SparseMatrix } from './assembly.js';
import { assembleMass, totalMass } from './mass.js';
import { resolveSupports } from './conditions.js';
import { snapTolerance } from './analyze.js';
import {
  mDot,
  massNormalizeInPlace,
  orientSign,
  solveGeneralEigen,
} from './eigensolver.js';

export interface ModalOptions {
  /** 所求弹性模态阶数，默认 6 */
  modes?: number;
  massFormulation?: MassFormulation;
  /** 刚体模态判定：λ < tol·λmax 视为刚体（零能）模态 */
  rigidRelTol?: number;
  denseThreshold?: number;
}

/** 自由振动分析入口 */
export function analyzeModes(model: FemModel, opts: ModalOptions = {}): ModalAnalysisResult {
  const want = opts.modes ?? 6;
  const formulation: MassFormulation = opts.massFormulation ?? 'consistent';
  const rigidRelTol = opts.rigidRelTol ?? 1e-7;

  const tol = snapTolerance(model);
  const prescribed = resolveSupports(model.mesh, model.supports, tol);

  const ndof = model.mesh.nodes.length * 2;
  if (prescribed.size >= ndof) {
    throw new SingularMatrixError('所有自由度都被约束，结构无法振动：请至少留出一个可自由变形的方向。');
  }

  // 装配全新矩阵，不改动静力流程中的任何数据
  const Kfull = assembleStiffness(model);
  const Mfull = assembleMass(model, formulation);

  // 自由自由度映射（与约束严格对齐）
  const globalToFree = new Int32Array(ndof).fill(-1);
  const freeDofList: number[] = [];
  for (let i = 0; i < ndof; i++) {
    if (!prescribed.has(i)) {
      globalToFree[i] = freeDofList.length;
      freeDofList.push(i);
    }
  }
  const nf = freeDofList.length;

  const Kr = reduceMatrix(Kfull, freeDofList, globalToFree);
  const Mr = reduceMatrix(Mfull, freeDofList, globalToFree);

  if (want > nf) {
    throw new SingularMatrixError(
      `请求 ${want} 阶模态，但缩减系统只有 ${nf} 个自由自由度（最多 ${nf} 阶）。` +
        '请加密网格（增加节点）或减少所求阶数。',
    );
  }

  const solved = solveGeneralEigen(Kr, Mr, {
    wantModes: want,
    rigidRelTol,
    denseThreshold: opts.denseThreshold,
  });

  // 刚体模态识别阈值（用本系统最大特征值做尺度参照）
  let lambdaMax = 0;
  for (const p of solved.pairs) lambdaMax = Math.max(lambdaMax, p.lambda);
  const rigidCut = rigidRelTol * lambdaMax;
  const elastic = solved.pairs.filter((p) => p.lambda > rigidCut);

  // 子空间迭代路径可能只捞出 p 个 Ritz 对；正常 p > want + 刚体数，这里做防护
  const chosen = elastic.slice(0, want);

  const modes: ModeShape[] = chosen.map((pair, idx) => {
    // 残差必须在缩减（自由）自由度上核验：
    // 被约束自由度上 Kφ 给出的是约束反力，不满足 Kφ = λMφ（那里 φ=0）。
    const Kpr = csrMultiply(Kr, pair.vector);
    const Mpr = csrMultiply(Mr, pair.vector);
    let rNum = 0, kNorm = 0;
    for (let i = 0; i < nf; i++) {
      const r = Kpr[i] - pair.lambda * Mpr[i];
      rNum += r * r;
      kNorm += Kpr[i] * Kpr[i];
    }
    const rqReduced = mDot(Kr, pair.vector, pair.vector) / mDot(Mr, pair.vector, pair.vector);

    // 扩展回完整自由度空间，被约束方向恒为 0
    const phiFull = new Float64Array(ndof);
    for (let f = 0; f < nf; f++) phiFull[freeDofList[f]] = pair.vector[f];

    // 用完整整体矩阵重新质量归一化（与缩减系统等价，同时核验 M 正定性）
    massNormalizeInPlace(phiFull, Mfull);
    orientSign(phiFull);

    const omega = Math.sqrt(Math.max(0, pair.lambda));

    return {
      order: idx + 1,
      omega,
      hz: omega / (2 * Math.PI),
      lambda: pair.lambda,
      vector: phiFull,
      residual: Math.sqrt(rNum) / (Math.sqrt(kNorm) || 1),
      rayleighQuotient: rqReduced,
    };
  });

  return {
    modes,
    rigidBodyModes: solved.pairs.length - elastic.length,
    freeDofs: nf,
    constrainedDofs: prescribed.size,
    massFormulation: formulation,
    totalMass: totalMass(Mfull),
    diagnostics: {
      solver: solved.solver,
      iterations: solved.iterations,
    },
  };
}

/** 取整体矩阵在自由自由度上的缩减子矩阵（保持 CSR 结构与对称性） */
export function reduceMatrix(
  A: SparseMatrix,
  freeDofs: number[],
  globalToFree: Int32Array,
): SparseMatrix {
  const n = freeDofs.length;
  // 先收集列
  const colsPerRow: number[][] = Array.from({ length: n }, () => []);
  const valsPerRow: number[][] = Array.from({ length: n }, () => []);
  for (let fi = 0; fi < n; fi++) {
    const gi = freeDofs[fi];
    for (let p = A.rowPtr[gi]; p < A.rowPtr[gi + 1]; p++) {
      const fj = globalToFree[A.colIdx[p]];
      if (fj >= 0) {
        colsPerRow[fi].push(fj);
        valsPerRow[fi].push(A.values[p]);
      }
    }
  }
  let nnz = 0;
  for (let i = 0; i < n; i++) nnz += colsPerRow[i].length;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  const diagPos = new Int32Array(n);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = pos;
    // 列索引可能乱序（原 CSR 有序，但删列后仍有序，稳妥起见排序）
    const order = [...colsPerRow[i].keys()].sort((a, b) => colsPerRow[i][a] - colsPerRow[i][b]);
    for (const k of order) {
      colIdx[pos] = colsPerRow[i][k];
      values[pos] = valsPerRow[i][k];
      if (colsPerRow[i][k] === i) diagPos[i] = pos;
      pos++;
    }
  }
  rowPtr[n] = pos;
  return { n, rowPtr, colIdx, values, diagPos };
}
