import { Material, StrainHistory } from '../src/core/domain';
import { HistoryParser } from '../src/history/history.parser';
import { TtsService } from '../src/tts/tts.service';
import { DynamicModulusService } from '../src/dynamic/dynamic-modulus.service';
import { AnalysisService } from '../src/core/analysis.service';

/** 构造分析服务（纯内存，无数据库依赖） */
export function makeAnalysisService(): AnalysisService {
  return new AnalysisService(new HistoryParser(), new TtsService(), new DynamicModulusService());
}

export function makeMaterial(partial: Partial<Material> = {}): Material {
  return {
    id: partial.id ?? 'mat-test',
    name: partial.name ?? '测试橡胶',
    description: partial.description,
    eInf: partial.eInf ?? 1,
    branches: partial.branches ?? [],
    wlf: partial.wlf === undefined ? null : partial.wlf,
    e0:
      partial.e0 ??
      (partial.eInf ?? 1) + (partial.branches ?? []).reduce((s, b) => s + b.E, 0),
    createdAt: partial.createdAt ?? new Date(0),
    updatedAt: partial.updatedAt ?? new Date(0),
  };
}

/** 阶跃 + 保持：t=0 瞬时施加应变 eps0，之后保持 */
export function stepHoldHistory(name: string, eps0: number, holdTime: number, count = 201): StrainHistory {
  return {
    name,
    segments: [{ kind: 'linear', points: [{ t: 0, strain: eps0 }] }, { kind: 'linear', points: [
      { t: 0, strain: eps0 },
      { t: holdTime, strain: eps0 },
    ] }],
    output: { tStart: 0, tEnd: holdTime, count },
  };
}

/** 等距输出网格的线性折线历程 */
export function linearHistory(
  name: string,
  points: Array<{ t: number; strain: number }>,
  tEnd: number,
  count = 201,
  tStart = 0,
): StrainHistory {
  return {
    name,
    segments: [{ kind: 'linear', points }],
    output: { tStart, tEnd, count },
  };
}

/** 单正弦段历程 */
export function sineHistory(
  name: string,
  amplitude: number,
  frequency: number,
  cycles: number,
  extra: Partial<StrainHistory> = {},
  pointsPerCycle = 128,
): StrainHistory {
  return {
    name,
    segments: [
      {
        kind: 'sine',
        amplitude,
        frequency,
        cycles,
        pointsPerCycle,
      },
    ],
    output: { tStart: 0, tEnd: cycles / frequency, count: cycles * 32 + 1 },
    ...extra,
  };
}

/** 在结果数组里找最接近 t 的下标 */
export function indexNear(arr: number[], t: number): number {
  let best = 0;
  let bestD = Math.abs(arr[0] - t);
  for (let i = 1; i < arr.length; i++) {
    const d = Math.abs(arr[i] - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function valueNear(arr: number[], t: number): number {
  return arr[indexNear(arr, t)];
}
