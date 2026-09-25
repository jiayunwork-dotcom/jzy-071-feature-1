/**
 * 自由振动分析流水线（与静力 analyze 平级的独立分析类型）：
 *
 *   装配 K、M → 按自由度约束做自由度缩减（被锁方向不参与振动）
 *   → 几何刚体模态识别（欠约束结构的零频平移/转动，从结果中剔除）
 *   → 移位-求逆子空间迭代求最低若干阶弹性模态
 *   → 质量归一化、Rayleigh 商自洽性/正交性核验。
 *
 * 求解广义特征值问题 (K − ω²M)φ = 0，给出按 ω 升序排列的弹性模态。
 */
import type {
  FemModel,
  VibrationOptions,
  VibrationResult,
  VibrationMode,
} from './types.js';
import { assembleStiffness, assembleMass, csrMultiply, type SparseMatrix } from './assembly.js';
import { snapTolerance } from './analyze.js';
import { resolveSupports } from './conditions.js';
import { materialDensity } from './material.js';
import {
  solveLowestGeneralized,
  massOrthonormalize,
  smallGeneralizedEigen,
} from './eigen.js';

/** 由全局 CSR 矩阵抽取自由自由度上的子矩阵（保留 CSR 结构） */
export function reduceMatrix(A: SparseMatrix, freeMap: Int32Array, nFree: number): SparseMatrix {
  // local → global 逆映射
  const inv = new Int32Array(nFree);
  for (let g = 0; g < freeMap.length; g++) if (freeMap[g] >= 0) inv[freeMap[g]] = g;

  // 先统计每行落在自由自由度上的非零数
  const rowPtr = new Int32Array(nFree + 1);
  let nnz = 0;
  for (let li = 0; li < nFree; li++) {
    rowPtr[li] = nnz;
    const grow = inv[li];
    for (let p = A.rowPtr[grow]; p < A.rowPtr[grow + 1]; p++) {
      if (freeMap[A.colIdx[p]] >= 0) nnz++;
    }
  }
  rowPtr[nFree] = nnz;
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  const diagPos = new Int32Array(nFree);
  let q = 0;
  for (let li = 0; li < nFree; li++) {
    const grow = inv[li];
    for (let p = A.rowPtr[grow]; p < A.rowPtr[grow + 1]; p++) {
      const lj = freeMap[A.colIdx[p]];
      if (lj < 0) continue;
      colIdx[q] = lj;
      values[q] = A.values[p];
      if (lj === li) diagPos[li] = q;
      q++;
    }
  }
  return { n: nFree, rowPtr, colIdx, values, diagPos };
}

/**
 * 用二维刚体运动的三个候选向量（x 平移、y 平移、绕原点转动）
 * 识别缩减系统中实际存在的零能模态：
 * 从候选向量出发做 M 正交化，再对其张成的小子空间解广义特征值问题，
 * λ 近零者即为结构的刚体模态（自由/欠约束结构）。
 * 返回关于 M 正交归一的刚体基（缩减坐标）。
 */
