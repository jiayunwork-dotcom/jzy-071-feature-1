/**
 * 整体质量矩阵装配。
 *
 * 与整体刚度矩阵（assembly.ts）严格复用同一套自由度编号：
 * 节点 i 对应自由度 (2i, 2i+1)，同样使用 CSR 稀疏存储，
 * 保证 K 与 M 的第 j 个自由度完全对齐。
 *
 * - consistent（一致质量）：Me = ρt∫NᵀN dA，稀疏模式与 K 完全相同（非对角）；
 * - lumped（集中质量）：按行求和（HRZ 思路对三角单元等价于均分）凝聚到节点，
 *   整体矩阵为纯对角阵。
 *
 * 两种装配的单元总质量均为 ρtA，整体总质量一致，但特征频率系统性不同：
 * 一致质量使结构偏刚硬、频率偏高，集中质量偏柔软、频率偏低。
 */
import type { FemModel, MassFormulation } from './types.js';
import {
  createCst,
  elementConsistentMass,
  elementLumpedMass,
} from './element.js';
import { effectiveDensity, effectiveThickness } from './material.js';
import type { SparseMatrix } from './assembly.js';

/** 装配整体质量矩阵（稀疏 CSR，自由度排布与刚度矩阵一致） */
export function assembleMass(model: FemModel, formulation: MassFormulation = 'consistent'): SparseMatrix {
  const { mesh, material } = model;
  const n = mesh.nodes.length * 2;
  const rho = effectiveDensity(material);
  const t = effectiveThickness(material);

  if (formulation === 'lumped') {
    return assembleLumped(model, rho, t);
  }

  // 一致质量的稀疏模式与刚度完全一致：每单元 6 个自由度两两耦合（含镜像，完整 CSR）
  const pattern: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) pattern[i].add(i);
  for (const tri of mesh.elements) {
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = a; b < 6; b++) {
        const i = dofs[a], j = dofs[b];
        pattern[i].add(j);
        if (i !== j) pattern[j].add(i);
      }
    }
  }

  const { rowPtr, colIdx, diagPos } = buildStructure(pattern);
  const values = new Float64Array(colIdx.length);

  // 累加单元一致质量。
  // 注意：Me 的 6 个局部分量与 6 个全局自由度一一对应（不像刚度那样成对），
  // 因此必须把对称局部矩阵的全部 36 项各加一次，不能只取局部上三角，
  // 否则 (a,a) 对角项会被重复计入（总质量翻倍、频率系统性偏低）。
  for (const tri of mesh.elements) {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    const Me = elementConsistentMass(elem, rho, t);
    const dofs: number[] = [];
    for (const node of tri) dofs.push(2 * node, 2 * node + 1);
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const r = dofs[a], c = dofs[b];
        const pos = locateCsrEntry(rowPtr, colIdx, r, c);
        values[pos] += Me[a * 6 + b];
      }
    }
  }

  return { n, rowPtr, colIdx, values, diagPos };
}

function locateCsrEntry(rowPtr: Int32Array, colIdx: Int32Array, i: number, j: number): number {
  let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (colIdx[mid] === j) return mid;
    if (colIdx[mid] < j) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** 集中质量：逐单元把 ρtA/3 累加到节点的两个对角自由度 */
function assembleLumped(model: FemModel, rho: number, t: number): SparseMatrix {
  const { mesh } = model;
  const n = mesh.nodes.length * 2;
  const diag = new Float64Array(n);

  for (const tri of mesh.elements) {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    const Me = elementLumpedMass(elem, rho, t);
    for (let a = 0; a < 3; a++) {
      diag[2 * tri[a]] += Me[(a * 2) * 6 + a * 2];
      diag[2 * tri[a] + 1] += Me[(a * 2 + 1) * 6 + a * 2 + 1];
    }
  }

  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i] = i;
  rowPtr[n] = n;
  const colIdx = new Int32Array(n);
  const diagPos = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    colIdx[i] = i;
    diagPos[i] = i;
  }
  return { n, rowPtr, colIdx, values: diag, diagPos };
}

function buildStructure(pattern: Set<number>[]): {
  rowPtr: Int32Array;
  colIdx: Int32Array;
  diagPos: Int32Array;
} {
  const n = pattern.length;
  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = nnz;
    nnz += pattern[i].size;
  }
  rowPtr[n] = nnz;
  const colIdx = new Int32Array(nnz);
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
  return { rowPtr, colIdx, diagPos };
}

/** 对角质量向量（lumped 直接返回；consistent 取 M 的对角，供前置条件等使用） */
export function massDiagonal(M: SparseMatrix): Float64Array {
  const d = new Float64Array(M.n);
  for (let i = 0; i < M.n; i++) d[i] = M.values[M.diagPos[i]];
  return d;
}

/** 总质量：所有节点 x 方向（等价 y 方向）集中质量之和 */
export function totalMass(M: SparseMatrix): number {
  let m = 0;
  for (let i = 0; i < M.n; i += 2) m += M.values[M.diagPos[i]];
  return m;
}
