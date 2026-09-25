/**
 * 前后端数据传输的序列化/反序列化。
 * Float64Array 以普通 number[] 传输；模型中的几何与条件保持 JSON 友好结构。
 */
import type {
  AnalysisResult,
  FemModel,
  Material,
  Mesh,
  Polygon,
} from './types.js';

export interface MeshDTO {
  nodes: Array<{ x: number; y: number }>;
  elements: [number, number, number][];
  boundaryEdges: [number, number][];
  stats: Mesh['stats'];
}

export interface ModelDTO {
  polygon: Polygon;
  mesh: MeshDTO;
  material: Material;
  supports: FemModel['supports'];
  nodalLoads: FemModel['nodalLoads'];
  tractionLoads: FemModel['tractionLoads'];
  bodyLoad?: FemModel['bodyLoad'];
}

export interface ResultDTO {
  displacement: number[];
  elementStresses: AnalysisResult['elementStresses'];
  nodalStresses: number[];
  force: number[];
  reactions: number[];
  maxDisplacement: number;
  maxVonMises: number;
  maxSx: number;
  maxSy: number;
  maxTxy: number;
  diagnostics: AnalysisResult['diagnostics'];
}

export function meshToModel(dto: ModelDTO): FemModel {
  const mesh: Mesh = {
    nodes: dto.mesh.nodes.map((p) => ({ x: p.x, y: p.y })),
    elements: dto.mesh.elements.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
    boundaryEdges: dto.mesh.boundaryEdges.map((e) => [e[0], e[1]] as [number, number]),
    stats: dto.mesh.stats,
  };
  return {
    polygon: dto.polygon,
    mesh,
    material: dto.material,
    supports: dto.supports ?? [],
    nodalLoads: dto.nodalLoads ?? [],
    tractionLoads: dto.tractionLoads ?? [],
    bodyLoad: dto.bodyLoad,
  };
}

export function resultToDTO(r: AnalysisResult): ResultDTO {
  return {
    displacement: Array.from(r.displacement),
    elementStresses: r.elementStresses,
    nodalStresses: Array.from(r.nodalStresses),
    force: Array.from(r.force),
    reactions: Array.from(r.reactions),
    maxDisplacement: r.maxDisplacement,
    maxVonMises: r.maxVonMises,
    maxSx: r.maxSx,
    maxSy: r.maxSy,
    maxTxy: r.maxTxy,
    diagnostics: r.diagnostics,
  };
}