export function detectRigidModes(
  Kc: SparseMatrix,
  Mc: SparseMatrix,
  nodesGlobal: { x: number; y: number }[],
  freeMap: Int32Array,
  rigidTol = 1e-7,
): { basis: Float64Array[]; eigenvalues: number[]; scale: number } {
  const n = Kc.n;
  // 特征值尺度：取 K、M 对角比的最大值（= 最高频量级）
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const kii = Math.abs(Kc.values[Kc.diagPos[i]]);
    const mii = Math.abs(Mc.values[Mc.diagPos[i]]);
    if (mii > 0) scale = Math.max(scale, kii / mii);
  }

  // 三个全局刚体候选：tx=(1,0)，ty=(0,1)，r=(-y,x)
  const candidatesGlobal: Float64Array[] = [
    new Float64Array(nodesGlobal.length * 2),
    new Float64Array(nodesGlobal.length * 2),
    new Float64Array(nodesGlobal.length * 2),
  ];
  nodesGlobal.forEach((p, i) => {
    candidatesGlobal[0][2 * i] = 1;
    candidatesGlobal[1][2 * i + 1] = 1;
    candidatesGlobal[2][2 * i] = -p.y;
    candidatesGlobal[2][2 * i + 1] = p.x;
  });

  // 逐个候选做 M-Gram–Schmidt：与已接受方向（在 M 内积下）近线性相关者丢弃。
  // 这样固定边把某个刚体运动整体锁死时，对应候选会被正确剔除而不影响其余。
  const alive: Float64Array[] = [];
  for (const cg of candidatesGlobal) {
    const v = new Float64Array(n);
    for (let g = 0; g < freeMap.length; g++) {
      if (freeMap[g] >= 0) v[freeMap[g]] = cg[g];
    }
    let self = 0;
    const Mv0 = csrMultiply(Mc, v);
    for (let i = 0; i < n; i++) self += v[i] * Mv0[i];
    if (self <= 1e-24) continue;
    // 对已接受刚体方向 M 正交
    for (const u of alive) {
      let c = 0;
      const Mu = csrMultiply(Mc, u);
      for (let i = 0; i < n; i++) c += v[i] * Mu[i];
      for (let i = 0; i < n; i++) v[i] -= c * u[i];
    }
    let rem = 0;
    const Mv1 = csrMultiply(Mc, v);
    for (let i = 0; i < n; i++) rem += v[i] * Mv1[i];
    if (rem <= 1e-10 * self) continue; // 该刚体运动已被约束整体消除
    const inv = 1 / Math.sqrt(rem);
    for (let i = 0; i < n; i++) v[i] *= inv;
    alive.push(v);
  }
  if (alive.length === 0) return { basis: [], eigenvalues: [], scale };

  // 在候选子空间上投影 K、M（alive 已 M 正交归一，Mr≈I，仍显式计算以稳健处理相关性）
  const r = alive.length;
  const Kr = new Float64Array(r * r);
  const Mr = new Float64Array(r * r);
  const Kv: Float64Array[] = alive.map((v) => csrMultiply(Kc, v));
  const Mv: Float64Array[] = alive.map((v) => csrMultiply(Mc, v));
  for (let a = 0; a < r; a++) {
    for (let b = a; b < r; b++) {
      let kab = 0, mab = 0;
      for (let i = 0; i < n; i++) {
        kab += alive[a][i] * Kv[b][i];
        mab += alive[a][i] * Mv[b][i];
      }
      Kr[a * r + b] = kab; Kr[b * r + a] = kab;
      Mr[a * r + b] = mab; Mr[b * r + a] = mab;
    }
  }
  const small = smallGeneralizedEigen(Kr, Mr, r);

  // λ 近零（相对最高频尺度）的组合为刚体模态
  const basis: Float64Array[] = [];
  const eigs: number[] = [];
  for (let j = 0; j < r; j++) {
    const lam = small.values[j];
    if (Math.abs(lam) < rigidTol * Math.max(scale, 1e-300)) {
      const v = new Float64Array(n);
      for (let a = 0; a < r; a++) {
        const ca = small.vectors[a * r + j];
        for (let i = 0; i < n; i++) v[i] += ca * alive[a][i];
      }
      // 再次 M 归一（小问题特征向量在 B 内积下已归一，保险起见）
      massOrthonormalize(Mc, [v]);
      if (v.some((x) => x !== 0)) {
        basis.push(v);
        eigs.push(lam);
      }
    }
  }
  return { basis, eigenvalues: eigs, scale };
}

/**
 * 自由振动分析主入口。
 * 与静力 analyze 共用同一网格、材料与约束解析；不读取任何外载荷。
 */
