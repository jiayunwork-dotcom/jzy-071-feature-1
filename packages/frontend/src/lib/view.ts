/** 画布世界坐标 ⇄ 屏幕坐标变换 */
export interface View {
  scale: number;
  /** 屏幕中心对应的世界坐标 */
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export function makeView(width: number, height: number): View {
  return { scale: 1, cx: 0, cy: 0, width, height };
}

/** 根据包围盒自动适配视图（留 8% 边距） */
export function fitView(
  view: View,
  b: { xmin: number; ymin: number; xmax: number; ymax: number },
  margin = 0.84,
): View {
  const w = Math.max(b.xmax - b.xmin, 1e-9);
  const h = Math.max(b.ymax - b.ymin, 1e-9);
  const scale = Math.min(view.width / w, view.height / h) * margin;
  return {
    ...view,
    scale,
    cx: (b.xmin + b.xmax) / 2,
    cy: (b.ymin + b.ymax) / 2,
  };
}

export function toScreen(view: View, x: number, y: number): [number, number] {
  return [
    view.width / 2 + (x - view.cx) * view.scale,
    view.height / 2 - (y - view.cy) * view.scale,
  ];
}

export function toWorld(view: View, sx: number, sy: number): [number, number] {
  return [
    view.cx + (sx - view.width / 2) / view.scale,
    view.cy - (sy - view.height / 2) / view.scale,
  ];
}
