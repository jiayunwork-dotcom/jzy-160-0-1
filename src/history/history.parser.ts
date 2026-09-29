import { AnalysisError, assertFinite, assertPositive } from '../core/validation';
import {
  HistorySegmentDto,
  OutputGridDto,
  StrainHistory,
} from '../core/domain';

/**
 * 解析后的一个分段线性区间 [t0,t1]，区间内
 *   ε(s) = e0 + slope·(s - t0)
 */
export interface LinearInterval {
  t0: number;
  t1: number;
  e0: number;
  e1: number;
  slope: number;
}

/** 解析后的正弦段：ε(s) = offset + amp·sin(ω·s)，s∈[0,duration] */
export interface ParsedSineSegment {
  kind: 'sine';
  tStart: number; // 全局起始时间
  duration: number;
  amplitude: number;
  omega: number;
  offset: number;
  frequency: number;
  pointsPerCycle: number;
  /** 动态模量分析时的稳态预热周期数（采样只覆盖末周期） */
  warmupCycles: number;
}

export interface ParsedLinearSegment {
  kind: 'linear';
  tStart: number;
  intervals: LinearInterval[];
  duration: number;
}

export type ParsedSegment = ParsedLinearSegment | ParsedSineSegment;

export interface ParsedHistory {
  name: string;
  /** t=0+ 的初始应变（线性首段单点 0 表示瞬时阶跃到该应变） */
  initialStrain: number;
  segments: ParsedSegment[];
  totalTime: number;
  outputGrid: number[];
  temperature?: number;
  raw: StrainHistory;
}

const DEFAULT_POINTS_PER_CYCLE = 128;
const DEFAULT_OUTPUT_COUNT = 201;
/** 稳态预热周期数下限（实际还会按 20·f·τmax 放大，在内核分析服务里处理） */
export const DEFAULT_WARMUP_CYCLES = 20;

/** 段衔接处应变连续性的数值容差 */
const JUNCTION_TOL = 1e-12;

/**
 * 历程解析器：
 * - 校验控制点时间严格递增、正弦频率>0、周期数>0；
 * - 段内/段间时间累加为全局时间；
 * - 检查段衔接处应变连续；
 * - 生成等距输出时间网格并校验其落在历程时间范围内。
 */
export class HistoryParser {
  parse(history: StrainHistory): ParsedHistory {
    const name = history.name;
    if (!history.segments || history.segments.length === 0) {
      throw new AnalysisError(`历程[${name}]：至少需要一个段`);
    }

    let cursor = 0; // 全局时间游标
    let prevEndStrain: number | null = null;
    const segments: ParsedSegment[] = [];
    let initialStrain = 0;

    history.segments.forEach((seg, idx) => {
      if (seg.kind === 'linear') {
        const parsed = this.parseLinear(seg, idx, cursor, prevEndStrain, name);
        if (idx === 0) {
          initialStrain = parsed.initialStrain;
        }
        segments.push(parsed.segment);
        cursor = parsed.segment.tStart + parsed.segment.duration;
        prevEndStrain = parsed.endStrain;
      } else if (seg.kind === 'sine') {
        const parsed = this.parseSine(seg, idx, cursor, prevEndStrain, name);
        if (idx === 0) {
          initialStrain = parsed.segment.offset;
        }
        segments.push(parsed.segment);
        cursor = parsed.segment.tStart + parsed.segment.duration;
        prevEndStrain = parsed.endStrain;
      } else {
        throw new AnalysisError(`历程[${name}] 段[${idx}]：未知段类型 "${(seg as HistorySegmentDto).kind}"`);
      }
    });

    const totalTime = cursor;
    if (!(totalTime > 0)) {
      throw new AnalysisError(`历程[${name}]：历程总时长必须 > 0`);
    }

    const outputGrid = this.buildOutputGrid(history.output, totalTime, name);

    return {
      name,
      initialStrain,
      segments,
      totalTime,
      outputGrid,
      temperature: history.temperature,
      raw: history,
    };
  }

