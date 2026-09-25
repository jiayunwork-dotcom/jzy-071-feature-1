/**
 * 整体矩阵装配（刚度 K 与质量 M 共用同一套自由度编号与 CSR 组织方式）。
 * 采用稀疏 CSR 结构：矩阵对称，装配时先按上三角 (i<=j) 累加，
 * 再把非对角项镜像到下三角。
 */
import type { FemModel } from './types.js';
import { createCst, elementStiffness, elementConsistentMass, elementLumpedMass } from './element.js';
import { constitutiveMatrix, effectiveThickness, materialDensity } from './material.js';

export interface SparseMatrix {
  n: number;
  /** CSR：行指针、列索引、数值 */
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
  /** 对角元在 values 中的位置（方便快速取/改） */
  diagPos: Int32Array;
}

/** 单元 → 6×6 单元矩阵（行主序）的提供者 */
type ElementMatrixProvider = (
  tri: [number, number, number],
) => Float64Array;

/**
 * 对称整体矩阵的通用装配：
 * 1) 扫描全部单元建立完整（上下三角）稀疏模式；
 * 2) 逐单元把 6×6 单元矩阵按自由度编号 (2n, 2n+1) 累加；
 * 3) 非对角项镜像，得到对称 CSR。
 *
 * 刚度与质量矩阵都走这里，保证二者自由度排布严格对齐。
 */
function assembleSymmetricMatrix(n: number, elements: (readonly [number, number, number])[], provide: ElementMatrixProvider): SparseMatrix {
  // 完整对称稀疏模式（上下三角都建立，避免二次重排）
  const pattern: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) pattern[i].add(i);

  for (const tri of elements) {
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const i = dofs[a], j = dofs[b];
        const lo = i <= j ? i : j;
        const hi = i <= j ? j : i;
        pattern[lo].add(hi);
      }
    }
  }

  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz;
    nnz += pattern[i].size;
  }
  rowPtr[n] = nnz;
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  const diagPos = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cols = [...pattern[i]].sort((a, b) => a - b);
    let p = rowPtr[i];
    for (const c of cols) {
      colIdx[p] = c;
      if (c === i) diagPos[i] = p;
      p++;
    }
  }

  // 累加单元矩阵的上三角（a<=b），按自由度对的 (lo,hi) 存入对称存储；
  // 展开为完整 CSR 时再镜像，非对角元不会被重复计数
  for (const tri of elements) {
    const Me = provide(tri as [number, number, number]);
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = a; b < 6; b++) {
        const i = dofs[a], j = dofs[b];
        const lo = i <= j ? i : j;
        const hi = i <= j ? j : i;
        values[locateEntry(rowPtr, colIdx, lo, hi)] += Me[a * 6 + b];
      }
    }
  }

  // 展开为完整 CSR（数值求解需要完整矩阵；CSR 乘向量更直接）
  const fullPattern: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) {
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const j = colIdx[p];
      fullPattern[i].add(j);
      if (i !== j) fullPattern[j].add(i);
    }
  }
  const fullRowPtr = new Int32Array(n + 1);
  let fullNnz = 0;
  for (let i = 0; i < n; i++) {
    fullRowPtr[i] = fullNnz;
    fullNnz += fullPattern[i].size;
  }
  fullRowPtr[n] = fullNnz;
  const fullCol = new Int32Array(fullNnz);
  const fullVal = new Float64Array(fullNnz);
  const fullDiag = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cols = [...fullPattern[i]].sort((a, b) => a - b);
    let p = fullRowPtr[i];
    for (const c of cols) {
      fullCol[p] = c;
      if (c === i) fullDiag[i] = p;
      fullVal[p] = i <= c
        ? values[locateEntry(rowPtr, colIdx, i, c)]
        : values[locateEntry(rowPtr, colIdx, c, i)];
      p++;
    }
  }

  return { n, rowPtr: fullRowPtr, colIdx: fullCol, values: fullVal, diagPos: fullDiag };
}

/** 装配整体刚度矩阵（稀疏 CSR） */
export function assembleStiffness(model: FemModel): SparseMatrix {
  const { mesh, material } = model;
  const n = mesh.nodes.length * 2;
  const D = constitutiveMatrix(material);
  const t = effectiveThickness(material);

  return assembleSymmetricMatrix(n, mesh.elements as [number, number, number][], (tri) => {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    return elementStiffness(elem, D, t);
  });
}

/**
 * 装配整体质量矩阵（稀疏 CSR），自由度排布与刚度矩阵完全一致。
 * - consistent：单元一致质量（非对角，含单元内耦合）；
 * - lumped：集中质量（纯对角）。
 */
export function assembleMass(
  model: FemModel,
  kind: 'consistent' | 'lumped' = 'consistent',
): SparseMatrix {
  const { mesh, material } = model;
  const n = mesh.nodes.length * 2;
  const rho = materialDensity(material);
  const t = effectiveThickness(material);

  return assembleSymmetricMatrix(n, mesh.elements as [number, number, number][], (tri) => {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    return kind === 'lumped'
      ? elementLumpedMass(elem, rho, t)
      : elementConsistentMass(elem, rho, t);
  });
}

/** 在 CSR 矩阵中定位 (i, j)，不存在时返回 -1 */
function locateEntry(rowPtr: Int32Array, colIdx: Int32Array, i: number, j: number): number {
  // 行不长时直接扫描；二分更稳
  let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (colIdx[mid] === j) return mid;
    if (colIdx[mid] < j) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** CSR 稀疏矩阵乘向量 y = A·x */
export function csrMultiply(A: SparseMatrix, x: Float64Array): Float64Array {
  const y = new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) {
    let s = 0;
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      s += A.values[p] * x[A.colIdx[p]];
    }
    y[i] = s;
  }
  return y;
}

/** 施加零位移边界条件：被约束行/列清零、对角置 1，并把对应载荷置 0 */
export function applyBoundaryConditions(
  K: SparseMatrix,
  F: Float64Array,
  prescribed: Map<number, number>,
): void {
  for (const [dof, val] of prescribed) {
    // 先从所有未约束行减去该列贡献（保持对称）：K[i][dof]*val
    if (val !== 0) {
      for (let i = 0; i < K.n; i++) {
        if (prescribed.has(i)) continue;
        const pos = locateEntry(K.rowPtr, K.colIdx, i, dof);
        if (pos >= 0) F[i] -= K.values[pos] * val;
      }
    }
    for (let p = K.rowPtr[dof]; p < K.rowPtr[dof + 1]; p++) {
      K.values[p] = K.colIdx[p] === dof ? 1 : 0;
    }
    // 对称列清零
    for (let i = 0; i < K.n; i++) {
      if (i === dof) continue;
      let lo = K.rowPtr[i], hi = K.rowPtr[i + 1] - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (K.colIdx[mid] === dof) {
          K.values[mid] = 0;
          break;
        }
        if (K.colIdx[mid] < dof) lo = mid + 1;
        else hi = mid - 1;
      }
    }
    F[dof] = val;
  }
}
