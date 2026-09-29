import { MaterialsService } from '../../src/materials/materials.service';
import { TtsService } from '../../src/tts/tts.service';

/** 材料档服务测试：内存假集合，验证 E0 回显与参数校验 */

interface FakeMaterialDoc {
  _id: string;
  name: string;
  description?: string;
  eInf: number;
  branches: Array<{ E: number; tau: number }>;
  wlf?: { tRef: number; c1: number; c2: number } | null;
  e0: number;
  save: () => Promise<void>;
}

class FakeMaterialModel {
  private store: FakeMaterialDoc[] = [];
  private seq = 0;

  async create(data: Partial<FakeMaterialDoc>): Promise<FakeMaterialDoc> {
    const doc = {
      _id: `mat-${++this.seq}`,
      ...data,
    } as FakeMaterialDoc;
    doc.save = async () => {
      this.store.push(doc);
    };
    await doc.save();
    return doc;
  }

  findOne(filter: { name?: string }) {
    return {
      exec: async () => this.store.find((d) => d.name === filter.name) ?? null,
    };
  }

  findById(id: string) {
    return {
      exec: async () => this.store.find((d) => d._id === id) ?? null,
    };
  }

  find() {
    return {
      sort: () => ({
        exec: async () => [...this.store],
      }),
    };
  }

  findByIdAndDelete(id: string) {
    return {
      exec: async () => {
        const idx = this.store.findIndex((d) => d._id === id);
        if (idx < 0) return null;
        return this.store.splice(idx, 1)[0];
      },
    };
  }
}

function makeService() {
  const model = new FakeMaterialModel();
  const svc = new MaterialsService(model as never, new TtsService());
  return { svc, model };
}

describe('MaterialsService', () => {
  test('创建时计算并回显 E0 = E∞+ΣE_i', async () => {
    const { svc } = makeService();
    const mat = await svc.create({
      name: 'NBR-70',
      eInf: 3.2,
      branches: [
        { E: 1.1, tau: 0.1 },
        { E: 2.3, tau: 10 },
      ],
    });
    expect(mat.e0).toBeCloseTo(3.2 + 1.1 + 2.3, 14);
    expect(mat.e0).toBeCloseTo(6.6, 14);
  });

  test('无支路时 E0=E∞（线弹性档）', async () => {
    const { svc } = makeService();
    const mat = await svc.create({ name: 'elastic', eInf: 5, branches: [] });
    expect(mat.e0).toBeCloseTo(5, 14);
  });

  test('τ_i<=0 报错', async () => {
    const { svc } = makeService();
    await expect(
      svc.create({ name: 'bad-tau', eInf: 1, branches: [{ E: 1, tau: 0 }] }),
    ).rejects.toThrow(/τ_i.*必须 > 0/);
  });

  test('E_i<0 报错', async () => {
    const { svc } = makeService();
    await expect(
      svc.create({ name: 'bad-e', eInf: 1, branches: [{ E: -1, tau: 1 }] }),
    ).rejects.toThrow(/E_i.*必须 >= 0/);
  });

  test('E∞<0 报错', async () => {
    const { svc } = makeService();
    await expect(svc.create({ name: 'bad-einf', eInf: -1, branches: [] })).rejects.toThrow(
      /E∞.*必须 >= 0/,
    );
  });

  test('WLF C2<=0 报错', async () => {
    const { svc } = makeService();
    await expect(
      svc.create({
        name: 'bad-wlf',
        eInf: 1,
        branches: [],
        wlf: { tRef: 20, c1: 17, c2: 0 },
      }),
    ).rejects.toThrow(/C2.*必须 > 0/);
  });

  test('重名创建被拒绝', async () => {
    const { svc } = makeService();
    await svc.create({ name: 'dup', eInf: 1, branches: [] });
    await expect(svc.create({ name: 'dup', eInf: 2, branches: [] })).rejects.toThrow(
      /名称已存在/,
    );
  });

  test('更新后 E0 重新计算', async () => {
    const { svc } = makeService();
    const mat = await svc.create({ name: 'm', eInf: 1, branches: [{ E: 1, tau: 1 }] });
    const updated = await svc.update(mat.id, { eInf: 4 });
    expect(updated.e0).toBeCloseTo(5, 14);
  });
});