  private parseLinear(
    seg: Extract<HistorySegmentDto, { kind: 'linear' }>,
    idx: number,
    tStart: number,
    prevEndStrain: number | null,
    historyName: string,
  ): { segment: ParsedLinearSegment; endStrain: number; initialStrain: number } {
    const pts = seg.points;
    if (!Array.isArray(pts) || pts.length === 0) {
      throw new AnalysisError(`历程[${historyName}] 线性段[${idx}]：至少需要一个控制点`);
    }

    pts.forEach((p, j) => {
      assertFinite(p.t, `历程[${historyName}] 线性段[${idx}] 控制点[${j}].t`);
      assertFinite(p.strain, `历程[${historyName}] 线性段[${idx}] 控制点[${j}].strain`);
      if (j > 0 && !(p.t > pts[j - 1].t)) {
        throw new AnalysisError(
          `历程[${historyName}] 线性段[${idx}]：控制点时间必须严格递增，` +
            `控制点[${j - 1}].t=${pts[j - 1].t}，控制点[${j}].t=${p.t}`,
        );
      }
      if (j === 0 && p.t < 0) {
        throw new AnalysisError(`历程[${historyName}] 线性段[${idx}]：首个控制点时间不能为负（t=${p.t}）`);
      }
    });

    // 单控制点且为第一段且 t=0：表示 t=0 瞬时阶跃初值，活动段从 0 开始持续保持
    let intervals: LinearInterval[] = [];
    let initialStrain = 0;
    let duration: number;
    let endStrain: number;

    if (pts.length === 1 && idx === 0 && pts[0].t === 0) {
      // 阶跃 + 保持：持续时间由后续段决定；本段本身时长为 0，
      // 保持区间在与下一段（或保持段）拼接时生成。这里记录初值，生成零长段。
      initialStrain = pts[0].strain;
      duration = 0;
      endStrain = pts[0].strain;
    } else {
      // 普通多点线性段；第一个点的时间为段内相对起点，
      // 若第一段首点 t>0，则 t=0 应变取 0（空程）。
      let firstLocalT = pts[0].t;
      let baseStrain: number;
      if (idx === 0 && firstLocalT > 0) {
        baseStrain = 0;
      } else if (idx === 0) {
        baseStrain = pts[0].strain;
        if (firstLocalT !== 0) {
          throw new AnalysisError(
            `历程[${historyName}] 线性段[${idx}]：首段首个控制点必须在 t=0（阶跃初值）或 t>0（零应变空程）`,
          );
        }
        firstLocalT = 0;
      } else {
        // 后续段：段内时间从 0 起算，首点应变必须与上一段终点连续
        if (pts[0].t !== 0) {
          throw new AnalysisError(
            `历程[${historyName}] 线性段[${idx}]：后续段的首个控制点必须位于段内 t=0`,
          );
        }
        baseStrain = pts[0].strain;
        if (prevEndStrain !== null && Math.abs(baseStrain - prevEndStrain) > JUNCTION_TOL) {
          throw new AnalysisError(
            `历程[${historyName}] 线性段[${idx}]：段起点应变 ${baseStrain} 与上一段终点应变 ${prevEndStrain} 不连续`,
          );
        }
        firstLocalT = 0;
      }

      if (idx === 0) {
        initialStrain = baseStrain;
      }

      // 生成区间；首段 t>0 空程补一个 [0,firstT] 的零应变区间
      const anchors: Array<{ t: number; e: number }> = [];
      if (idx === 0 && pts[0].t > 0) {
        anchors.push({ t: 0, e: 0 });
      }
      pts.forEach((p) => anchors.push({ t: p.t, e: p.strain }));

      for (let k = 1; k < anchors.length; k++) {
        const a = anchors[k - 1];
        const b = anchors[k];
        const dt = b.t - a.t;
        if (!(dt > 0)) {
          throw new AnalysisError(
            `历程[${historyName}] 线性段[${idx}]：控制点时间必须严格递增（${a.t} -> ${b.t}）`,
          );
        }
        intervals.push({
          t0: tStart + a.t,
          t1: tStart + b.t,
          e0: a.e,
          e1: b.e,
          slope: (b.e - a.e) / dt,
        });
      }
      duration = anchors[anchors.length - 1].t - anchors[0].t;
      endStrain = anchors[anchors.length - 1].e;
    }

    return {
      segment: { kind: 'linear', tStart, intervals, duration },
      endStrain,
      initialStrain,
    };
  }

