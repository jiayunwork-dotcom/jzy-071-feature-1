/**
 * 矩形结构化网格（每个矩形两个三角形，方向交替）。
 * 用于矩形梁等模板：网格规则、确定性好，便于和梁理论对比。
 */
import type { Mesh, Vec2 } from '../types.js';
import { computeStats } from './triangulate.js';
import { findBoundaryEdges } from './topology.js';

export function structuredRectangle(
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
  nx: number,
  ny: number,
  /** 对角线方向：'alternate' 交替（网格更各向同性）；'uniform' 全部同向（仿射重复网格，用于严格分片试验） */
  diagonal: 'alternate' | 'uniform' = 'alternate',
): Mesh {
  const nodes: Vec2[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      nodes.push({
        x: xmin + ((xmax - xmin) * i) / nx,
        y: ymin + ((ymax - ymin) * j) / ny,
      });
    }
  }
  const id = (i: number, j: number) => j * (nx + 1) + i;
  const elements: [number, number, number][] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      const flip = diagonal === 'uniform' ? false : (i + j) % 2 === 0;
      if (flip) {
        elements.push([a, b, c], [a, c, d]);
      } else {
        elements.push([a, b, d], [b, c, d]);
      }
    }
  }
  const boundaryEdges = findBoundaryEdges(elements);
  const stats = computeStats(nodes, elements);
  return { nodes, elements, boundaryEdges, stats };
}

/** 按目标种子间距估算矩形网格划分数 */
export function divisionsForSeed(
  length: number,
  height: number,
  seed: number,
): { nx: number; ny: number } {
  const nx = Math.max(1, Math.round(length / seed));
  const ny = Math.max(1, Math.round(height / seed));
  return { nx, ny };
}
