import { Material, HistoryResult, SineDynamicResult } from './domain';
import { AnalysisError, validateMaterialParams } from './validation';
import { HistoryParser, ParsedSineSegment } from '../history/history.parser';
import { PronyKernel, runKernelOnGrid } from '../prony/prony.kernel';
import { DynamicModulusService } from '../dynamic/dynamic-modulus.service';
import { TtsService } from '../tts/tts.service';

/**
 * 单条历程的完整粘弹分析编排：
 * 历程解析 → WLF 平移 → Prony 内核逐步递推 → 动态模量。
 * 本服务不含任何 HTTP / 持久化逻辑，便于单元测试与作业调度复用。
 */
export class AnalysisService {
  constructor(
    private readonly parser: HistoryParser,
    private readonly tts: TtsService,
    private readonly dynamic: DynamicModulusService,
  ) {}

  /**
   * 计算一条历程。任何输入/数值错误都以 AnalysisError 抛出，
   * 由作业调度层转成该历程的 failed 记录（不影响同作业其他历程）。
   */
  analyze(material: Material, historyInput: unknown): HistoryResult {
    // 材料参数防御性校验（正常入库路径已校验，这里保证直接调用内核也安全）
    validateMaterialParams(material.eInf, material.branches);
    const parsed = this.parser.parse(historyInput as never);

    // --- WLF 时温等效 ---
    let aT = 1;
    let temperature: number | undefined;
    if (parsed.temperature !== undefined) {
      temperature = parsed.temperature;
      if (!material.wlf) {
        throw new AnalysisError(
          `历程[${parsed.name}]：指定了温度 ${temperature}℃，但材料档[${material.name}]未提供 WLF 参数`,
        );
      }
      aT = this.tts.shiftFactor(material.wlf, temperature);
    } else if (material.wlf) {
      temperature = material.wlf.tRef;
      aT = 1;
    }

    // τ(T) = aT · τ_ref
    const branches = material.branches.map((b) => ({ E: b.E, tau: b.tau * aT }));

    // --- 主模拟：在用户输出网格上逐步递推 ---
    const kernel = new PronyKernel(material.eInf, branches, parsed.initialStrain);
    const snaps = runKernelOnGrid(kernel, parsed.segments, parsed.outputGrid);

    const result: HistoryResult = {
      name: parsed.name,
      status: 'success',
      shiftFactor: aT,
      temperature,
      output: {
        time: snaps.map((s) => s.time),
        strain: snaps.map((s) => s.strain),
        stress: snaps.map((s) => s.stress),
        relaxationModulus: snaps.map((s) => s.relaxationModulus),
      },
    };

    // --- 正弦段：解析动态模量（以该温度下 τ 代入） ---
    const sineSegments: Array<{ seg: ParsedSineSegment; index: number }> = [];
    parsed.segments.forEach((seg, index) => {
      if (seg.kind === 'sine') sineSegments.push({ seg, index });
    });
    if (sineSegments.length > 0) {
      const dynResults: SineDynamicResult[] = sineSegments.map(({ seg, index }) => {
        const dm = this.dynamic.compute(material.eInf, branches, seg.omega);
        return {
          segmentIndex: index,
          frequency: seg.frequency,
          omega: seg.omega,
          storageModulus: dm.storageModulus,
          lossModulus: dm.lossModulus,
          lossTangent: dm.lossTangent,
        };
      });
      result.dynamicModulus = dynResults;

      // 整条历程恰为单个正弦段时，额外做端到端数值稳态拟合（预热到收敛后取末周期），
      // 用于与 Prony 解析 E′(ω)、E″(ω) 相互印证。
      if (parsed.segments.length === 1) {
        result.steadyStateFit = this.fitSteadyState(material.eInf, branches, sineSegments[0].seg);
      }
    }

    return result;
  }

  /**
   * 稳态预热 + 末周期数值拟合。
   * 预热周期数取 max(默认, ceil(20·f·τmax))，保证瞬态衰减到 e^{-20} 以下。
   */
  private fitSteadyState(
    eInf: number,
    branches: Array<{ E: number; tau: number }>,
    seg: ParsedSineSegment,
  ): HistoryResult['steadyStateFit'] {
    const tauMax = branches.reduce((m, b) => Math.max(m, b.tau), 0);
    const warmup = Math.max(
      seg.warmupCycles,
      tauMax > 0 ? Math.ceil(20 * seg.frequency * tauMax) : seg.warmupCycles,
    );
    const samplesPerCycle = seg.pointsPerCycle;

    // 构造预热 + 1 个测量周期的内部网格（起点 t=0 取一次）
    const totalCycles = warmup + 1;
    const period = 1 / seg.frequency;
    const times: number[] = [0];
    for (let k = 1; k <= totalCycles * samplesPerCycle; k++) {
      times.push((k * period) / samplesPerCycle);
    }

    const internalSegments = [
      {
        kind: 'sine' as const,
        tStart: 0,
        duration: totalCycles * period,
        amplitude: seg.amplitude,
        omega: seg.omega,
        offset: seg.offset,
        frequency: seg.frequency,
        pointsPerCycle: seg.pointsPerCycle,
        warmupCycles: seg.warmupCycles,
      },
    ];

    const kernel = new PronyKernel(eInf, branches, seg.offset);
    const snaps = runKernelOnGrid(kernel, internalSegments, times);

    const lastCycle = snaps.slice(-samplesPerCycle);
    const fit = this.dynamic.fitFromCycle(
      lastCycle.map((s) => s.strain - seg.offset),
      lastCycle.map((s) => s.stress - eInf * seg.offset),
      seg.omega,
    );
    return {
      warmupCycles: warmup,
      samplesPerCycle,
      storageModulus: fit.storageModulus,
      lossModulus: fit.lossModulus,
      lossTangent: fit.lossTangent,
    };
  }
}
