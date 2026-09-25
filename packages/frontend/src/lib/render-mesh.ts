/** 几何与网格渲染（多边形轮廓、三角形单元、节点） */
import type { Mesh, Polygon, Vec2 } from '../types';
import { toScreen, type View } from './view';

export function drawPolygon(ctx: CanvasRenderingContext2D, view: View, poly: Polygon, closed: boolean) {
  drawLoop(ctx, view, poly.outer, closed, '#2563eb', 2);
  for (const hole of poly.holes) drawLoop(ctx, view, hole, true, '#2563eb', 2);
}

function drawLoop(
  ctx: CanvasRenderingContext2D,
  view: View,
  loop: Vec2[],
  closed: boolean,
  color: string,
  width: number,
) {
  if (loop.length === 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  loop.forEach((p, i) => {
    const [x, y] = toScreen(view, p.x, p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed && loop.length >= 3) ctx.closePath();
  ctx.stroke();
  // 顶点
  ctx.fillStyle = '#1d4ed8';
  for (const p of loop) {
    const [x, y] = toScreen(view, p.x, p.y);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawMesh(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  opts: { showNodes?: boolean; edgeColor?: string; fill?: boolean } = {},
) {
  const edgeColor = opts.edgeColor ?? 'rgba(71,85,105,0.55)';
  ctx.save();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = edgeColor;
  for (const [a, b, c] of mesh.elements) {
    const pa = mesh.nodes[a], pb = mesh.nodes[b], pc = mesh.nodes[c];
    const [x0, y0] = toScreen(view, pa.x, pa.y);
    const [x1, y1] = toScreen(view, pb.x, pb.y);
    const [x2, y2] = toScreen(view, pc.x, pc.y);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    if (opts.fill) ctx.fillStyle = 'rgba(226,232,240,0.35)';
    if (opts.fill) ctx.fill();
    ctx.stroke();
  }
  if (opts.showNodes) {
    ctx.fillStyle = '#475569';
    for (const p of mesh.nodes) {
      const [x, y] = toScreen(view, p.x, p.y);
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 高亮指定顶点（拖动编辑时） */
export function drawVertexHandle(
  ctx: CanvasRenderingContext2D,
  view: View,
  p: Vec2,
  selected: boolean,
) {
  const [x, y] = toScreen(view, p.x, p.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, selected ? 8 : 6, 0, Math.PI * 2);
  ctx.fillStyle = selected ? 'rgba(234,88,12,0.35)' : 'rgba(37,99,235,0.25)';
  ctx.fill();
  ctx.strokeStyle = selected ? '#ea580c' : '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}
