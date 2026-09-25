/**
 * Delaunay 三角剖分：
 * 1) 细分所有边界（外轮廓与孔）为受约束边；
 * 2) 在区域内部按种子间距生成候选点（带确定性抖动）；
 * 3) 调用 cdt2d 做约束 Delaunay 三角化，只保留区域内部三角形；
 * 4) 定向、统计、合法性校验。
 */
import createCDT from 'cdt2d';
import type { Mesh, MeshParams, MeshStats, Polygon, Vec2 } from '../types.js';
import {
  generateInteriorPoints,
  mergeSubdivisions,
  orientPolygon,
  subdivideLoop,
} from './geometry.js';
import { findBoundaryEdges, orientTrianglesCCW, validateMesh } from './topology.js';
import { triangleAngles, triangleQuality } from '../element.js';

export class MeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshError';
  }
}

/**
 * 对封闭多边形执行约束 Delaunay 三角剖分。
 * @throws MeshError 当多边形不封闭/自交严重/无法生成任何单元
 */
export function triangulate(polygon: Polygon, params: MeshParams): Mesh {
  const poly = orientPolygon(polygon);
  if (poly.outer.length < 3) throw new MeshError('轮廓至少需要 3 个顶点才能剖分');
  const seed = Math.max(params.globalSeed, 1e-9);
  const tol = seed * 1e-6;

  const acc: { points: Vec2[]; edges: [number, number][] } = { points: [], edges: [] };
  mergeSubdivisions(acc, subdivideLoop(poly.outer, seed, tol), tol);
  const loopsForValidation: Vec2[][] = [poly.outer];
  for (const hole of poly.holes) {
    if (hole.length >= 3) {
      mergeSubdivisions(acc, subdivideLoop(hole, seed, tol), tol);
      loopsForValidation.push(hole);
    }
  }

  const interior = generateInteriorPoints(poly, seed);
  const baseCount = acc.points.length;
  for (const p of interior) {
    if (!acc.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol)) {
      acc.points.push(p);
    }
  }

  const pointsArray = acc.points.map((p) => [p.x, p.y] as [number, number]);
  let tris = createCDT(pointsArray, acc.edges, { exterior: false }) as [number, number, number][];

  if (!tris || tris.length === 0) {
    // 少数情况下内部点抖动导致退化，去掉内部点重试，仅保留边界三角形
    tris = createCDT(pointsArray.slice(0, baseCount), acc.edges, { exterior: false }) as [number, number, number][];
  }
  if (!tris || tris.length === 0) {
    throw new MeshError('三角剖分失败：请检查多边形是否封闭、是否存在自交或过短边');
  }

  const nodes = acc.points;
  // 去掉未被任何单元引用的孤立点并重编号
  const used = new Array(nodes.length).fill(false);
  tris.forEach((t) => t.forEach((idx) => (used[idx] = true)));
  const remap = new Array(nodes.length).fill(-1);
  const liveNodes: Vec2[] = [];
  nodes.forEach((p, i) => {
    if (used[i]) remap[i] = liveNodes.push(p) - 1;
  });
  let elements = tris.map(
    (t) => [remap[t[0]], remap[t[1]], remap[t[2]]] as [number, number, number],
  );
  elements = orientTrianglesCCW(liveNodes, elements);

  const boundaryEdges = findBoundaryEdges(elements);
  const stats = computeStats(liveNodes, elements);
  const mesh: Mesh = { nodes: liveNodes, elements, boundaryEdges, stats };

  const check = validateMesh(mesh, loopsForValidation);
  if (!check.valid) throw new MeshError(`网格不合法：${check.errors.join('；')}`);
  return mesh;
}

/** 计算网格统计信息 */
export function computeStats(
  nodes: Vec2[],
  elements: [number, number, number][],
): MeshStats {
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  let qualitySum = 0;
  let minQuality = Infinity;
  for (const [a, b, c] of elements) {
    const [ai, bi, ci] = triangleAngles(nodes[a], nodes[b], nodes[c]);
    minAngle = Math.min(minAngle, ai, bi, ci);
    maxAngle = Math.max(maxAngle, ai, bi, ci);
    const q = triangleQuality(nodes[a], nodes[b], nodes[c]);
    qualitySum += q;
    minQuality = Math.min(minQuality, q);
  }
  return {
    nodeCount: nodes.length,
    elementCount: elements.length,
    minAngle,
    maxAngle,
    meanQuality: elements.length > 0 ? qualitySum / elements.length : 0,
    minQuality,
  };
}
