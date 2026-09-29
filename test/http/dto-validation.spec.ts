import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitJobBodyDto } from '../../src/jobs/jobs.dto';
import { CreateMaterialDto } from '../../src/materials/materials.dto';

describe('DTO 管道校验（HTTP 层）', () => {
  test('linear/sine 判别联合段正确转换与保留', async () => {
    const payload = {
      materialId: 'abc',
      histories: [
        {
          name: 'mixed',
          segments: [
            { kind: 'linear', points: [{ t: 0, strain: 0 }, { t: 1, strain: 0.02 }] },
            { kind: 'sine', amplitude: 0.01, frequency: 2, cycles: 3, pointsPerCycle: 64 },
          ],
          temperature: 60,
          output: { tStart: 0, tEnd: 2.5, count: 251 },
        },
      ],
    };
    const dto = plainToInstance(SubmitJobBodyDto, payload);
    const errors = await validate(dto as unknown as object, { whitelist: true });
    expect(errors).toHaveLength(0);
    const segs = dto.histories[0].segments as unknown[];
    expect(segs).toHaveLength(2);
    expect((segs[0] as { kind: string }).kind).toBe('linear');
    expect((segs[1] as { kind: string }).kind).toBe('sine');
    // 数值被转换成 number
    expect((segs[1] as { frequency: number }).frequency).toBe(2);
  });

  test('结构错误（缺字段、错类型）在校验层拦截', async () => {
    const bad = plainToInstance(SubmitJobBodyDto, {
      materialId: 'abc',
      histories: [
        {
          name: 'h',
          segments: [{ kind: 'sine', frequency: 'oops', cycles: 1 }],
        },
      ],
    });
    const errors = await validate(bad as unknown as object);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('材料 DTO 只做结构校验，数值规则留给领域层', async () => {
    const dto = plainToInstance(CreateMaterialDto, {
      name: 'x',
      eInf: -1,
      branches: [{ E: -1, tau: 0 }],
      wlf: { tRef: 20, c1: 17, c2: 0 },
    });
    const errors = await validate(dto as unknown as object);
    // 类型都是 number → 结构校验通过；符号规则由 MaterialsService 把关
    expect(errors).toHaveLength(0);
  });
});
