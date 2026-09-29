import { DynamicModulusService } from '../../src/dynamic/dynamic-modulus.service';

describe('DynamicModulusService', () => {
  const svc = new DynamicModulusService();
  const eInf = 2;
  const branches = [
    { E: 3, tau: 1 },
    { E: 1.5, tau: 0.1 },
  ];

  test('ω→0 时 E′→E∞、E″→0', () => {
    const dm = svc.compute(eInf, branches, 1e-9);
    expect(dm.storageModulus).toBeCloseTo(eInf, 6);
    expect(dm.lossModulus).toBeLessThan(1e-6);
    expect(dm.lossTangent).toBeLessThan(1e-6);
  });

  test('ω→∞ 时 E′→E0、E″→0', () => {
    const dm = svc.compute(eInf, branches, 1e9);
    expect(dm.storageModulus).toBeCloseTo(eInf + 4.5, 6);
    expect(dm.lossModulus).toBeLessThan(1e-6);
  });

  test('单支路解析值与定义一致', () => {
    const omega = 2;
    const x = 2; // ωτ
    const dm = svc.compute(0, [{ E: 3, tau: 1 }], omega);
    expect(dm.storageModulus).toBeCloseTo((3 * x * x) / (1 + x * x), 14);
    expect(dm.lossModulus).toBeCloseTo((3 * x) / (1 + x * x), 14);
  });

  test('由整周期理想 Lissajous 数据拟合恢复 E′、E″', () => {
    // 构造 ε=A sinθ、σ=E′ A sinθ + E″ A cosθ 的理想稳态数据
    const E = svc.compute(eInf, branches, 2 * Math.PI * 0.7);
    const A = 0.01;
    const n = 256;
    const eps: number[] = [];
    const sig: number[] = [];
    for (let k = 0; k < n; k++) {
      const theta = (2 * Math.PI * k) / n;
      eps.push(A * Math.sin(theta));
      sig.push(E.storageModulus * A * Math.sin(theta) + E.lossModulus * A * Math.cos(theta));
    }
    const fit = svc.fitFromCycle(eps, sig, 2 * Math.PI * 0.7);
    expect(fit.storageModulus).toBeCloseTo(E.storageModulus, 10);
    expect(fit.lossModulus).toBeCloseTo(E.lossModulus, 10);
    expect(fit.lossTangent).toBeCloseTo(E.lossTangent, 10);
  });
});
