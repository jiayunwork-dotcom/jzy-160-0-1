import { makeAnalysisService, makeMaterial, indexNear } from '../helpers';
import { StrainHistory } from '../../src/core/domain';

/**
 * 多段混合历程：阶跃保持 → 斜坡 → 正弦 → 卸载保持。
 * 重点验证事件链跨「线性/正弦」段的推进、段衔接连续性。
 */
describe('混合段历程（线性 + 正弦拼接）', () => {
  const svc = makeAnalysisService();
  const mat = makeMaterial({
    eInf: 2,
    branches: [
      { E: 3, tau: 1 },
      { E: 1, tau: 8 },
    ],
    wlf: null,
  });

  const history: StrainHistory = {
    name: 'mixed',
    segments: [
      // t=0 瞬时阶跃到 0.02（零长锚点）
      { kind: 'linear', points: [{ t: 0, strain: 0.02 }] },
      // 保持到 t=2
      { kind: 'linear', points: [
        { t: 0, strain: 0.02 },
        { t: 2, strain: 0.02 },
      ] },
      // 斜坡到 t=4, 应变到 0.03
      { kind: 'linear', points: [
        { t: 0, strain: 0.02 },
        { t: 2, strain: 0.03 },
      ] },
      // 正弦 2Hz、3 周期，偏置 0.03（自 0.03 起振，整周期结束回到 0.03）
      { kind: 'sine', amplitude: 0.005, frequency: 2, cycles: 3, offset: 0.03 },
      // 卸载斜坡到 0，再保持
      { kind: 'linear', points: [
        { t: 0, strain: 0.03 },
        { t: 2, strain: 0 },
      ] },
      { kind: 'linear', points: [
        { t: 0, strain: 0 },
        { t: 3, strain: 0 },
      ] },
    ],
    output: { tStart: 0, tEnd: 10.5, count: 211 },
  };

  test('全程计算成功，时间/应变网格一致', () => {
    const res = svc.analyze(mat, history);
    expect(res.status).toBe('success');
    const { time, strain, stress, relaxationModulus } = res.output!;
    expect(time).toHaveLength(211);
    expect(strain).toHaveLength(211);
    expect(stress).toHaveLength(211);
    expect(relaxationModulus).toHaveLength(211);

    // 初值：t=0+ 瞬时阶跃，应力 = E0·ε0
    expect(strain[0]).toBeCloseTo(0.02, 12);
    expect(stress[0]).toBeCloseTo((2 + 3 + 1) * 0.02, 10);

    // 各段边界处应变连续
    expect(strain[indexNear(time, 2)]).toBeCloseTo(0.02, 10);
    expect(strain[indexNear(time, 4)]).toBeCloseTo(0.03, 10);
    expect(strain[indexNear(time, 5.5)]).toBeCloseTo(0.03, 9); // 正弦 1.5s 后回偏置
    expect(strain[indexNear(time, 10.5)]).toBeCloseTo(0, 10); // 卸载完成
  });

  test('应力连续无跳变（除 t=0 阶跃），且有限', () => {
    const res = svc.analyze(mat, history);
    const { time, stress } = res.output!;
    // 2Hz 正弦段在 0.05s 网格上物理应力增量约 E0·A·ω·dt ≈ 6·0.005·12.57·0.05 ≈ 0.019，
    // 故阈值取 0.03（排除真正的非物理尖峰，而非限制物理变化率）
    for (let i = 1; i < stress.length; i++) {
      expect(Number.isFinite(stress[i])).toBe(true);
      const jump = Math.abs(stress[i] - stress[i - 1]);
      expect(jump).toBeLessThan(0.03);
      void time;
    }
  });

  test('卸载并长时间保持后应力回到 0（平衡态零应变）', () => {
    const h2: StrainHistory = {
      ...history,
      segments: [
        ...history.segments,
        { kind: 'linear', points: [
          { t: 0, strain: 0 },
          { t: 160, strain: 0 },
        ] },
      ],
      output: { tStart: 0, tEnd: 170.5, count: 342 },
    };
    const res = svc.analyze(mat, h2);
    const tail = res.output!.stress[res.output!.stress.length - 1];
    expect(tail).toBeCloseTo(0, 5);
  });

  test('正弦段给出解析动态模量', () => {
    const res = svc.analyze(mat, history);
    expect(res.dynamicModulus).toBeDefined();
    expect(res.dynamicModulus).toHaveLength(1);
    const dm = res.dynamicModulus![0];
    expect(dm.segmentIndex).toBe(3);
    const omega = 2 * Math.PI * 2;
    let Ep = 2;
    let Epp = 0;
    for (const b of mat.branches) {
      const x = omega * b.tau;
      Ep += (b.E * x * x) / (1 + x * x);
      Epp += (b.E * x) / (1 + x * x);
    }
    expect(dm.storageModulus).toBeCloseTo(Ep, 12);
    expect(dm.lossModulus).toBeCloseTo(Epp, 12);
  });

  test('正弦后衔接应变不匹配的线性段报错', () => {
    const bad: StrainHistory = {
      name: 'bad',
      segments: [
        { kind: 'sine', amplitude: 0.01, frequency: 1, cycles: 1, offset: 0 },
        { kind: 'linear', points: [
          { t: 0, strain: 0.05 },
          { t: 1, strain: 0.05 },
        ] },
      ],
    };
    expect(() => svc.analyze(mat, bad)).toThrow(/不连续/);
  });
});
