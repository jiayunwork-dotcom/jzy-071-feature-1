/** 约束标记与力箭头渲染 */
import type { Mesh, NodalLoad, Support, TractionLoad, Vec2 } from '../types';
import { toScreen, type View } from './view';

const SUPPORT_COLOR = '#0f766e';

/** 在屏幕坐标画一个三角支座（固定约束符号） */
function drawHatchedGround(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
) {
  ctx.save();
  ctx.translate(x, y);
  // 让三角符号朝向节点：dir 为从支座指向节点的方向
  const angle = Math.atan2(dirY, dirX);
  ctx.rotate(angle);
  // 三角形（尖点指向右即节点方向）
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-12, -7);
  ctx.lineTo(-12, 7);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15,118,110,0.18)';
  ctx.fill();
  ctx.strokeStyle = SUPPORT_COLOR;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 地面斜线
  ctx.beginPath();
  ctx.moveTo(-12, -9);
  ctx.lineTo(-12, 9);
  ctx.stroke();
  ctx.restore();
}

function drawRollerGround(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
) {
  ctx.save();
  ctx.translate(x, y);
  const angle = Math.atan2(dirY, dirX);
  ctx.rotate(angle);
  // 辊轴：小圆圈 + 地面线
  ctx.strokeStyle = SUPPORT_COLOR;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(-6, 0, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-12, -7);
  ctx.lineTo(-12, 7);
  ctx.stroke();
  ctx.restore();
}

/** 节点约束符号：固定=三角支座，水平滑移=竖向辊轴，竖直滑移=水平辊轴 */
export function drawSupports(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  supports: Support[],
  tol: number,
) {
  const drawn = new Set<string>();
  for (const s of supports) {
    for (let i = 0; i < mesh.nodes.length; i++) {
      const p = mesh.nodes[i];
      if (!nodeInRegion(p, s.region, tol)) continue;
      const key = `${i}_${s.type}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const [sx, sy] = toScreen(view, p.x, p.y);
      if (s.type === 'fixed') {
        drawHatchedGround(ctx, sx, sy, -1, 0);
        drawHatchedGround(ctx, sx, sy, 0, 1);
      } else if (s.type === 'slideX') {
        // ux=0：竖向墙面上的辊轴
        drawRollerGround(ctx, sx, sy, -1, 0);
      } else if (s.type === 'slideY') {
        // uy=0：水平地面上的辊轴（符号向下）
        drawRollerGround(ctx, sx, sy, 0, -1);
      }
    }
  }
}

/** 集中力箭头：长度按 |F| 成比例 */
export function drawNodalLoads(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  loads: NodalLoad[],
  tol: number,
  refMagnitude: number,
) {
  const baseLen = Math.min(90, Math.max(28, view.width * 0.12));
  for (const load of loads) {
    for (let i = 0; i < mesh.nodes.length; i++) {
      const p = mesh.nodes[i];
      if (!nodeInRegion(p, load.region, tol)) continue;
      const fmag = Math.hypot(load.fx, load.fy);
      if (fmag === 0) continue;
      const len = baseLen * (fmag / refMagnitude);
      const [sx, sy] = toScreen(view, p.x, p.y);
      drawArrow(ctx, sx, sy, sx + (load.fx / fmag) * len, sy - (load.fy / fmag) * len, '#dc2626');
    }
  }
}

/** 分布面力：沿线段画一组同向小箭头 */
export function drawTractionLoads(
  ctx: CanvasRenderingContext2D,
  view: View,
  tractions: TractionLoad[],
  refMagnitude: number,
) {
  const baseLen = Math.min(46, Math.max(16, view.width * 0.06));
  for (const tr of tractions) {
    if (tr.region.kind !== 'line') continue;
    const { x1, y1, x2, y2 } = tr.region;
    const mag = Math.hypot(tr.tx, tr.ty);
    if (mag === 0) continue;
    const n = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / (mag / refMagnitude * 20 + 8)));
    const len = baseLen * (mag / refMagnitude);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const wx = x1 + (x2 - x1) * t;
      const wy = y1 + (y2 - y1) * t;
      const [sx, sy] = toScreen(view, wx, wy);
      drawArrow(
        ctx,
        sx,
        sy,
        sx + (tr.tx / mag) * len,
        sy - (tr.ty / mag) * len,
        '#f97316',
        2,
      );
    }
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2.5,
) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 9;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function nodeInRegion(p: Vec2, region: Support['region'] | NodalLoad['region'], tol: number): boolean {
  switch (region.kind) {
    case 'point':
      return Math.hypot(p.x - region.x, p.y - region.y) <= tol;
    case 'line': {
      const dx = region.x2 - region.x1, dy = region.y2 - region.y1;
      const len2 = dx * dx + dy * dy;
      let t = ((p.x - region.x1) * dx + (p.y - region.y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.x - (region.x1 + t * dx), p.y - (region.y1 + t * dy));
      return d <= tol;
    }
    case 'box':
      return p.x >= region.xmin - tol && p.x <= region.xmax + tol && p.y >= region.ymin - tol && p.y <= region.ymax + tol;
  }
}
