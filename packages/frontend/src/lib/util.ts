import type { Vec2 } from '../types';

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function bounds(points: Vec2[]): { xmin: number; ymin: number; xmax: number; ymax: number } {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const p of points) {
    xmin = Math.min(xmin, p.x);
    ymin = Math.min(ymin, p.y);
    xmax = Math.max(xmax, p.x);
    ymax = Math.max(ymax, p.y);
  }
  return { xmin, ymin, xmax, ymax };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function fmt(v: number, digits = 4): string {
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(digits - 2);
  return v.toExponential(3);
}
