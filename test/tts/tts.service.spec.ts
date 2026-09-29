import { TtsService } from '../../src/tts/tts.service';

describe('TtsService — WLF 时温等效', () => {
  const tts = new TtsService();
  // 典型聚苯乙烯 WLF（Tref=Tg≈100℃）
  const wlf = { tRef: 100, c1: 13.7, c2: 50 };

  test('参考温度处 aT=1', () => {
    expect(tts.shiftFactor(wlf, 100)).toBeCloseTo(1, 12);
  });

  test('高于参考温度 aT<1，低于参考温度 aT>1', () => {
    expect(tts.shiftFactor(wlf, 120)).toBeLessThan(1);
    expect(tts.shiftFactor(wlf, 80)).toBeGreaterThan(1);
  });

  test('与 WLF 定义直接核对（T=120）', () => {
    const log10 = (-13.7 * 20) / (50 + 20);
    expect(tts.shiftFactor(wlf, 120)).toBeCloseTo(Math.pow(10, log10), 12);
  });

  test('τ(T)=aT·τref，高温松弛时间变短', () => {
    const aT = tts.shiftFactor(wlf, 120);
    expect(tts.shiftedTau(5, aT)).toBeCloseTo(5 * aT, 14);
    expect(tts.shiftedTau(5, aT)).toBeLessThan(5);
  });

  test('C2+T−Tref<=0 抛出原因错误', () => {
    expect(() => tts.shiftFactor(wlf, 40)).toThrow(/WLF 分母/);
    expect(() => tts.shiftFactor(wlf, 50)).toThrow(/WLF 分母/); // 恰为 0
  });

  test('C2<=0 拒绝', () => {
    expect(() => tts.shiftFactor({ tRef: 20, c1: 10, c2: 0 }, 25)).toThrow(/C2/);
  });
});
