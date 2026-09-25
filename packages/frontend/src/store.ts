import { get, writable } from 'svelte/store';
import type {
  BodyLoad,
  ConvergenceStudy,
  Material,
  Mesh,
  ModelDTO,
  NodalLoad,
  Polygon,
  ResultDTO,
  StressField,
  Support,
  SupportType,
  ToolMode,
  TractionLoad,
  Vec2,
} from './types';

export const toolMode = writable<ToolMode>('draw');
export const supportType = writable<SupportType>('fixed');
export const loadFx = writable(100);
export const loadFy = writable(-100);
export const tractionTx = writable(10);
export const tractionTy = writable(0);

export const polygon = writable<Polygon>({ outer: [], holes: [] });
export const mesh = writable<Mesh | null>(null);
export const globalSeed = writable(8);
export const material = writable<Material>({
  E: 210000,
  nu: 0.3,
  thickness: 10,
  model: 'planeStress',
});
export const supports = writable<Support[]>([]);
export const nodalLoads = writable<NodalLoad[]>([]);
export const tractionLoads = writable<TractionLoad[]>([]);
export const bodyLoad = writable<BodyLoad>({ fx: 0, fy: 0 });

export const result = writable<ResultDTO | null>(null);
export const convergence = writable<ConvergenceStudy | null>(null);

export const showDeformed = writable(true);
export const showStress = writable(false);
export const showOriginal = writable(true);
export const exaggeration = writable(10);
export const stressField = writable<StressField>('vm');

export const busy = writable(false);
export const statusMessage = writable<{ text: string; kind: 'info' | 'error' | 'ok' } | null>(null);
export const selectedVertex = writable<number | null>(null);

export const referenceSolution = writable<{
  label: string;
  tipDisplacement?: number;
  maxStress?: number;
  formula: string;
} | null>(null);

let idCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}_${idCounter++}`;
}

export function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info', timeoutMs = 5000) {
  statusMessage.set({ text, kind });
  if (timeoutMs > 0) {
    setTimeout(() => statusMessage.update((s) => (s?.text === text ? null : s)), timeoutMs);
  }
}

export function resetAll() {
  polygon.set({ outer: [], holes: [] });
  mesh.set(null);
  supports.set([]);
  nodalLoads.set([]);
  tractionLoads.set([]);
  bodyLoad.set({ fx: 0, fy: 0 });
  result.set(null);
  convergence.set(null);
  selectedVertex.set(null);
}

export function buildModelDTO(): ModelDTO {
  const poly = get(polygon);
  const m = get(mesh);
  const mat = get(material);
  const sup = get(supports);
  const nl = get(nodalLoads);
  const tl = get(tractionLoads);
  const bl = get(bodyLoad);
  if (!m) throw new Error('请先生成网格');
  return {
    polygon: poly,
    mesh: m,
    material: mat,
    supports: sup,
    nodalLoads: nl,
    tractionLoads: tl,
    bodyLoad: bl.fx !== 0 || bl.fy !== 0 ? bl : undefined,
  };
}

/** 画布坐标 ⇄ 世界坐标变换（由 Canvas 组件维护） */
export const viewTransform = writable<{
  scale: number;
  offsetX: number;
  offsetY: number;
}>({ scale: 1, offsetX: 0, offsetY: 0 });

export const hoverPoint = writable<Vec2 | null>(null);
