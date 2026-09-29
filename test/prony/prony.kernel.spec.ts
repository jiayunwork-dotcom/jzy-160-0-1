import { PronyKernel } from '../../src/prony/prony.kernel';

/**
 * 可以手算的单支路阶跃算例（放在内核层面，直接核对递推公式）：
 *
 *   E∞ = 2，单支路 E1 = 3，τ1 = 1
 *   ε0 = 0.05 在 t=0 瞬时施加并保持
 *
 * 则 q1(t) = 0.05·e^{-t}，
 *   σ(t) = 2·0.05 + 3·0.05·e^{-t} = 0.1 + 0.15·e^{-t}
 *
 *   t=0 : σ = 0.25
 *   t=τ : σ = 0.1 + 0.15/e        （支路贡献 0.15/e，恰剩初值 0.15 的 e⁻¹）
 *   t→∞ : σ → 0.1 = E∞·ε0
 */
describe('PronyKernel — 手算单支路阶跃算例', () => {
  const eInf = 2;
  const branches = [{ E: 3, tau: 1 }];
  const eps0 = 0.05;

  const expectedStress = (t: number) => eInf * eps0 + branches[0].E * eps0 * Math.exp(-t);
  const expectedE = (t: number) => eInf + branches[0].E * Math.exp(-t);

  let kernel: PronyKernel;
  beforeEach(() => {
    kernel = new PronyKernel(eInf, branches, eps0);
  });

  test('t=0 瞬时应力为 E0·ε0', () => {
    expect(kernel.stress()).toBeCloseTo((eInf + branches[0].E) * eps0, 14);
    expect(kernel.stress()).toBeCloseTo(0.25, 14);
    expect(kernel.relaxationModulusAt(0)).toBeCloseTo(5, 14);
  });

  test('t=τ 时支路贡献剩初值的 e⁻¹（逐步保持递推）', () => {
    // 用保持段（e0=e1=ε0）分多步推进到 t=1
    const steps = [0.1, 0.25, 0.4, 0.25]; // 合计 1.0
    let t = 0;
    for (const h of steps) {
      t += h;
      kernel.advanceLinear(t, eps0, eps0);
    }
    expect(t).toBeCloseTo(1, 12);

    // 支路部分 = σ - E∞·ε0
    const branchContribution = kernel.stress() - eInf * eps0;
    const initialBranchContribution = branches[0].E * eps0; // 0.15
    expect(branchContribution / initialBranchContribution).toBeCloseTo(Math.exp(-1), 12);

    expect(kernel.stress()).toBeCloseTo(expectedStress(1), 12);
    expect(kernel.stress()).toBeCloseTo(0.1 + 0.15 / Math.E, 12);
  });

  test('长时间保持后趋于 E∞·ε0', () => {
    let t = 0;
    const tEnd = 20; // 20·τ，瞬态残差 e^{-20}
    const n = 200;
    for (let i = 1; i <= n; i++) {
      t = (i * tEnd) / n;
      kernel.advanceLinear(t, eps0, eps0);
    }
    expect(kernel.stress()).toBeCloseTo(expectedStress(tEnd), 12);
    expect(kernel.stress()).toBeCloseTo(eInf * eps0, 7);
  });

  test('松弛模量 E(t) 与应力满足 σ(t)=E(t)·ε0', () => {
    let t = 0;
    for (let i = 1; i <= 20; i++) {
      t = i * 0.25;
      kernel.advanceLinear(t, eps0, eps0);
      expect(kernel.relaxationModulusAt(t)).toBeCloseTo(expectedE(t), 12);
      expect(kernel.stress()).toBeCloseTo(kernel.relaxationModulusAt(t) * eps0, 12);
    }
  });

  test('斜坡加载：线性段精确积分与卷积解析式一致', () => {
    // ε(t) = ε̇·t（自 0 起）。q_i 满足 q+τq̇=ε̇，精确解 q_i = ε̇τ(1-e^{-t/τ})，
    // 故 σ = E∞·ε̇·t + Σ E_i·ε̇·τ_i(1-e^{-t/τ_i})。
    const rate = 0.02;
    const k = new PronyKernel(eInf, branches, 0);
    let t = 0;
    for (let i = 1; i <= 10; i++) {
      const tNext = i * 0.1;
      k.advanceLinear(tNext, rate * t, rate * tNext);
      t = tNext;
      const exact =
        eInf * rate * t +
        branches[0].E * rate * branches[0].tau * (1 - Math.exp(-t / branches[0].tau));
      expect(k.stress()).toBeCloseTo(exact, 11);
    }
  });

  test('无支路时退化为线弹性 σ = E∞·ε', () => {
    const elastic = new PronyKernel(7, [], 0.01);
    expect(elastic.stress()).toBeCloseTo(7 * 0.01, 14);
    elastic.advanceLinear(2, 0.01, 0.03);
    expect(elastic.stress()).toBeCloseTo(7 * 0.03, 14);
    expect(elastic.relaxationModulusAt(2)).toBeCloseTo(7, 14);
  });

  test('时间倒退被拒绝', () => {
    expect(() => kernel.advanceLinear(-1, eps0, eps0)).toThrow();
  });
});

describe('PronyKernel — 正弦一步解', () => {
  test('正弦多小步与单大步结果一致（一步精确积分）', () => {
    const eInf = 1;
    const branches = [
      { E: 2, tau: 0.3 },
      { E: 1.5, tau: 2 },
    ];
    const A = 0.01;
    const omega = 2 * Math.PI * 0.5; // 0.5 Hz
    const T = 2; // 推进 2 个不同步数到同一时刻
    const fine = new PronyKernel(eInf, branches, 0);
    const n = 200;
    for (let i = 1; i <= n; i++) {
      const t = (T * i) / n;
      fine.advanceSine(t, 0, A, omega, 0);
    }
    const coarse = new PronyKernel(eInf, branches, 0);
    coarse.advanceSine(T, 0, A, omega, 0);
    expect(coarse.stress()).toBeCloseTo(fine.stress(), 10);
    expect(coarse.currentStrain).toBeCloseTo(fine.currentStrain, 10);
  });
});
