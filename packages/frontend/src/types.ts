/** 前端使用的类型（与后端 core 类型对应，使用普通数组便于 JSON 传输） */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Polygon {
  outer: Vec2[];
  holes: Vec2[][];
}

export interface MeshStats {
  nodeCount: number;
  elementCount: number;
  minAngle: number;
  maxAngle: number;
  meanQuality: number;
  minQuality: number;
}

export interface Mesh {
  nodes: Vec2[];
  elements: [number, number, number][];
  boundaryEdges: [number, number][];
  stats: MeshStats;
}

export type Region =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'box'; xmin: number; ymin: number; xmax: number; ymax: number };

export type SupportType = 'fixed' | 'slideX' | 'slideY';

export interface Support {
  id: string;
  region: Region;
  type: SupportType;
  value?: number;
}

export interface NodalLoad {
  id: string;
  region: Region;
  fx: number;
  fy: number;
}

export interface TractionLoad {
  id: string;
  region: Region;
  tx: number;
  ty: number;
}

export interface BodyLoad {
  fx: number;
  fy: number;
}

export interface Material {
  E: number;
  nu: number;
  thickness: number;
  model: 'planeStress' | 'planeStrain';
  /** 质量密度（kg/mm³），缺省钢材 7.85×10⁻⁶ */
  rho?: number;
}

export interface ModelDTO {
  polygon: Polygon;
  mesh: Mesh;
  material: Material;
  supports: Support[];
  nodalLoads: NodalLoad[];
  tractionLoads: TractionLoad[];
  bodyLoad?: BodyLoad;
}

export interface ElementStress {
  element: number;
  sx: number;
  sy: number;
  txy: number;
  vonMises: number;
}

export interface ResultDTO {
  displacement: number[];
  elementStresses: ElementStress[];
  nodalStresses: number[];
  force: number[];
  reactions: number[];
  maxDisplacement: number;
  maxVonMises: number;
  maxSx: number;
  maxSy: number;
  maxTxy: number;
  diagnostics: {
    solver: string;
    iterations?: number;
    residual: number;
    constrainedDofs: number;
  };
}

export interface ConvergenceLevel {
  level: number;
  seed: number;
  nodeCount: number;
  elementCount: number;
  maxVonMises: number;
  maxDisplacement: number;
  maxSx: number;
}

export interface ConvergenceStudy {
  levels: ConvergenceLevel[];
  error?: string;
}

export type ToolMode =
  | 'draw'
  | 'drag'
  | 'support'
  | 'load'
  | 'traction'
  | 'pan';

export type StressField = 'sx' | 'sy' | 'txy' | 'vm';

export type MassMatrixType = 'consistent' | 'lumped';

export interface VibrationMode {
  order: number;
  omega: number;
  frequencyHz: number;
  shape: number[];
  xKineticFraction: number;
  residual: number;
}

export interface VibrationResult {
  modes: VibrationMode[];
  massMatrixType: MassMatrixType;
  constrainedDofs: number;
  rigidBodyModes: number;
  freeDofs: number;
  diagnostics: {
    iterations: number;
    tolerance: number;
    maxCrossOrthogonality: number;
    totalMass: number;
  };
}

export interface VibrationReferenceFrequency {
  order: number;
  label: string;
  hz: number;
  kind: 'bending' | 'longitudinal' | 'other';
}

export interface VibrationReference {
  label: string;
  formula: string;
  frequencies: VibrationReferenceFrequency[];
}
