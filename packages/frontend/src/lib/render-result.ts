/** 结果渲染：变形图叠加与应力云图 */
import type { Mesh, ResultDTO, StressField } from '../types';
import { stressColor } from './colormap';
import { toScreen, type View } from './view';

function fieldIndex(field: StressField): number {
  switch (field) {
    case 'sx': return 0;
    case 'sy': return 1;
    case 'txy': return 2;
    case 'vm': return 3;
  }
}

/** 由位移与放大系数计算变形后节点的屏幕坐标点列 */
export function deformedPositions(
  mesh: Mesh,
  displacement: number[],
  scale: number,
): { x: number; y: number }[] {
  return mesh.nodes.map((p, i) => ({
    x: p.x + displacement[2 * i] * scale,
    y: p.y + displacement[2 * i + 1] * scale,
  }));
}

/** 应力云图：CST 单元应力分片常数，逐三角单元填充 */
export function drawStressContour(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  result: ResultDTO,
  field: StressField,
  displacement: { x: number; y: number }[] | null,
  min: number,
  max: number,
) {
  const fi = fieldIndex(field);
  const nodes = displacement ?? mesh.nodes;
  ctx.save();
  for (let e = 0; e < mesh.elements.length; e++) {
    const [a, b, c] = mesh.elements[e];
    const pa = nodes[a], pb = nodes[b], pc = nodes[c];
    const [x0, y0] = toScreen(view, pa.x, pa.y);
    const [x1, y1] = toScreen(view, pb.x, pb.y);
    const [x2, y2] = toScreen(view, pc.x, pc.y);
    // 单元常数应力
    const v = result.elementStresses[e][field === 'vm' ? 'vonMises' : field];
    const col = stressColor(v, min, max);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
    ctx.fill();
  }
  // 细网格边线
  ctx.strokeStyle = 'rgba(30,41,59,0.18)';
  ctx.lineWidth = 0.4;
  for (const [a, b, c] of mesh.elements) {
    const [x0, y0] = toScreen(view, nodes[a].x, nodes[a].y);
    const [x1, y1] = toScreen(view, nodes[b].x, nodes[b].y);
    const [x2, y2] = toScreen(view, nodes[c].x, nodes[c].y);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/** 变形网格线框 */
export function drawDeformedWire(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  displacement: { x: number; y: number }[],
) {
  ctx.save();
  ctx.strokeStyle = '#b91c1c';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const [a, b] of mesh.boundaryEdges) {
    const pa = displacement[a], pb = displacement[b];
    const [x0, y0] = toScreen(view, pa.x, pa.y);
    const [x1, y1] = toScreen(view, pb.x, pb.y);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}
