/**
 * 振型渲染（与静力变形/应力渲染分开）：
 * 把选定阶模态的质量归一化振型 φ 按放大系数叠加到原始网格，
 * 可选按 u(t) = φ·sin(ωt) 以来回摆动方式动画显示。
 * 用与静力变形不同的配色（青绿/紫）并显式标注「第几阶模态」，避免混淆。
 */
import type { Mesh, VibrationMode } from '../types';
import { toScreen, type View } from './view';

export interface ModeDisplayOptions {
  exaggeration: number;
  /** 动画相位因子 ∈ [-1,1]（sin(ωt)）；静态显示时传 1 */
  phase: number;
  showOriginal: boolean;
}

/** 计算某一动画相位下变形后的节点坐标 */
export function modePositions(
  mesh: Mesh,
  mode: VibrationMode,
  scale: number,
  phase: number,
): { x: number; y: number }[] {
  const amp = scale * phase;
  return mesh.nodes.map((p, i) => ({
    x: p.x + mode.shape[2 * i] * amp,
    y: p.y + mode.shape[2 * i + 1] * amp,
  }));
}

/** 用节点位移的最大模归一振型到「放大系数直接可视」的尺度参考 */
export function modeMaxComponent(mode: VibrationMode): number {
  let m = 0;
  for (let i = 0; i < mode.shape.length; i++) m = Math.max(m, Math.abs(mode.shape[i]));
  return m || 1;
}

/** 绘制振型：变形网格线框 + 节点散点，颜色随相位正负区分 */
export function drawModeShape(
  ctx: CanvasRenderingContext2D,
  view: View,
  mesh: Mesh,
  mode: VibrationMode,
  opts: ModeDisplayOptions,
): void {
  const pos = modePositions(mesh, mode, opts.exaggeration, opts.phase);

  if (opts.showOriginal) {
    ctx.save();
    ctx.strokeStyle = 'rgba(100,116,139,0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const [a, b] of mesh.boundaryEdges) {
      const [x0, y0] = toScreen(view, mesh.nodes[a].x, mesh.nodes[a].y);
      const [x1, y1] = toScreen(view, mesh.nodes[b].x, mesh.nodes[b].y);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 单元填充淡色（按三角面片），边线用主题色
  ctx.save();
  ctx.fillStyle = opts.phase >= 0 ? 'rgba(45,212,191,0.10)' : 'rgba(167,139,250,0.12)';
  for (const [a, b, c] of mesh.elements) {
    const [x0, y0] = toScreen(view, pos[a].x, pos[a].y);
    const [x1, y1] = toScreen(view, pos[b].x, pos[b].y);
    const [x2, y2] = toScreen(view, pos[c].x, pos[c].y);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = opts.phase >= 0 ? '#0d9488' : '#7c3aed';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, b] of mesh.boundaryEdges) {
    const [x0, y0] = toScreen(view, pos[a].x, pos[a].y);
    const [x1, y1] = toScreen(view, pos[b].x, pos[b].y);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}
