/** 应力云图色带：蓝 → 青 → 绿 → 黄 → 红（发散色带，0 居中） */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

const STOPS: Array<[number, RGB]> = [
  [0.0, { r: 30, g: 92, b: 198 }],   // 深蓝
  [0.25, { r: 64, g: 192, b: 220 }], // 青
  [0.5, { r: 96, g: 200, b: 110 }],  // 绿
  [0.75, { r: 240, g: 200, b: 60 }], // 黄
  [1.0, { r: 214, g: 48, b: 48 }],   // 红
];

/** t ∈ [0,1] → RGB */
export function colormap(t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return {
        r: Math.round(c0.r + (c1.r - c0.r) * f),
        g: Math.round(c0.g + (c1.g - c0.g) * f),
        b: Math.round(c0.b + (c1.b - c0.b) * f),
      };
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function rgba(c: RGB, alpha = 1): string {
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** 由数值与 [min,max] 范围映射颜色（采用绝对值对称色带：0 为绿色） */
export function stressColor(v: number, min: number, max: number): RGB {
  const bound = Math.max(Math.abs(min), Math.abs(max), 1e-12);
  return colormap((v + bound) / (2 * bound));
}

/** 生成图例刻度文字与颜色 */
export function legendStops(min: number, max: number, count = 6) {
  const bound = Math.max(Math.abs(min), Math.abs(max));
  const out: { t: number; value: number; color: RGB }[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push({ t, value: -bound + 2 * bound * t, color: colormap(t) });
  }
  return out;
}
