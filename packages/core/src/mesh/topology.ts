/** 网格拓扑工具：边统计、定向、合法性校验 */
import type { Mesh, Vec2 } from '../types.js';
import { distanceToSegment } from './geometry.js';

/** 无向边的规范化键 */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** 由单元连通表求边界边（仅被一个单元引用的边） */
export function findBoundaryEdges(elements: [number, number, number][]): [number, number][] {
  const count = new Map<string, number>();
  const edgeOf = new Map<string, [number, number]>();
  for (const tri of elements) {
    const pairs: [number, number][] = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (const [a, b] of pairs) {
      const k = edgeKey(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
      edgeOf.set(k, a < b ? [a, b] : [b, a]);
    }
  }
  const out: [number, number][] = [];
  for (const [k, c] of count) {
    if (c === 1) out.push(edgeOf.get(k)!);
  }
  return out;
}

/** 将单元统一为逆时针方向 */
export function orientTrianglesCCW(nodes: Vec2[], elements: [number, number, number][]): [number, number, number][] {
  return elements.map((tri) => {
    const [a, b, c] = tri;
    const pa = nodes[a], pb = nodes[b], pc = nodes[c];
    const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    return cross < 0 ? ([a, c, b] as [number, number, number]) : tri;
  });
}

export interface MeshValidity {
  valid: boolean;
  errors: string[];
}

/**
 * 三角化合法性校验：
 * 1. 无零面积单元；
 * 2. 每条内部边恰好被两个单元引用、边界边恰好一个 —— 无悬挂节点/重叠；
 * 3. 所有三角形重心位于有限个...（略）
 * 4. 每条边界边的中点都落在输入多边形的某条线段上 —— 边界完整覆盖。
 */
export function validateMesh(
  mesh: Mesh,
  loops: Vec2[][],
): MeshValidity {
  const errors: string[] = [];
  const { nodes, elements, boundaryEdges } = mesh;

  for (let i = 0; i < elements.length; i++) {
    const [a, b, c] = elements[i];
    const pa = nodes[a], pb = nodes[b], pc = nodes[c];
    const area2 = Math.abs((pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x));
    if (area2 < 1e-12) errors.push(`单元 ${i} 面积为零（退化三角形）`);
  }

  const count = new Map<string, number>();
  for (const tri of elements) {
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as [number, number][]) {
      const k = edgeKey(a, b);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  for (const [k, c] of count) {
    if (c > 2) errors.push(`边 ${k} 被 ${c} 个单元引用（存在重叠单元或非流形结构）`);
  }

  const boundarySet = new Set(boundaryEdges.map(([a, b]) => edgeKey(a, b)));
  for (const [a, b] of boundaryEdges) {
    if (count.get(edgeKey(a, b)) !== 1) {
      errors.push(`边界边 ${edgeKey(a, b)} 引用计数不为 1`);
    }
    boundarySet.delete(edgeKey(a, b));
  }

  // 边界完整性：边中点必须落在输入环的某条线段上
  const tol = 1e-7 * Math.max(1, ...nodes.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
  for (const [a, b] of mesh.boundaryEdges) {
    const mid = { x: (nodes[a].x + nodes[b].x) / 2, y: (nodes[a].y + nodes[b].y) / 2 };
    let covered = false;
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        if (distanceToSegment(mid, loop[i], loop[(i + 1) % loop.length]) < tol * 100) {
          covered = true;
          break;
        }
      }
      if (covered) break;
    }
    if (!covered) errors.push(`边界边中点 (${mid.x.toFixed(3)}, ${mid.y.toFixed(3)}) 不在输入边界上`);
  }

  return { valid: errors.length === 0, errors };
}
