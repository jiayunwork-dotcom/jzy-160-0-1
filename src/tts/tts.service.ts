import { AnalysisError, assertFinite, assertPositive } from '../core/validation';
import { WlfParams } from '../core/domain';

/**
 * 时温等效（WLF）模块。
 *
 * 采用常用对数约定：
 *   log10(aT) = -C1 · (T - Tref) / (C2 + T - Tref)
 *
 * 高温 T > Tref：aT < 1，等效松弛时间 τ(T) = aT·τ_ref 变短，松弛更快。
 */
export class TtsService {
  /** 计算平移因子 aT（无量纲） */
  shiftFactor(wlf: WlfParams, temperatureC: number): number {
    assertFinite(temperatureC, '温度 T');
    assertFinite(wlf.tRef, 'WLF Tref');
    assertFinite(wlf.c1, 'WLF C1');
    assertFinite(wlf.c2, 'WLF C2');
    if (wlf.c2 <= 0) {
      throw new AnalysisError(`WLF 参数非法：C2 必须 > 0，实际为 ${wlf.c2}`);
    }
    const denom = wlf.c2 + temperatureC - wlf.tRef;
    if (denom <= 0) {
      throw new AnalysisError(
        `WLF 分母 C2+T−Tref 必须 > 0，实际为 ${denom}（T=${temperatureC}, Tref=${wlf.tRef}, C2=${wlf.c2}）`,
      );
    }
    const log10aT = -wlf.c1 * (temperatureC - wlf.tRef) / denom;
    return Math.pow(10, log10aT);
  }

  /** 参考温度下的 τ 换算到给定温度：τ(T) = aT·τref */
  shiftedTau(tauRef: number, aT: number): number {
    return tauRef * aT;
  }

  validate(wlf: WlfParams): void {
    assertFinite(wlf.tRef, 'WLF Tref');
    assertFinite(wlf.c1, 'WLF C1');
    assertPositive(wlf.c2, 'WLF C2');
  }
}
