/**
 * 数值/输入校验工具。所有可预期的用户输入错误都以 AnalysisError 抛出，
 * 调度层据此把原因写入对应历史的 failed 记录。
 */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new AnalysisError(`${what} 必须是有限数值，实际为 ${String(value)}`);
  }
}

export function assertPositive(value: number, what: string): void {
  assertFinite(value, what);
  if (value <= 0) {
    throw new AnalysisError(`${what} 必须 > 0，实际为 ${value}`);
  }
}

export function assertNonNegative(value: number, what: string): void {
  assertFinite(value, what);
  if (value < 0) {
    throw new AnalysisError(`${what} 必须 >= 0，实际为 ${value}`);
  }
}

/**
 * 校验一份材料参数。
 * 规则：E∞ >= 0；E_i >= 0；τ_i > 0。
 */
export function validateMaterialParams(eInf: number, branches: Array<{ E: number; tau: number }>): void {
  assertNonNegative(eInf, 'E∞');
  if (!Array.isArray(branches)) {
    throw new AnalysisError('Prony 支路必须是数组');
  }
  branches.forEach((b, i) => {
    assertNonNegative(b.E, `支路[${i}] 的 E_i`);
    assertPositive(b.tau, `支路[${i}] 的 τ_i`);
  });
}
