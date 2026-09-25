import type {
  ConvergenceStudy,
  Mesh,
  ModelDTO,
  Polygon,
  ResultDTO,
  VibrationResult,
  VibrationReference,
  MassMatrixType,
} from './types';

const BASE = '/api';

async function post<T>(url: string, body: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.error ?? `请求失败 (${resp.status})`) as Error & {
      kind?: string;
      nullity?: number;
    };
    err.kind = data.kind;
    err.nullity = data.nullity;
    throw err;
  }
  return data as T;
}

export async function fetchMesh(polygon: Polygon, globalSeed: number): Promise<Mesh> {
  const data = await post<{ mesh: Mesh }>('/mesh', { polygon, params: { globalSeed } });
  return data.mesh;
}

export async function fetchAnalyze(model: ModelDTO): Promise<ResultDTO> {
  const data = await post<{ result: ResultDTO }>('/analyze', model);
  return data.result;
}

export async function fetchVibration(
  model: ModelDTO,
  modeCount: number,
  massMatrix: MassMatrixType,
): Promise<VibrationResult> {
  const data = await post<{ result: VibrationResult }>('/vibration', {
    ...model,
    modeCount,
    massMatrix,
  });
  return data.result;
}

export async function fetchConvergence(
  model: ModelDTO,
  seed: number,
  levels: number,
): Promise<ConvergenceStudy> {
  const data = await post<{ study: ConvergenceStudy }>('/convergence', {
    polygon: model.polygon,
    material: model.material,
    supports: model.supports,
    nodalLoads: model.nodalLoads,
    tractionLoads: model.tractionLoads,
    bodyLoad: model.bodyLoad,
    seed,
    levels,
  });
  return data.study;
}

export interface ExampleSummary {
  id: string;
  name: string;
  description: string;
  seed: number;
  reference: { label: string; tipDisplacement?: number; maxStress?: number; formula: string };
  vibration?: VibrationReference;
}

export interface ExampleDetail extends ModelDTO {
  id: string;
  name: string;
  description: string;
  seed: number;
  reference: ExampleSummary['reference'];
  vibration?: VibrationReference;
}

export async function fetchExamples(): Promise<ExampleSummary[]> {
  const resp = await fetch(`${BASE}/examples`);
  const data = await resp.json();
  return data.examples;
}

export async function fetchExample(id: string): Promise<ExampleDetail> {
  const resp = await fetch(`${BASE}/examples/${id}`);
  if (!resp.ok) throw new Error('载入算例失败');
  return resp.json();
}
