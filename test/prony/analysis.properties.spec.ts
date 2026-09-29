import { AnalysisService } from '../../src/core/analysis.service';
import { AnalysisError } from '../../src/core/validation';
import { StrainHistory } from '../../src/core/domain';
import {
  indexNear,
  linearHistory,
  makeAnalysisService,
  makeMaterial,
  sineHistory,
  stepHoldHistory,
  valueNear,
} from '../helpers';

/**
 * 通过 AnalysisService（解析 + WLF + 内核 + 动态模量）端到端验证
 * 需求中列出的全部物理/数值性质。
 */
describe('AnalysisService — 粘弹核算性质', () => {
  let svc: AnalysisService;
  const wlf = { tRef: 20, c1: 17.44, c2: 51.6 };

  beforeEach(() => {
    svc = makeAnalysisService();
  });

  const material = () =>
    makeMaterial({
      eInf: 2,
      branches: [
        { E: 3, tau: 1 },
        { E: 1.5, tau: 5 },
        { E: 0.5, tau: 20 },
      ],
      wlf,
    });

  describe('阶跃应变', () => {
    test('σ(t) = E(t)·ε0，t≫τmax 时趋于 E∞·ε0', () => {
      // 末端（400s = 20×τmax=20）瞬态残差 e^{-20}，趋于平衡
      const eps0 = 0.04;
      const res = svc.analyze(material(), stepHoldHistory('step', eps0, 400, 1001));
      expect(res.status).toBe('success');
      const { time, stress, relaxationModulus } = res.output!;

      for (let i = 0; i < time.length; i += 40) {
        expect(stress[i]).toBeCloseTo(relaxationModulus[i] * eps0, 10);
      }
      // t=0+ 为 E0·ε0
      expect(stress[0]).toBeCloseTo((2 + 3 + 1.5 + 0.5) * eps0, 10);
      const tail = stress[stress.length - 1];
      expect(tail).toBeCloseTo(2 * eps0, 5);
      expect(Math.abs(tail - 2 * eps0)).toBeLessThan((2 + 5) * eps0 * 1e-6);
    });

    test('无支路时退化为线弹性 σ = E∞·ε', () => {
      const elastic = makeMaterial({ eInf: 4.2, branches: [] });
      const res = svc.analyze(
        elastic,
        linearHistory(
          'ramp',
          [
            { t: 0, strain: 0 },
            { t: 10, strain: 0.08 },
          ],
          10,
          101,
        ),
      );
      expect(res.status).toBe('success');
      res.output!.time.forEach((t, i) => {
        const eps = 0.008 * t;
        expect(res.output!.stress[i]).toBeCloseTo(4.2 * eps, 12);
        expect(res.output!.relaxationModulus[i]).toBeCloseTo(4.2, 12);
      });
      // E0 回显等于 E∞
      expect(elastic.e0).toBeCloseTo(4.2, 14);
    });
  });

  describe('线性与时移不变性', () => {
    test('两条历程应变相加，应力等于各自应力之和', () => {
      const mat = material();
      const hA = linearHistory(
        'A',
        [
          { t: 0, strain: 0 },
          { t: 5, strain: 0.02 },
          { t: 10, strain: 0.02 },
        ],
        10,
        201,
      );
      const hB = linearHistory(
        'B',
        [
          { t: 0, strain: 0 },
          { t: 3, strain: 0 },
          { t: 8, strain: -0.015 },
          { t: 10, strain: -0.015 },
        ],
        10,
        201,
      );
      // 合并控制点（取并集时刻），应变逐点相加
      const knots = [0, 3, 5, 8, 10];
      const epsA = (t: number) =>
        t <= 5 ? (0.02 / 5) * t : 0.02;
      const epsB = (t: number) => (t <= 3 ? 0 : t <= 8 ? (-0.015 / 5) * (t - 3) : -0.015);
      const hSum = linearHistory(
        'sum',
        knots.map((t) => ({ t, strain: epsA(t) + epsB(t) })),
        10,
        201,
      );

      const rA = svc.analyze(mat, hA);
      const rB = svc.analyze(mat, hB);
      const rSum = svc.analyze(mat, hSum);

      for (let i = 0; i < 201; i++) {
        expect(rSum.output!.stress[i]).toBeCloseTo(rA.output!.stress[i] + rB.output!.stress[i], 10);
      }
    });

    test('整条历程时间平移，应力同样平移', () => {
      const mat = material();
      // 先一段零应变空程 Δ=4s，再重复同一斜坡——等价于把应力响应右移 4s
      const base = linearHistory(
        'base',
        [
          { t: 0, strain: 0 },
          { t: 2, strain: 0.03 },
          { t: 6, strain: 0.03 },
        ],
        6,
        121,
      );
      const shift = 4;
      const shifted: StrainHistory = {
        name: 'shifted',
        segments: [
          {
            kind: 'linear',
            points: [
              { t: 0, strain: 0 },
              { t: shift, strain: 0 },
              { t: shift + 2, strain: 0.03 },
              { t: shift + 6, strain: 0.03 },
            ],
          },
        ],
        output: { tStart: shift, tEnd: shift + 6, count: 121 },
      };

      const rBase = svc.analyze(mat, base);
      const rShift = svc.analyze(mat, shifted);

      rBase.output!.time.forEach((tb, i) => {
        expect(rShift.output!.time[i]).toBeCloseTo(tb + shift, 10);
        expect(rShift.output!.stress[i]).toBeCloseTo(rBase.output!.stress[i], 10);
      });
    });

    test('所有 τ 与时间轴同乘 k，应力曲线按时间缩放后不变', () => {
      const k = 3.7;
      const base = material();
      const scaledMat = makeMaterial({
        eInf: base.eInf,
        branches: base.branches.map((b) => ({ E: b.E, tau: b.tau * k })),
        wlf: null,
      });

      // 基础历程 0..10s，缩放历程控制点与输出网格同乘 k
      const hBase = stepHoldHistory('base', 0.02, 10, 101);
      const hScaled: StrainHistory = {
        name: 'scaled',
        segments: [
          { kind: 'linear', points: [{ t: 0, strain: 0.02 }] },
          { kind: 'linear', points: [
            { t: 0, strain: 0.02 },
            { t: 10 * k, strain: 0.02 },
          ] },
        ],
        output: { tStart: 0, tEnd: 10 * k, count: 101 },
      };

      const rBase = svc.analyze(base, hBase);
      const rScaled = svc.analyze(scaledMat, hScaled);

      rBase.output!.time.forEach((tb, i) => {
        expect(rScaled.output!.time[i]).toBeCloseTo(tb * k, 9);
        expect(rScaled.output!.stress[i]).toBeCloseTo(rBase.output!.stress[i], 10);
      });
    });
  });

  describe('网格收敛性', () => {
    test('输出网格加密一倍，同一时刻应力变化不超过容差', () => {
      const mat = material();
      const h = (count: number) =>
        linearHistory(
          'h',
          [
            { t: 0, strain: 0 },
            { t: 2, strain: 0.01 },
            { t: 6, strain: 0.04 },
            { t: 10, strain: 0.02 },
          ],
          10,
          count,
        );
      const coarse = svc.analyze(mat, h(101)).output!;
      const fine = svc.analyze(mat, h(201)).output!;

      // 粗网格每个节点在细网格上都存在（dt 0.1，细 dt 0.05）
      coarse.time.forEach((t, i) => {
        const j = indexNear(fine.time, t);
        const tol = 1e-8 * (1 + Math.abs(fine.stress[j]));
        expect(Math.abs(fine.stress[j] - coarse.stress[i])).toBeLessThan(tol);
      });
    });
  });

  describe('正弦稳态动态模量', () => {
    test('数值稳态 E′、E″、tanδ 与 Prony 解析式一致', () => {
      const mat = makeMaterial({
        eInf: 2,
        branches: [
          { E: 3, tau: 1 },
          { E: 1.5, tau: 0.2 },
        ],
        wlf: null,
      });
      const f = 0.5; // Hz
      const res = svc.analyze(mat, sineHistory('sine', 0.01, f, 40, {}, 256));
      expect(res.status).toBe('success');
      expect(res.dynamicModulus).toHaveLength(1);

      // 解析值（直接按定义复核）
      const omega = 2 * Math.PI * f;
      let Ep = 2;
      let Epp = 0;
      for (const b of mat.branches) {
        const x = omega * b.tau;
        Ep += (b.E * x * x) / (1 + x * x);
        Epp += (b.E * x) / (1 + x * x);
      }
      const dm = res.dynamicModulus![0];
      expect(dm.storageModulus).toBeCloseTo(Ep, 12);
      expect(dm.lossModulus).toBeCloseTo(Epp, 12);
      expect(dm.lossTangent).toBeCloseTo(Epp / Ep, 12);

      // 端到端数值拟合（预热后取末周期）
      const fit = res.steadyStateFit!;
      expect(fit.warmupCycles).toBeGreaterThanOrEqual(20);
      expect(fit.storageModulus).toBeCloseTo(Ep, 6);
      expect(fit.lossModulus).toBeCloseTo(Epp, 6);
      expect(fit.lossTangent).toBeCloseTo(Epp / Ep, 5);
    });
  });

  describe('WLF 时温等效', () => {
    test('T>Tref 时 aT<1，同一历程应力松弛更快', () => {
      const mat = material();
      const eps0 = 0.03;
      const ref = svc.analyze(mat, {
        ...stepHoldHistory('ref', eps0, 60, 301),
        temperature: 20,
      });
      const hot = svc.analyze(mat, {
        ...stepHoldHistory('hot', eps0, 60, 301),
        temperature: 60,
      });

      expect(hot.status).toBe('success');
      expect(hot.shiftFactor!).toBeLessThan(1);
      expect(ref.shiftFactor!).toBeCloseTo(1, 12);

      // 初始应力相同（温度不改变 E0），之后高温应力更低（松弛更快）
      expect(hot.output!.stress[0]).toBeCloseTo(ref.output!.stress[0], 12);
      for (let i = 30; i < ref.output!.time.length; i += 30) {
        expect(hot.output!.stress[i]).toBeLessThan(ref.output!.stress[i]);
      }
      // 同一物理时刻高温的松弛模量更小（等效 τ 短）
      const t = 10;
      const iRef = indexNear(ref.output!.time, t);
      const iHot = indexNear(hot.output!.time, t);
      expect(hot.output!.relaxationModulus[iHot]).toBeLessThan(
        ref.output!.relaxationModulus[iRef],
      );
    });

    test('平移因子随温度单调下降', () => {
      const { TtsService } = require('../../src/tts/tts.service');
      const tts = new TtsService();
      const a30 = tts.shiftFactor(wlf, 30);
      const a40 = tts.shiftFactor(wlf, 40);
      const a60 = tts.shiftFactor(wlf, 60);
      expect(a40).toBeLessThan(a30);
      expect(a60).toBeLessThan(a40);
      expect(a30).toBeLessThan(1);
    });

    test('WLF 分母 C2+T−Tref<=0 时返回带原因的错误', () => {
      // C2=10，Tref=20，取 T=5 => 10+5-20 = -5 <= 0
      const mat = makeMaterial({
        eInf: 1,
        branches: [{ E: 1, tau: 1 }],
        wlf: { tRef: 20, c1: 10, c2: 10 },
      });
      expect(() =>
        svc.analyze(mat, { ...stepHoldHistory('badT', 0.01, 5, 26), temperature: 5 }),
      ).toThrow(/WLF 分母/);
    });
  });

  describe('输入校验（错误均附中文原因）', () => {
    test('τ_i<=0', () => {
      const mat = makeMaterial({
        eInf: 1,
        branches: [{ E: 1, tau: 0 }],
        wlf: null,
      });
      expect(() => svc.analyze(mat, stepHoldHistory('h', 0.01, 1, 11))).toThrow(
        /τ_i.*必须 > 0/,
      );
    });

    test('E_i<0', () => {
      const mat = makeMaterial({
        eInf: 1,
        branches: [{ E: -2, tau: 1 }],
        wlf: null,
      });
      expect(() => svc.analyze(mat, stepHoldHistory('h', 0.01, 1, 11))).toThrow(
        /E_i.*必须 >= 0/,
      );
    });

    test('E∞<0', () => {
      const mat = makeMaterial({ eInf: -1, branches: [], wlf: null });
      expect(() => svc.analyze(mat, stepHoldHistory('h', 0.01, 1, 11))).toThrow(
        /E∞.*必须 >= 0/,
      );
    });

    test('控制点时间不严格递增', () => {
      const mat = material();
      const h: StrainHistory = {
        name: 'bad',
        segments: [
          {
            kind: 'linear',
            points: [
              { t: 0, strain: 0 },
              { t: 2, strain: 0.01 },
              { t: 2, strain: 0.02 },
            ],
          },
        ],
        output: { tStart: 0, tEnd: 2, count: 11 },
      };
      expect(() => svc.analyze(mat, h)).toThrow(/严格递增/);
    });

    test('正弦频率<=0', () => {
      const mat = material();
      expect(() =>
        svc.analyze(
          mat,
          sineHistory('bad', 0.01, 0, 2, {
            output: { tStart: 0, tEnd: 4, count: 11 },
          }),
        ),
      ).toThrow(/频率.*必须 > 0/);
    });

    test('输出网格超出历程时间范围', () => {
      const mat = material();
      const h: StrainHistory = {
        name: 'bad',
        segments: [
          {
            kind: 'linear',
            points: [
              { t: 0, strain: 0 },
              { t: 5, strain: 0.01 },
            ],
          },
        ],
        output: { tStart: 0, tEnd: 99, count: 11 },
      };
      expect(() => svc.analyze(mat, h)).toThrow(/超出历程时间范围/);
    });

    test('所有错误都是 AnalysisError', () => {
      const mat = makeMaterial({ eInf: 1, branches: [{ E: 1, tau: -1 }], wlf: null });
      try {
        svc.analyze(mat, stepHoldHistory('h', 0.01, 1, 11));
        throw new Error('应当抛出异常');
      } catch (e) {
        expect(e).toBeInstanceOf(AnalysisError);
      }
    });
  });
});
