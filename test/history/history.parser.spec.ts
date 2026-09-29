import { HistoryParser } from '../../src/history/history.parser';
import { StrainHistory } from '../../src/core/domain';

describe('HistoryParser', () => {
  const parser = new HistoryParser();

  test('阶跃锚点 + 保持段解析正确', () => {
    const h: StrainHistory = {
      name: 'step',
      segments: [
        { kind: 'linear', points: [{ t: 0, strain: 0.05 }] },
        {
          kind: 'linear',
          points: [
            { t: 0, strain: 0.05 },
            { t: 10, strain: 0.05 },
          ],
        },
      ],
    };
    const parsed = parser.parse(h);
    expect(parsed.initialStrain).toBeCloseTo(0.05, 14);
    expect(parsed.totalTime).toBeCloseTo(10, 12);
    expect(parsed.outputGrid).toHaveLength(201);
    expect(parsed.outputGrid[0]).toBe(0);
    expect(parsed.outputGrid[200]).toBe(10);
  });

  test('多段正弦拼接：时间累加、频率/周期换算', () => {
    const h: StrainHistory = {
      name: 'sines',
      segments: [
        { kind: 'sine', amplitude: 0.01, frequency: 1, cycles: 2, offset: 0 },
        { kind: 'sine', amplitude: 0.02, frequency: 2, cycles: 4 },
      ],
    };
    const parsed = parser.parse(h);
    expect(parsed.segments).toHaveLength(2);
    const [s1, s2] = parsed.segments;
    expect(s1.kind).toBe('sine');
    expect(s2.kind).toBe('sine');
    if (s1.kind === 'sine' && s2.kind === 'sine') {
      expect(s1.duration).toBeCloseTo(2, 12);
      expect(s2.tStart).toBeCloseTo(2, 12);
      expect(s2.duration).toBeCloseTo(2, 12);
      expect(s2.offset).toBeCloseTo(0, 12); // 上段终点=offset=0
      expect(parsed.totalTime).toBeCloseTo(4, 12);
    }
  });

  test('段衔接处应变不连续报错', () => {
    const h: StrainHistory = {
      name: 'gap',
      segments: [
        {
          kind: 'linear',
          points: [
            { t: 0, strain: 0 },
            { t: 1, strain: 0.02 },
          ],
        },
        {
          kind: 'linear',
          points: [
            { t: 0, strain: 0.05 },
            { t: 1, strain: 0.05 },
          ],
        },
      ],
    };
    expect(() => parser.parse(h)).toThrow(/不连续/);
  });

  test('控制点回退时间报错', () => {
    expect(() =>
      parser.parse({
        name: 'x',
        segments: [
          { kind: 'linear', points: [{ t: 0, strain: 0 }, { t: -1, strain: 0.01 }] },
        ],
      }),
    ).toThrow(/严格递增/);
  });

  test('正弦频率/周期非正报错', () => {
    expect(() =>
      parser.parse({
        name: 'x',
        segments: [{ kind: 'sine', amplitude: 0.01, frequency: 0, cycles: 2 }],
      }),
    ).toThrow(/频率.*必须 > 0/);
    expect(() =>
      parser.parse({
        name: 'x',
        segments: [{ kind: 'sine', amplitude: 0.01, frequency: 1, cycles: -2 }],
      }),
    ).toThrow(/周期数.*必须 > 0/);
  });

  test('输出网格越界报错', () => {
    const h: StrainHistory = {
      name: 'x',
      segments: [
        { kind: 'linear', points: [{ t: 0, strain: 0 }, { t: 2, strain: 0.01 }] },
      ],
      output: { tStart: 0, tEnd: 3, count: 11 },
    };
    expect(() => parser.parse(h)).toThrow(/超出历程时间范围/);
  });

  test('空段列表报错', () => {
    expect(() => parser.parse({ name: 'x', segments: [] })).toThrow(/至少需要一个段/);
  });
});
