import { PronyBranch } from '../core/domain';

/**
 * 动态模量模块（频域，正弦稳态）。
 *
 * 对广义 Maxwell 模型，在角频率 ω 下：
 *   E′(ω) = E∞ + Σ E_i · (ωτ_i)² / (1 + (ωτ_i)²)
 *   E″(ω) = Σ E_i · ωτ_i / (1 + (ωτ_i)²)
 *   tanδ  = E″(ω) / E′(ω)
 *
 * 温度效应通过 τ_i(T)=aT·τ_ref 进入（WLF 平移），
 * 即高温下等效频率 x=ωτ 变小，材料更软、损耗峰位置移动。
 */
export interface DynamicModulus {
  omega: number;
  storageModulus: number;
  lossModulus: number;
  lossTangent: number;
}

export class DynamicModulusService {
  /**
   * @param eInf      平衡模量
   * @param branches  该温度下的支路（τ 已平移）
   * @param omega     角频率 rad/s
   */
  compute(eInf: number, branches: PronyBranch[], omega: number): DynamicModulus {
    let storage = eInf;
    let loss = 0;
    for (const b of branches) {
      const x = omega * b.tau;
      const denom = 1 + x * x;
      storage += b.E * (x * x) / denom;
      loss += b.E * x / denom;
    }
    return {
      omega,
      storageModulus: storage,
      lossModulus: loss,
      lossTangent: storage > 0 ? loss / storage : Number.NaN,
    };
  }

  /**
   * 由稳态一个周期内的应力、应变采样，用最小二乘提取 E′、E″。
   *
   * 稳态应力写成 σ(t) = E′·ε(t) + (E″/ω)·ε̇(t)
   * （取 ε=A sin ωt，则 σ = E′ A sin ωt + E″ A cos ωt）。
   * 对 sin/cos 基做正交投影即可（整周期均匀采样下最小二乘退化为离散傅里叶系数）。
   */
  fitFromCycle(strain: number[], stress: number[], omega: number): DynamicModulus {
    const n = strain.length;
    if (n < 4) {
      throw new Error(`动态模量拟合：每周期至少需要 4 个采样点，实际 ${n}`);
    }
    // 采样覆盖一个完整周期：t_k = k/n · T
    let sumSin2 = 0;
    let sumEpsSin = 0;
    let sumEpsCos = 0;
    let sumSigSin = 0;
    let sumSigCos = 0;
    let sumEps = 0;
    let sumSig = 0;
    for (let k = 0; k < n; k++) {
      const theta = (2 * Math.PI * k) / n;
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      sumSin2 += s * s;
      sumEpsSin += strain[k] * s;
      sumEpsCos += strain[k] * c;
      sumSigSin += stress[k] * s;
      sumSigCos += stress[k] * c;
      sumEps += strain[k];
      sumSig += stress[k];
    }
    // 去除可能的直流偏置（拼接段终点未必严格零均值）
    const epsMean = sumEps / n;
    const sigMean = sumSig / n;
    let epsSin = 0;
    let epsCos = 0;
    let sigSin = 0;
    let sigCos = 0;
    for (let k = 0; k < n; k++) {
      const theta = (2 * Math.PI * k) / n;
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      epsSin += (strain[k] - epsMean) * s;
      epsCos += (strain[k] - epsMean) * c;
      sigSin += (stress[k] - sigMean) * s;
      sigCos += (stress[k] - sigMean) * c;
    }
    // ε = a sin + b cos（纯 sin 起振时 b≈0）；σ = c_s sin + c_c cos
    // σ = E′ ε + (E″/ω) ε̇，ε̇=aω cos - bω sin
    // 对 sin、cos 两个基解 2x2：
    //   [sigSin]   [epsSin  -epsCos] [E′ ]
    //   [sigCos] = [epsCos   epsSin] [E″]
    const det = epsSin * epsSin + epsCos * epsCos;
    const storage = (sigSin * epsSin + sigCos * epsCos) / det;
    const loss = (sigCos * epsSin - sigSin * epsCos) / det;
    void sumSin2;
    void sumEpsSin;
    void sumEpsCos;
    void sumSigSin;
    void sumSigCos;
    return {
      omega,
      storageModulus: storage,
      lossModulus: loss,
      lossTangent: storage !== 0 ? loss / storage : Number.NaN,
    };
  }
}
