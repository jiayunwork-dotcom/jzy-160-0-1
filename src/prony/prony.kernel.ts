import { PronyBranch } from '../core/domain';
import { ParsedSegment } from '../history/history.parser';

/**
 * Prony 递推内核（广义 Maxwell 模型）。
 *
 * 一维本构：
 *   σ(t) = E∞·ε(t) + Σ E_i·q_i(t)
 * 支路内变量 q_i（应变量纲）服从
 *   dq_i/dt + q_i/τ_i = dε/dt
 *
 * 对每个输出步 [t_n, t_{n+1}]，设长度 h = t_{n+1}-t_n、衰减 r = exp(-h/τ_i)，
 * 则 q_i 的更新只依赖 q_i(t_n) 与该步内应变的已知形式 —— 无需重做历史卷积，
 * 整条历程计算量 = O(步数 × 支路数)，对步数线性。
 *
 * 分段线性应变 ε(t)=e0+slope·(t-t_n)（事件链保证 e0=ε(t_n) 连续），
 * q+τq̇=ε̇ 在恒斜率强迫下精确解：
 *   q_i(t_{n+1}) = r·q_i(t_n) + slope·τ_i·(1-r)
 * 瞬时阶跃 ε0 由构造函数承担：q_i(0+)=ε0（支路瞬时承担全部应变）。
 *
 * 正弦段 ε(t)=offset+A·sin(ω(t-t_n)+φ)（令复振幅 Â=A·e^{iφ}）：
 *   q_i(t_{n+1}) = r·q_i(t_n)
 *                  + Im{ Â·[e^{iωh} - r] · iωτ_i / (1 + iωτ_i) }
 * 该式为 dq+q/τ=dε/dt 在正弦强迫下的精确一步解。
 */

/** 对接近 0 的复数 z 计算 exp(z)-1，避免相消 */
function expm1Complex(zre: number, zim: number): { re: number; im: number } {
  const mag2 = zre * zre + zim * zim;
  if (mag2 < 1e-8) {
    // exp(z)-1 = z + z²/2 + z³/6 + z⁴/24
    const z2re = zre * zre - zim * zim;
    const z2im = 2 * zre * zim;
    const z3re = z2re * zre - z2im * zim;
    const z3im = z2re * zim + z2im * zre;
    const z4re = z3re * zre - z3im * zim;
    const z4im = z3re * zim + z3im * zre;
    return {
      re: zre + z2re / 2 + z3re / 6 + z4re / 24,
      im: zim + z2im / 2 + z3im / 6 + z4im / 24,
    };
  }
  const ezre = Math.exp(zre);
  return {
    re: ezre * Math.cos(zim) - 1,
    im: ezre * Math.sin(zim),
  };
}

export interface KernelSnapshot {
  time: number;
  strain: number;
  stress: number;
  relaxationModulus: number;
}

/**
 * 顺序推进的 Prony 内核实例。
 * branches 中的 τ 应为该历程温度下的（已做 WLF 平移）松弛时间。
 */
export class PronyKernel {
  private readonly eInf: number;
  private readonly branches: PronyBranch[];
  /** 支路内变量当前值 */
  private q: number[];
  private time = 0;
  private strain: number;

  constructor(eInf: number, branches: PronyBranch[], initialStrain: number) {
    this.eInf = eInf;
    this.branches = branches;
    this.strain = initialStrain;
    // t=0 的瞬时阶跃：ε0 瞬间施加，各支路立刻承担 q_i(0+)=ε0
    this.q = branches.map(() => initialStrain);
  }

  get currentTime(): number {
    return this.time;
  }

  get currentStrain(): number {
    return this.strain;
  }

  /** 当前总应力 σ = E∞·ε + Σ E_i q_i */
  stress(): number {
    let s = this.eInf * this.strain;
    for (let i = 0; i < this.branches.length; i++) {
      s += this.branches[i].E * this.q[i];
    }
    return s;
  }

