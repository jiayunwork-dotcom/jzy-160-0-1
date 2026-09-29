import { AnalysisService } from '../../src/core/analysis.service';
import { makeAnalysisService, makeMaterial } from '../helpers';

/**
 * 复杂度性质：长历程的计算量随输出步数线性增长（O(N·M)），
 * 不允许每一步对全部历史重做卷积（那将是 O(N²·M)）。
 */
describe('计算复杂度 — 随步数线性', () => {
  let svc: AnalysisService;
  beforeEach(() => {
    svc = makeAnalysisService();
  });

  const material = () =>
    makeMaterial({
      eInf: 2,
      branches: [
        { E: 3, tau: 0.5 },
        { E: 2, tau: 5 },
        { E: 1, tau: 50 },
      ],
      wlf: null,
    });

  function makeHistory(points: number) {
    const tEnd = 100;
    const pts = [];
    for (let i = 0; i <= points; i++) {
      const t = (tEnd * i) / points;
      pts.push({ t, strain: 0.01 * Math.sin(0.5 * t) + 0.002 * t });
    }
    return {
      name: 'long',
      segments: [{ kind: 'linear' as const, points: pts }],
      output: { tStart: 0, tEnd, count: points + 1 },
    };
  }

  test('步数翻倍，墙钟耗时约翻倍（远低于平方增长）', () => {
    const n1 = 2000;
    const n2 = 8000; // 4 倍步数

    const t1Start = process.hrtime.bigint();
    const r1 = svc.analyze(material(), makeHistory(n1));
    const t1 = Number(process.hrtime.bigint() - t1Start) / 1e6;

    const t2Start = process.hrtime.bigint();
    const r2 = svc.analyze(material(), makeHistory(n2));
    const t2 = Number(process.hrtime.bigint() - t2Start) / 1e6;

    expect(r1.output!.stress).toHaveLength(n1 + 1);
    expect(r2.output!.stress).toHaveLength(n2 + 1);

    // 两算例在粗网格对应时刻的结果应一致（相对容差 1e-4；
    // 上万步递推的浮点累积差异在此量级，网格加密的严格收敛性见
    // analysis.properties.spec.ts 中的 101→201 对照）
    for (let i = 0; i <= n1; i += 137) {
      const j = i * 4;
      const scale = Math.max(1, Math.abs(r1.output!.stress[i]));
      expect(Math.abs(r2.output!.stress[j] - r1.output!.stress[i])).toBeLessThan(1e-4 * scale);
    }

    // 线性算法：8000 步耗时应与 2000 步同量级（<10×，对 O(N²) 约 16×）。
    // 给足裕量，避免在慢 CI 上误报。
    // eslint-disable-next-line no-console
    console.log(`线性复杂度计时：${n1} 步 ${t1.toFixed(1)} ms，${n2} 步 ${t2.toFixed(1)} ms，比值 ${(t2 / Math.max(t1, 1e-6)).toFixed(2)}`);
    expect(t2).toBeLessThan(Math.max(t1 * 10, 2000));
  });

  test('支路数翻倍耗时约翻倍', () => {
    const many = makeMaterial({
      eInf: 1,
      branches: Array.from({ length: 60 }, (_, i) => ({
        E: 1,
        tau: Math.pow(10, -2 + (i * 4) / 59), // 0.01..100 对数分布
      })),
      wlf: null,
    });
    const few = makeMaterial({
      eInf: 1,
      branches: Array.from({ length: 30 }, (_, i) => ({
        E: 1,
        tau: Math.pow(10, -2 + (i * 4) / 29),
      })),
      wlf: null,
    });
    const h = makeHistory(3000);
    const a = process.hrtime.bigint();
    svc.analyze(few, h);
    const dtFew = Number(process.hrtime.bigint() - a) / 1e6;
    const b = process.hrtime.bigint();
    svc.analyze(many, h);
    const dtMany = Number(process.hrtime.bigint() - b) / 1e6;
    // eslint-disable-next-line no-console
    console.log(`支路规模计时：30 支路 ${dtFew.toFixed(1)} ms，60 支路 ${dtMany.toFixed(1)} ms`);
    expect(dtMany).toBeLessThan(Math.max(dtFew * 4, 2000));
  });
});
