/**
 * 网格无关性（收敛性）研究：
 * 对同一几何与边界条件，按种子间距递减序列多次剖分与求解，
 * 记录每次的单元数、最大 von Mises 应力与最大位移。
 */
import type { FemModel, Material, Polygon, Support, NodalLoad, TractionLoad, BodyLoad, Mesh } from './types.js';
import { triangulate } from './mesh/triangulate.js';
import { analyze } from './analyze.js';
import type { SolveOptions } from './solver.js';

export interface ConvergenceLevel {
  level: number;
  seed: number;
  nodeCount: number;
  elementCount: number;
  maxVonMises: number;
  maxDisplacement: number;
  maxSx: number;
}

export interface ConvergenceStudy {
  levels: ConvergenceLevel[];
  error?: string;
}

export interface ConvergenceOptions extends SolveOptions {
  /** 加密次数 */
  levels?: number;
  /** 相邻两级种子的折减系数（<1，越小加密越快） */
  refineFactor?: number;
  /** 单元数上限（保护性能） */
  maxElements?: number;
}

export function runConvergence(
  polygon: Polygon,
  material: Material,
  supports: Support[],
  nodalLoads: NodalLoad[],
  tractionLoads: TractionLoad[],
  bodyLoad: BodyLoad | undefined,
  initialSeed: number,
  opts: ConvergenceOptions = {},
): ConvergenceStudy {
  const count = opts.levels ?? 5;
  const factor = opts.refineFactor ?? 0.7;
  const maxElements = opts.maxElements ?? 12000;
  const levels: ConvergenceLevel[] = [];

  let seed = initialSeed;
  let mesh: Mesh | null = null;
  for (let lvl = 0; lvl < count; lvl++) {
    try {
      mesh = triangulate(polygon, { globalSeed: seed });
      if (mesh.elements.length > maxElements) break;
      const model: FemModel = {
        polygon,
        mesh,
        material,
        supports,
        nodalLoads,
        tractionLoads,
        bodyLoad,
      };
      const res = analyze(model, opts);
      levels.push({
        level: lvl + 1,
        seed,
        nodeCount: mesh.nodes.length,
        elementCount: mesh.elements.length,
        maxVonMises: res.maxVonMises,
        maxDisplacement: res.maxDisplacement,
        maxSx: res.maxSx,
      });
    } catch (err) {
      return { levels, error: err instanceof Error ? err.message : String(err) };
    }
    seed *= factor;
  }
  return { levels };
}
