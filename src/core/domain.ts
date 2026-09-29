/**
 * 领域模型类型定义（与持久化无关）。
 *
 * 应力约定：广义 Maxwell 模型（Prony 级数），一维松弛型本构
 *   σ(t) = E∞·ε(t) + Σ E_i·q_i(t)
 * 其中 q_i 为无量纲支路内变量（应变量纲），递推见 prony 内核。
 */

/** 一条 Maxwell 支路：模量 E_i 与松弛时间 τ_i（秒） */
export interface PronyBranch {
  /** 支路模量（与 E∞ 同量纲，必须 >= 0） */
  E: number;
  /** 松弛时间（秒，必须 > 0） */
  tau: number;
}

/** 可选 WLF 时温等效参数：log10(aT) = -C1 (T - Tref) / (C2 + T - Tref) */
export interface WlfParams {
  /** 参考温度（摄氏度） */
  tRef: number;
  /** WLF C1 */
  c1: number;
  /** WLF C2（摄氏度，必须 > 0） */
  c2: number;
}

/** 具名材料档 */
export interface Material {
  id: string;
  name: string;
  description?: string;
  /** 平衡（长期）模量 */
  eInf: number;
  branches: PronyBranch[];
  wlf?: WlfParams | null;
  /** 瞬时模量 E0 = E∞ + ΣE_i，服务端计算回显 */
  e0: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 分段线性控制点（应变历程的一种段类型） */
export interface StrainPoint {
  /** 段内相对时间（秒），严格递增；第一段可为单点 0，表示瞬时阶跃初值 */
  t: number;
  strain: number;
}

/**
 * 一段正弦：strain(relativeTime) = offset + amplitude·sin(2π f·s)
 * s 为该段内相对时间。相邻正弦段自动沿用上一段终点应变/相位，
 * offset 仅对显式给出的段生效。
 */
export interface SineSegmentDto {
  kind: 'sine';
  amplitude: number;
  /** 频率 Hz，必须 > 0 */
  frequency: number;
  /** 周期数，必须 > 0 */
  cycles: number;
  /** 直流偏置（首段缺省 0） */
  offset?: number;
  /** 每周期离散点数，缺省 128 */
  pointsPerCycle?: number;
}

/** 分段线性段 */
export interface LinearSegmentDto {
  kind: 'linear';
  points: StrainPoint[];
}

export type HistorySegmentDto = LinearSegmentDto | SineSegmentDto;

/** 一条应变历程 */
export interface StrainHistory {
  name: string;
  segments: HistorySegmentDto[];
  /** 该历程恒定温度（摄氏度），缺省为参考温度（不平移） */
  temperature?: number;
  /** 输出时间网格：起点、终点（秒）、点数（含两端） */
  output?: OutputGridDto;
}

export interface OutputGridDto {
  tStart: number;
  tEnd: number;
  /** 等距输出点数，必须 >= 2 */
  count: number;
}

/** 单条历程的计算结果 */
export interface HistoryResult {
  name: string;
  status: 'success' | 'failed';
  /** 失败原因（status=failed 时存在） */
  error?: string;
  /** 该历程使用的 WLF 平移因子；未使用 WLF 时为 1 */
  shiftFactor?: number;
  /** 该历程温度（摄氏度） */
  temperature?: number;
  output?: {
    time: number[];
    strain: number[];
    stress: number[];
    /** 松弛模量 E(t)（MPa 等，与 E∞ 同量纲），已按 aT 在时间轴上平移 */
    relaxationModulus: number[];
  };
  /** 各正弦段的稳态动态模量（解析值） */
  dynamicModulus?: SineDynamicResult[];
  /** 单正弦段历程的端到端数值稳态拟合（与解析值互校） */
  steadyStateFit?: {
    warmupCycles: number;
    samplesPerCycle: number;
    storageModulus: number;
    lossModulus: number;
    lossTangent: number;
  };
}

/** 单个正弦段的储能/损耗结果 */
export interface SineDynamicResult {
  /** 段在整条历程中的序号（0 起） */
  segmentIndex: number;
  frequency: number;
  /** 储能模量 E′(ω) */
  storageModulus: number;
  /** 损耗模量 E″(ω) */
  lossModulus: number;
  /** 损耗角正切 tanδ = E″/E′ */
  lossTangent: number;
  /** 分析时该温度下采用的角频率（=2πf，未做额外平移，平移体现在 τ 上） */
  omega: number;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobHistoryState {
  name: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
}

export interface Job {
  id: string;
  materialId: string;
  status: JobStatus;
  histories: JobHistoryState[];
  results: HistoryResult[];
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
}

/** 提交作业的载荷 */
export interface SubmitJobDto {
  materialId: string;
  histories: StrainHistory[];
}