  /**
   * 单位阶跃应变（ε0=1）下的松弛模量
   *   E(t) = E∞ + Σ E_i exp(-t/τ_i)
   * τ_i 已按该历程温度平移，故这里的 t 是实际（观测）时间。
   */
  relaxationModulusAt(t: number): number {
    let e = this.eInf;
    for (const b of this.branches) {
      e += b.E * Math.exp(-t / b.tau);
    }
    return e;
  }

  /**
   * 沿分段线性区间精确推进到 tNext。
   * 区间内 ε(s) = e0 + slope·(s - t)，e1 = ε(tNext)。
   */
  advanceLinear(tNext: number, e0: number, e1: number): void {
    const h = tNext - this.time;
    if (h < -1e-14) {
      throw new Error(`PronyKernel: 时间倒退 ${this.time} -> ${tNext}`);
    }
    const slope = h > 0 ? (e1 - e0) / h : 0;
    for (let i = 0; i < this.branches.length; i++) {
      const tau = this.branches[i].tau;
      const r = Math.exp(-h / tau);
      // q+τq̇=ε̇ 在恒斜率强迫下精确解：q_{n+1}=r·q_n + slope·τ·(1-r)
      this.q[i] = r * this.q[i] + slope * tau * (1 - r);
    }
    this.time = tNext;
    this.strain = e1;
  }

  /**
   * 在正弦段内精确推进到 tNext。
   * 段内 ε(s) = offset + A·sin(ω·(s - segStart))；
   * phaseStart = 推进起点在该正弦段内的相位 ω·(time - segStart)。
   */
  advanceSine(
    tNext: number,
    segStart: number,
    amplitude: number,
    omega: number,
    offset: number,
  ): void {
    const h = tNext - this.time;
    if (h < -1e-14) {
      throw new Error(`PronyKernel: 时间倒退 ${this.time} -> ${tNext}`);
    }
    const phaseStart = omega * (this.time - segStart);
    const phaseEnd = omega * (tNext - segStart);

    for (let i = 0; i < this.branches.length; i++) {
      const tau = this.branches[i].tau;
      const r = Math.exp(-h / tau);
      const dphi = omega * h;
      // [e^{iΔφ} - r] = (e^{iΔφ}-1) + (1-r)
      const em1 = expm1Complex(0, dphi);
      const ere = 1 + em1.re - r;
      const eim = em1.im;
      // iωτ/(1+iωτ) = ((ωτ)² + iωτ)/(1+(ωτ)²)
      const x = omega * tau;
      const denom = 1 + x * x;
      const fre = (x * x) / denom;
      const fim = x / denom;
      // 乘积 Â·(ere+i eim)·(fre+i fim)
      const are = amplitude * Math.cos(phaseStart);
      const aim = amplitude * Math.sin(phaseStart);
      const pre = are * ere - aim * eim;
      const pim = are * eim + aim * ere;
      const prodIm = pre * fim + pim * fre;
      this.q[i] = r * this.q[i] + prodIm; // 取虚部
    }

    this.time = tNext;
    this.strain = offset + amplitude * Math.sin(phaseEnd);
  }
}

/**
 * 把输出时间点对齐到解析后的段结构上推进内核。
 *
 * 做法：把「段边界 + 线性段折线拐点 + 输出网格点」合并成一条有序事件链，
 * 逐事件推进。每个子步完全落在一种段（线性/正弦）之内，因此可调用对应的
 * 精确一步解。输出步数为 N、支路数为 M 时复杂度 O((N+事件数)·M)，
 * 对步数线性，不重算历史卷积。
 */
