/**
 * 整体刚度矩阵装配。
 * 采用稀疏 CSR 结构：K 对称，装配时先按上三角 (i<=j) 累加，
 * 再把非对角项镜像到下三角。
 */
import type { FemModel } from './types.js';
import { createCst, elementStiffness } from './element.js';
import { constitutiveMatrix, effectiveThickness } from './material.js';

export interface SparseMatrix {
  n: number;
  /** CSR：行指针、列索引、数值 */
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
  /** 对角元在 values 中的位置（方便快速取/改） */
  diagPos: Int32Array;
}

/** 装配整体刚度矩阵（稀疏 CSR） */
export function assembleStiffness(model: FemModel): SparseMatrix {
  const { mesh, material } = model;
  const n = mesh.nodes.length * 2;
  const D = constitutiveMatrix(material);
  const t = effectiveThickness(material);

  // 先建立上三角稀疏模式
  const pattern: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) pattern[i].add(i);

  for (const tri of mesh.elements) {
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = a; b < 6; b++) {
        const i = dofs[a], j = dofs[b];
        if (i <= j) pattern[i].add(j);
        else pattern[j].add(i);
      }
    }
  }

  // 转 CSR
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

  // 累加单元刚度（上三角）
  for (const tri of mesh.elements) {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    const Ke = elementStiffness(elem, D, t);
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = a; b < 6; b++) {
        const i = dofs[a], j = dofs[b];
        let r = i, c = j;
        if (r > c) [r, c] = [c, r];
        const pos = locateEntry(rowPtr, colIdx, r, c);
        values[pos] += Ke[a * 6 + b];
      }
    }
  }

  // 镜像到下三角（数值求解需要完整矩阵；对称存储也可，但 CSR 乘向量更直接）
  // 重新分配完整 CSR
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
      if (i <= c) {
        fullVal[p] = values[locateEntry(rowPtr, colIdx, i, c)];
      } else {
        fullVal[p] = values[locateEntry(rowPtr, colIdx, c, i)];
      }
      p++;
    }
  }

  return { n, rowPtr: fullRowPtr, colIdx: fullCol, values: fullVal, diagPos: fullDiag };
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
    }    for (let p = K.rowPtr[dof]; p < K.rowPtr[dof + 1]; p++) {
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
