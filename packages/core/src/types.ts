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
   * 质量密度（质量/体积）。缺省时取钢材量级 STEEL_DENSITY。
   * mm-N-MPa 单位制下 ρ ≈ 7.85×10⁻⁹ t/mm³（= 7850 kg/m³）。
   */
  rho?: number;
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

/** 质量矩阵类型：lumped 集中质量（纯对角）/ consistent 一致质量（保留单元内耦合） */
export type MassMatrixType = 'lumped' | 'consistent';

/** 一阶自由振动模态（弹性变形模态，已剔除刚体模态） */
export interface VibrationMode {
  /** 阶次（从 1 开始，按频率从低到高） */
  order: number;
  /** 圆频率 ω (rad/s)，满足 ω² = φᵀKφ / φᵀMφ */
  omega: number;
  /** 固有频率 f = ω/(2π) (Hz) */
  frequencyHz: number;
  /**
   * 质量归一化振型 φ（全局自由度，扁平 [ux0,uy0,...]）：
   * φᵀ M φ = 1，约束自由度处为 0
   */
  shape: Float64Array;
  /** x 向动能占比（用于把纵向振动模态和弯曲模态区分开），∈ [0,1] */
  xKineticFraction: number;
  /** Rayleigh 商相对残差 |Kφ − ω²Mφ| / (ω²·|Mφ|) */
  residual: number;
}

export interface VibrationResult {
  modes: VibrationMode[];
  massMatrixType: MassMatrixType;
  /** 被消去的约束自由度数量 */
  constrainedDofs: number;
  /** 识别并剔除的刚体模态数量（自由/欠约束结构通常为 3） */
  rigidBodyModes: number;
  /** 参与求解的（自由）自由度数量 */
  freeDofs: number;
  diagnostics: {
    /** 子空间逆迭代步数 */
    iterations: number;
    /** 末阶模态的相对收敛容差 */
    tolerance: number;
    /** 不同模态间质量加权内积的最大绝对值（应 ≈ 0） */
    maxCrossOrthogonality: number;
    /** 装配得到的总质量（供与 ρ·V·t 核对） */
    totalMass: number;
  };
}

/** 自由振动分析选项 */
export interface VibrationOptions {
  /** 求解阶数（弹性模态），默认 6 */
  modeCount?: number;
  /** 质量矩阵类型，默认一致质量 */
  massMatrix?: MassMatrixType;
  /** 稠密逆迭代路径的自由自由度阈值（超过则走稀疏 PCG 路径） */
  denseThreshold?: number;
  /** 子空间迭代最大步数 */
  maxIterations?: number;
  /** 收敛容差（相邻两步特征值相对变化） */
  tolerance?: number;
}