export function runKernelOnGrid(
  kernel: PronyKernel,
  segments: ParsedSegment[],
  outputTimes: number[],
): KernelSnapshot[] {
  const snapshots: KernelSnapshot[] = [];

  // 1) 收集所有结构事件（段边界、线性拐点）
  const boundaryTimes: number[] = [0];
  for (const seg of segments) {
    if (seg.duration <= 0) continue; // 零长阶跃锚点，只影响 initialStrain
    boundaryTimes.push(seg.tStart);
    boundaryTimes.push(seg.tStart + seg.duration);
    if (seg.kind === 'linear') {
      for (const iv of seg.intervals) {
        boundaryTimes.push(iv.t0);
        boundaryTimes.push(iv.t1);
      }
    }
  }

  // 2) 与输出网格合并、去重、排序
  const EPS = 1e-11;
  const merged = Array.from(new Set([...boundaryTimes, ...outputTimes])).sort((a, b) => a - b);
  const events: number[] = [];
  for (const t of merged) {
    if (events.length === 0 || t - events[events.length - 1] > EPS) {
      events.push(t);
    }
  }

  const active = segments.filter((s) => s.duration > 0);

  // 全局线性区间表（按 t0 排序）。段在时间轴上不重叠且按序拼接，
  // 故推进时只需一个单调前移的指针 —— 总扫描量 O(N+区间数)。
  type Interval = { t0: number; t1: number; e0: number; e1: number };
  const linearIntervals: Interval[] = [];
  for (const seg of active) {
    if (seg.kind === 'linear') {
      for (const iv of seg.intervals) {
        linearIntervals.push({ t0: iv.t0, t1: iv.t1, e0: iv.e0, e1: iv.e1 });
      }
    }
  }
  linearIntervals.sort((a, b) => a.t0 - b.t0);
  const sineSegs = active
    .filter((s): s is Extract<ParsedSegment, { kind: 'sine' }> => s.kind === 'sine')
    .sort((a, b) => a.tStart - b.tStart);

  let ivPtr = 0;
  let sinePtr = 0;
  let segPtr = 0;

  const locate = (t: number): { kind: 'linear'; iv: Interval } | { kind: 'sine'; seg: Extract<ParsedSegment, { kind: 'sine' }> } => {
    while (segPtr < active.length - 1 && t > active[segPtr].tStart + active[segPtr].duration + EPS) {
      segPtr++;
    }
    const seg = active[segPtr];
    if (seg.kind === 'linear') {
      while (ivPtr < linearIntervals.length - 1 && t > linearIntervals[ivPtr].t1 + 1e-14) {
        ivPtr++;
      }
      return { kind: 'linear', iv: linearIntervals[ivPtr] };
    }
    while (sinePtr < sineSegs.length - 1 && t > sineSegs[sinePtr].tStart + sineSegs[sinePtr].duration + EPS) {
      sinePtr++;
    }
    return { kind: 'sine', seg: sineSegs[sinePtr] };
  };

  let outIdx = 0;
  let prevT = 0;

  // 3) 逐事件推进
  for (const t of events) {
    if (t > 0 && t > prevT + EPS) {
      // 用子步中点判定该步属于哪一段（严格落在单段内部）
      const where = locate((prevT + t) / 2);
      if (where.kind === 'linear') {
        const { iv } = where;
        const f0 = Math.min(1, Math.max(0, (prevT - iv.t0) / (iv.t1 - iv.t0)));
        const f1 = Math.min(1, Math.max(0, (t - iv.t0) / (iv.t1 - iv.t0)));
        kernel.advanceLinear(t, iv.e0 + f0 * (iv.e1 - iv.e0), iv.e0 + f1 * (iv.e1 - iv.e0));
      } else {
        const { seg } = where;
        kernel.advanceSine(t, seg.tStart, seg.amplitude, seg.omega, seg.offset);
      }
      prevT = t;
    }

    // 4) 在与输出点重合的事件处采样
    while (outIdx < outputTimes.length && Math.abs(outputTimes[outIdx] - t) <= EPS) {
      const ot = outputTimes[outIdx];
      snapshots.push({
        time: ot,
        strain: kernel.currentStrain,
        // 采样处的松弛模量 E(t) 与应变形式无关，直接按时间计算
        stress: kernel.stress(),
        relaxationModulus: kernel.relaxationModulusAt(ot),
      });
      outIdx++;
    }
  }

  return snapshots;
}
