/**
 * 应力后处理：
 * - 对每个单元取出单元位移 ue，由 ε = B·ue、σ = D·ε 得到常应力；
 * - 节点应力取相邻单元的算术平均（用于连续色带渲染，CST 单元应力本身是分片常数）；
 * - 支反力 R = K_free·u − F_free（约束自由度上）。
 */
import type { AnalysisResult, FemModel } from './types.js';
import {
  createCst,
  elementStrain,
  elementStressFromStrain,
  vonMises,
} from './element.js';
import { constitutiveMatrix } from './material.js';
import { csrMultiply, type SparseMatrix } from './assembly.js';

export interface StressOutput {
  elementStresses: AnalysisResult['elementStresses'];
  nodalStresses: Float64Array;
  maxSx: number;
  maxSy: number;
  maxTxy: number;
  maxVonMises: number;
}

export function computeStresses(model: FemModel, u: Float64Array): StressOutput {
  const { mesh, material } = model;
  const D = constitutiveMatrix(material);
  const n = mesh.nodes.length;

  const elementStresses: AnalysisResult['elementStresses'] = [];
  const nodalSum = new Float64Array(n * 4);
  const nodalCount = new Float64Array(n);

  let maxSx = 0, maxSy = 0, maxTxy = 0, maxVm = 0;

  mesh.elements.forEach((tri, eIdx) => {
    const elem = createCst(mesh.nodes[tri[0]], mesh.nodes[tri[1]], mesh.nodes[tri[2]], tri);
    const ue = new Float64Array(6);
    for (let k = 0; k < 3; k++) {
      ue[k * 2] = u[2 * tri[k]];
      ue[k * 2 + 1] = u[2 * tri[k] + 1];
    }
    const [ex, ey, gxy] = elementStrain(elem, ue);
    const [sx, sy, txy] = elementStressFromStrain(D, ex, ey, gxy);
    const vm = vonMises(sx, sy, txy);
    elementStresses.push({ element: eIdx, sx, sy, txy, vonMises: vm });

    maxSx = Math.max(maxSx, Math.abs(sx));
    maxSy = Math.max(maxSy, Math.abs(sy));
    maxTxy = Math.max(maxTxy, Math.abs(txy));
    maxVm = Math.max(maxVm, vm);

    for (const node of tri) {
      nodalSum[node * 4] += sx;
      nodalSum[node * 4 + 1] += sy;
      nodalSum[node * 4 + 2] += txy;
      nodalSum[node * 4 + 3] += vm;
      nodalCount[node] += 1;
    }
  });

  const nodalStresses = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = nodalCount[i] || 1;
    nodalStresses[i * 4] = nodalSum[i * 4] / c;
    nodalStresses[i * 4 + 1] = nodalSum[i * 4 + 1] / c;
    nodalStresses[i * 4 + 2] = nodalSum[i * 4 + 2] / c;
    nodalStresses[i * 4 + 3] = nodalSum[i * 4 + 3] / c;
  }

  return { elementStresses, nodalStresses, maxSx, maxSy, maxTxy, maxVonMises: maxVm };
}

/** 支反力：在约束自由度上 R = K·u − F */
export function computeReactions(
  K: SparseMatrix,
  F: Float64Array,
  u: Float64Array,
  prescribed: Map<number, number>,
): Float64Array {
  const Ku = csrMultiply(K, u);
  const R = new Float64Array(K.n);
  for (const dof of prescribed.keys()) {
    R[dof] = Ku[dof] - F[dof];
  }
  return R;
}
