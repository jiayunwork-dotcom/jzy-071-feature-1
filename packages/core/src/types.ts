/** 二维向量 / 坐标点 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 分析区域。
 * 外圈轮廓 outer 必须为逆时针封闭多边形；
 * holes 中的每个孔为顺时针封闭多边形。
 */
export interface Polygon {
  outer: Vec2[];
  holes: Vec2[][];
}

/** 三角形有限元网格（CST：常应变三角单元，每单元 3 节点） */
export interface Mesh {
  /** 节点坐标 */
  nodes: Vec2[];
  /** 单元连通表：每项为 3 个节点索引 */
  elements: [number, number, number][];
  /** 边界边（每条边仅属于一个单元） */
  boundaryEdges: [number, number][];
  /** 网格统计信息 */
  stats: MeshStats;
}

export interface MeshStats {
  nodeCount: number;
  elementCount: number;
  /** 全部单元中的最小内角（弧度） */
  minAngle: number;
  /** 全部单元中的最大内角（弧度） */
  maxAngle: number;
  /** 平均单元质量，质量 = 2 r_in / r_out ∈ (0,1]，正三角形为 1 */
  meanQuality: number;
  /** 最小单元质量 */
  minQuality: number;
}

export interface MeshParams {
  /** 全局种子间距（目标单元尺寸） */
  globalSeed: number;
  /** 是否对凸矩形区域优先使用结构化网格 */
  structured?: boolean;
}

/** 约束类型：固定 / 水平滑移（ux=0，仅约束 x） / 竖直滑移（uy=0，仅约束 y） */
export type SupportType = 'fixed' | 'slideX' | 'slideY';

/**
 * 边界条件/载荷的作用范围描述（用几何位置而不是节点编号描述，
 * 这样重新剖分网格后条件仍可重新映射）。
 */
export type Region =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'box'; xmin: number; ymin: number; xmax: number; ymax: number };

export interface Support {
  id: string;
  region: Region;
  type: SupportType;
  /** 非零时为指定位移（默认 0，即固定/滑移支座） */
  value?: number;
}

export interface NodalLoad {
  id: string;
  region: Region;
  fx: number;
  fy: number;
}

/**
 * 分布面力：作用在 region 指定的线段上（线段应落在边界上），
 * 单位长度力分量 (tx, ty)，最终按 1/2 长度一致地分配给边的两个端点。
 */
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
  /** 弹性模量，单位随用户（建议 mm-N-MPa 单位制） */
  E: number;
  /** 泊松比 */
  nu: number;
  /** 厚度 t（平面应力下使用；平面应变内部按 t=1 处理） */
  thickness: number;
  model: 'planeStress' | 'planeStrain';
  /**
   * 质量密度 ρ（可缺省，缺省取钢材默认值，见 STEEL_DENSITY）。
   * 在 mm-N-MPa 单位制下质量单位为 N·s²/mm，钢 ρ ≈ 7.85e-9 N·s²/mm⁴。
   * 仅自由振动分析使用；静力分析不读该字段。
   */
  density?: number;
}

/** 完整分析模型 */
export interface FemModel {
  polygon: Polygon;
  mesh: Mesh;
  material: Material;
  supports: Support[];
  nodalLoads: NodalLoad[];
  tractionLoads: TractionLoad[];
  bodyLoad?: BodyLoad;
}

/** 单元常应力结果（CST 单元内应力恒定） */
export interface ElementStress {
  /** 单元号 */
  element: number;
  sx: number;
  sy: number;
  txy: number;
  /** von Mises 等效应力 */
  vonMises: number;
}

export interface AnalysisResult {
  /** 每个节点的位移 (ux, uy)，扁平化存储 [ux0, uy0, ux1, uy1, ...] */
  displacement: Float64Array;
  /** 每个单元的应力 */
  elementStresses: ElementStress[];
  /** 节点外推应力（相邻单元平均），扁平化 [sx, sy, txy, vm] × n */
  nodalStresses: Float64Array;
  /** 等效节点力向量（装配得到的外载） */
  force: Float64Array;
  /** 支反力 K·u − F（在被约束自由度上有意义） */
  reactions: Float64Array;
  maxDisplacement: number;
  maxVonMises: number;
  maxSx: number;
  maxSy: number;
  maxTxy: number;
  /** 求解器迭代次数等诊断信息 */
  diagnostics: {
    solver: 'dense-direct' | 'cg-jacobi';
    iterations?: number;
    residual: number;
    constrainedDofs: number;
  };
}

/** 质量矩阵做法：一致（完整非对角）质量 / 集中（对角）质量 */
export type MassFormulation = 'consistent' | 'lumped';

/** 单个固有振动模态 */
export interface ModeShape {
  /** 阶号（从 1 开始，仅计非刚体弹性模态） */
  order: number;
  /** 圆频率 ω（rad/s） */
  omega: number;
  /** 工程频率 f = ω/(2π)（Hz） */
  hz: number;
  /** 特征值 ω² */
  lambda: number;
  /**
   * 归一化振型（质量归一化：φᵀMφ = 1），
   * 扁平化存储 [ux0, uy0, ux1, uy1, ...]，被约束自由度为 0。
   */
  vector: Float64Array;
  /** |Kφ − ω²Mφ| 的相对范数（残差，越小越好） */
  residual: number;
  /** Rayleigh 商 φᵀKφ / φᵀMφ（归一化后应 ≈ ω²） */
  rayleighQuotient: number;
}

export interface ModalAnalysisResult {
  modes: ModeShape[];
  /** 被识别并剔除的刚体模态数（约束不足时 > 0） */
  rigidBodyModes: number;
  /** 参与求解的（消去约束自由度后的）自由度数 */
  freeDofs: number;
  /** 约束自由度数 */
  constrainedDofs: number;
  massFormulation: MassFormulation;
  /** 总质量（所有节点 x 方向质量之和，用于核验质量守恒） */
  totalMass: number;
  /** 求解路径诊断 */
  diagnostics: {
    solver: 'dense-symmetric' | 'block-lanczos';
    iterations?: number;
  };
}

/** 模型缺少约束、刚度矩阵奇异时抛出 */
export class SingularMatrixError extends Error {
  /** 检测到的（近似）无约束机构自由度数量 */
  nullity: number;
  constructor(message: string, nullity = 0) {
    super(message);
    this.name = 'SingularMatrixError';
    this.nullity = nullity;
  }
}