export function analyzeVibration(model: FemModel, opts: VibrationOptions = {}): VibrationResult {
  const tol = snapTolerance(model);
  const prescribed = resolveSupports(model.mesh, model.supports, tol);

  const ndof = model.mesh.nodes.length * 2;
  const constrained = new Set<number>(prescribed.keys());
  const freeMap = new Int32Array(ndof).fill(-1);
  const invMap: number[] = [];
  for (let g = 0; g < ndof; g++) {
    if (!constrained.has(g)) {
      freeMap[g] = invMap.length;
      invMap.push(g);
    }
  }
  const nFree = invMap.length;

  if (nFree === 0) {
    return {
      modes: [],
      massMatrixType: opts.massMatrix ?? 'consistent',
      constrainedDofs: constrained.size,
      rigidBodyModes: 0,
      freeDofs: 0,
      diagnostics: {
        iterations: 0,
        tolerance: opts.tolerance ?? 1e-10,
        maxCrossOrthogonality: 0,
        totalMass: 0,
      },
    };
  }

  // 装配 K、M（同一自由度排布），并缩减到自由自由度
  const Kfull = assembleStiffness(model);
  const Mfull = assembleMass(model, opts.massMatrix ?? 'consistent');
  const Kc = reduceMatrix(Kfull, freeMap, nFree);
  const Mc = reduceMatrix(Mfull, freeMap, nFree);

  // 总质量：M 作用在 x 向全 1 向量上的合力 = ρ·V·t。
  // 不能只加对角——一致质量矩阵有一半质量在非对角元上。
  const onesX = new Float64Array(Mfull.n);
  for (let i = 0; i < Mfull.n; i += 2) onesX[i] = 1;
  let totalMass = 0;
  const Mones = csrMultiply(Mfull, onesX);
  for (let i = 0; i < Mfull.n; i += 2) totalMass += Mones[i];

  // 刚体模态识别（欠约束结构）
  const rigid = detectRigidModes(Kc, Mc, model.mesh.nodes, freeMap);
  const rigidCount = rigid.basis.length;

  const want = opts.modeCount ?? 6;
  // 子空间求解目标数 = 用户要的弹性阶数 + 刚体阶数（刚体最先收敛，输出时跳过）
  const targetCount = Math.min(nFree, want + rigidCount);

  const solved = solveLowestGeneralized(Kc, Mc, {
    count: targetCount,
    tolerance: opts.tolerance ?? 1e-10,
    maxIterations: opts.maxIterations ?? 200,
    denseThreshold: opts.denseThreshold ?? 1100,
    rigidBasis: rigid.basis,
  });

  // 取结果：移位-求逆下零（刚体）特征值最先收敛，且其数量已由几何识别确定，
  // 因此升序后恰好跳过前 rigidCount 阶即为弹性模态。
  // 不再用「相对最高频尺度」的绝对阈值——CST 的寄生高频会把该尺度抬得过高。
  const ordered = solved.pairs
    .map((pr, idx) => ({ pr, res: solved.residuals[idx] }))
    .sort((a, b) => a.pr.lambda - b.pr.lambda);

  // 用谱结果对几何识别出的刚体阶数做一次校正：
  // 前 rigidCount 阶 λ 必须相对「第 rigidCount 阶之后的首个候选弹性 λ」
  // 全部近零（刚体 λ 之间彼此可能差几个数量级，不能拿相邻刚体 λ 互比）。
  // 若几何识别多算了（理论上不会），据谱把阈值之外的阶数还给弹性集合。
  let actualRigid = Math.min(rigidCount, ordered.length);
  const elasticAnchor = ordered[rigidCount]?.pr.lambda
    ?? ordered[ordered.length - 1]?.pr.lambda
    ?? 1;
  const anchorScale = Math.max(elasticAnchor, 1e-300);
  for (let j = 0; j < actualRigid; j++) {
    if (ordered[j].pr.lambda > 1e-3 * anchorScale) {
      actualRigid = j;
      break;
    }
  }
  const elastic = ordered.slice(actualRigid, actualRigid + want);

  // 提升到全局向量并做质量归一（缩减向量已是 M_c 单位，嵌入零即保持全局 M 单位）
  const modes: VibrationMode[] = elastic.map((item, order) => {
    const { lambda, vector: vc } = item.pr;
    const phi = new Float64Array(ndof);
    for (let li = 0; li < nFree; li++) phi[invMap[li]] = vc[li];
    const omega = Math.sqrt(Math.max(0, lambda));

    // 振型动能的方向占比（区分纵向/横向模态）
    let tx = 0, ty = 0;
    model.mesh.nodes.forEach((_, ni) => {
      const mxx = Mfull.values[Mfull.diagPos[2 * ni]];
      const myy = Mfull.values[Mfull.diagPos[2 * ni + 1]];
      tx += mxx * phi[2 * ni] * phi[2 * ni];
      ty += myy * phi[2 * ni + 1] * phi[2 * ni + 1];
    });
    return {
      order: order + 1,
      omega,
      frequencyHz: omega / (2 * Math.PI),
      shape: phi,
      xKineticFraction: tx + ty > 0 ? tx / (tx + ty) : 0,
      residual: item.res,
    };
  });

  // 模态间质量正交性核验（|φ_iᵀ M φ_j|，归一化后应≈0）
  let maxCross = 0;
  for (let a = 0; a < modes.length; a++) {
    const Ma = csrMultiply(Mfull, modes[a].shape);
    for (let b = a; b < modes.length; b++) {
      let s = 0;
      for (let i = 0; i < ndof; i++) s += modes[b].shape[i] * Ma[i];
      const expect = a === b ? 1 : 0;
      maxCross = Math.max(maxCross, Math.abs(s - expect));
    }
  }

  return {
    modes,
    massMatrixType: opts.massMatrix ?? 'consistent',
    constrainedDofs: constrained.size,
    rigidBodyModes: actualRigid,
    freeDofs: nFree,
    diagnostics: {
      iterations: solved.iterations,
      tolerance: opts.tolerance ?? 1e-10,
      maxCrossOrthogonality: maxCross,
      totalMass,
    },
  };
}

/** 几何总体积（面积×厚）与理论总质量，供测试/界面核对 */
export function theoreticalTotalMass(model: FemModel): number {
  let area = 0;
  for (const [a, b, c] of model.mesh.elements) {
    const p0 = model.mesh.nodes[a], p1 = model.mesh.nodes[b], p2 = model.mesh.nodes[c];
    area += Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2;
  }
  return materialDensity(model.material) * model.material.thickness * area;
}
