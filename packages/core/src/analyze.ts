/**
 * 完整静力分析流水线：
 * 装配 K → 组装 F → 施加位移边界条件 → 求解 K·u = F → 应力回代。
 */
import type { AnalysisResult, FemModel } from './types.js';
import { SingularMatrixError } from './types.js';
import {
  applyBoundaryConditions,
  assembleStiffness,
  type SparseMatrix,
} from './assembly.js';
import { resolveSupports, assembleLoads } from './conditions.js';
import { solveSystem, type SolveOptions } from './solver.js';
import { computeStresses } from './stress.js';

/** 约束/载荷点吸附到节点的容差：取平均边界边长量级 */
export function snapTolerance(model: FemModel): number {
  let size = 1;
  if (model.mesh.nodes.length > 0) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const p of model.mesh.nodes) {
      xmin = Math.min(xmin, p.x); ymin = Math.min(ymin, p.y);
      xmax = Math.max(xmax, p.x); ymax = Math.max(ymax, p.y);
    }
    size = Math.max(xmax - xmin, ymax - ymin, 1);
  }
  let sum = 0;
  for (const [a, b] of model.mesh.boundaryEdges) {
    sum += Math.hypot(
      model.mesh.nodes[a].x - model.mesh.nodes[b].x,
      model.mesh.nodes[a].y - model.mesh.nodes[b].y,
    );
  }
  const avgEdge = model.mesh.boundaryEdges.length ? sum / model.mesh.boundaryEdges.length : size * 0.05;
  return Math.max(avgEdge * 0.75, size * 1e-4);
}

export function analyze(model: FemModel, opts: SolveOptions = {}): AnalysisResult {
  const tol = snapTolerance(model);
  const prescribed = resolveSupports(model.mesh, model.supports, tol);

  if (prescribed.size === 0) {
    throw new SingularMatrixError(
      '模型没有任何约束，刚度矩阵必然奇异（结构可整体平移和转动）。' +
        '请至少约束 2~3 个自由度以消除全部 3 个刚体模态（x 平移、y 平移、转动）。',
      3,
    );
  }

  const K: SparseMatrix = assembleStiffness(model);
  const KvalsPristine = Float64Array.from(K.values); // 边界条件前的刚度，用于支反力
  const F = assembleLoads(model, tol);
  const Fraw = Float64Array.from(F); // 施加边界条件前的外载向量，用于支反力

  applyBoundaryConditions(K, F, prescribed);
  const solved = solveSystem(K, F, opts);
  const u = solved.x;

  // 支反力：R = K0·u − F_ext（在被约束自由度上即支座反力）
  const reactions = new Float64Array(K.n);
  for (let i = 0; i < K.n; i++) {
    let kui = 0;
    for (let p = K.rowPtr[i]; p < K.rowPtr[i + 1]; p++) {
      kui += KvalsPristine[p] * u[K.colIdx[p]];
    }
    if (prescribed.has(i)) reactions[i] = kui - Fraw[i];
  }

  const stress = computeStresses(model, u);

  let maxDisp = 0;
  for (let i = 0; i < model.mesh.nodes.length; i++) {
    maxDisp = Math.max(maxDisp, Math.hypot(u[2 * i], u[2 * i + 1]));
  }

  return {
    displacement: u,
    elementStresses: stress.elementStresses,
    nodalStresses: stress.nodalStresses,
    force: Fraw,
    reactions,
    maxDisplacement: maxDisp,
    maxVonMises: stress.maxVonMises,
    maxSx: stress.maxSx,
    maxSy: stress.maxSy,
    maxTxy: stress.maxTxy,
    diagnostics: {
      solver: solved.solver,
      iterations: solved.iterations,
      residual: solved.residual,
      constrainedDofs: prescribed.size,
    },
  };
}