  private parseSine(
    seg: Extract<HistorySegmentDto, { kind: 'sine' }>,
    idx: number,
    tStart: number,
    prevEndStrain: number | null,
    historyName: string,
  ): { segment: ParsedSineSegment; endStrain: number } {
    assertPositive(seg.frequency, `历程[${historyName}] 正弦段[${idx}] 频率`);
    assertPositive(seg.cycles, `历程[${historyName}] 正弦段[${idx}] 周期数`);
    assertFinite(seg.amplitude, `历程[${historyName}] 正弦段[${idx}] 幅值`);
    const pointsPerCycle = seg.pointsPerCycle ?? DEFAULT_POINTS_PER_CYCLE;
    if (!Number.isInteger(pointsPerCycle) || pointsPerCycle < 4) {
      throw new AnalysisError(
        `历程[${historyName}] 正弦段[${idx}]：每周期点数必须是 >=4 的整数，实际为 ${pointsPerCycle}`,
      );
    }

    const offset = seg.offset ?? (idx === 0 ? 0 : prevEndStrain ?? 0);
    assertFinite(offset, `历程[${historyName}] 正弦段[${idx}] 偏置`);
    if (idx > 0 && prevEndStrain !== null && Math.abs(offset - prevEndStrain) > JUNCTION_TOL) {
      throw new AnalysisError(
        `历程[${historyName}] 正弦段[${idx}]：段起点应变（offset=${offset}）与上一段终点应变 ${prevEndStrain} 不连续`,
      );
    }

    const period = 1 / seg.frequency;
    const duration = seg.cycles * period;
    // 正弦段以 sin(0)=0 起，整周期结束，终点应变 = offset，与下一段 offset 衔接
    const endStrain = offset;

    return {
      segment: {
        kind: 'sine',
        tStart,
        duration,
        amplitude: seg.amplitude,
        omega: 2 * Math.PI * seg.frequency,
        offset,
        frequency: seg.frequency,
        pointsPerCycle,
        warmupCycles: DEFAULT_WARMUP_CYCLES,
      },
      endStrain,
    };
  }

  private buildOutputGrid(grid: OutputGridDto | undefined, totalTime: number, historyName: string): number[] {
    let tStart = 0;
    let tEnd = totalTime;
    let count = DEFAULT_OUTPUT_COUNT;

    if (grid) {
      assertFinite(grid.tStart, `历程[${historyName}] 输出网格 tStart`);
      assertFinite(grid.tEnd, `历程[${historyName}] 输出网格 tEnd`);
      if (!Number.isInteger(grid.count) || grid.count < 2) {
        throw new AnalysisError(`历程[${historyName}] 输出网格：count 必须是 >=2 的整数`);
      }
      tStart = grid.tStart;
      tEnd = grid.tEnd;
      count = grid.count;
    }

    if (tStart < 0) {
      throw new AnalysisError(`历程[${historyName}] 输出网格：tStart 不能为负（${tStart}）`);
    }
    if (!(tEnd > tStart)) {
      throw new AnalysisError(`历程[${historyName}] 输出网格：必须满足 tEnd > tStart（${tStart} -> ${tEnd}）`);
    }
    if (tEnd > totalTime + 1e-12) {
      throw new AnalysisError(
        `历程[${historyName}] 输出网格：tEnd=${tEnd} 超出历程时间范围 [0, ${totalTime}]`,
      );
    }
    if (tStart > totalTime) {
      throw new AnalysisError(
        `历程[${historyName}] 输出网格：tStart=${tStart} 超出历程时间范围 [0, ${totalTime}]`,
      );
    }

    const out = new Array<number>(count);
    const dt = (tEnd - tStart) / (count - 1);
    for (let i = 0; i < count; i++) {
      out[i] = tStart + dt * i;
    }
    // 保证末点恰好为 tEnd，避免浮点漂移
    out[count - 1] = tEnd;
    return out;
  }
}
