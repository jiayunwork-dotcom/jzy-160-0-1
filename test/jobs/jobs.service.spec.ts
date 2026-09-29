import { JobsService } from '../../src/jobs/jobs.service';
import { AnalysisService } from '../../src/core/analysis.service';
import { HistoryParser } from '../../src/history/history.parser';
import { TtsService } from '../../src/tts/tts.service';
import { DynamicModulusService } from '../../src/dynamic/dynamic-modulus.service';
import { Job } from '../../src/core/domain';
import { makeMaterial, stepHoldHistory, linearHistory } from '../helpers';

/**
 * 作业调度测试：用内存假集合替代 Mongoose 模型，
 * 验证异步执行、进度查询、单条历程失败隔离、按材料档检索。
 */

interface FakeDoc {
  _id: string;
  materialId: string;
  status: string;
  histories: Array<{ name: string; status: string; error?: string }>;
  results: unknown[];
  inputs: Record<string, unknown>[];
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  save: () => Promise<void>;
}

class FakeJobModel {
  private store: FakeDoc[] = [];
  private seq = 0;

  async create(data: Partial<FakeDoc>): Promise<FakeDoc> {
    const doc: FakeDoc = {
      _id: `job-${++this.seq}`,
      createdAt: new Date(),
      ...data,
    } as FakeDoc;
    doc.save = async () => {
      const idx = this.store.findIndex((d) => d._id === doc._id);
      if (idx >= 0) this.store[idx] = doc;
      else this.store.push(doc);
    };
    await doc.save();
    return doc;
  }

  findById(id: string) {
    return {
      exec: async () => this.store.find((d) => d._id === id) ?? null,
    };
  }

  find(filter: { materialId?: string }) {
    return {
      sort() {
        return this;
      },
      limit() {
        return this;
      },
      exec: async () =>
        filter.materialId
          ? this.store.filter((d) => d.materialId === filter.materialId)
          : [...this.store],
    };
  }

  updateOne(_filter: unknown, update: { $set: Partial<FakeDoc> }) {
    return {
      exec: async () => {
        const id = (_filter as { _id?: string })._id;
        const doc = this.store.find((d) => d._id === id);
        if (doc) Object.assign(doc, update.$set);
      },
    };
  }
}

class FakeMaterialsService {
  constructor(private readonly mat = makeMaterial({ id: 'mat-1', eInf: 2, branches: [{ E: 3, tau: 1 }] })) {}
  async getById(id: string) {
    if (id !== this.mat.id) {
      throw Object.assign(new Error('材料档不存在'), { response: 'not found', status: 404 });
    }
    return this.mat;
  }
}

function makeService(): { jobs: JobsService; model: FakeJobModel } {
  const model = new FakeJobModel();
  const analysis = new AnalysisService(new HistoryParser(), new TtsService(), new DynamicModulusService());
  const jobs = new JobsService(
    model as never,
    new FakeMaterialsService() as never,
    analysis,
  );
  return { jobs, model };
}

async function waitFor(job: Jobs, jobs: JobsService, attempts = 50): Promise<Job> {
  for (let i = 0; i < attempts; i++) {
    const j = await jobs.getJob(job.id);
    if (j.status === 'completed' || j.status === 'failed') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('作业超时未完成');
}

type Jobs = Job;

describe('JobsService — 异步调度与失败隔离', () => {
  test('提交立即返回作业号，随后异步完成', async () => {
    const { jobs } = makeService();
    const { jobId, status } = await jobs.submit({
      materialId: 'mat-1',
      histories: [stepHoldHistory('h1', 0.02, 5, 26)],
    });
    expect(jobId).toMatch(/^job-/);
    expect(status).toBe('queued');

    const job = await waitFor({ id: jobId } as Job, jobs);
    expect(job.status).toBe('completed');
    expect(job.histories[0].status).toBe('success');
    expect(job.results[0].status).toBe('success');
    expect(job.results[0].output!.stress.length).toBe(26);
  });

  test('进度随完成数更新', async () => {
    const { jobs } = makeService();
    const { jobId } = await jobs.submit({
      materialId: 'mat-1',
      histories: [
        stepHoldHistory('h1', 0.02, 2, 11),
        stepHoldHistory('h2', 0.03, 2, 11),
      ],
    });
    const final = await waitFor({ id: jobId } as Job, jobs);
    expect(final.histories).toHaveLength(2);
    const progress = await jobs.getProgress(jobId);
    expect(progress.completed).toBe(2);
    expect(progress.succeeded).toBe(2);
    expect(progress.failed).toBe(0);
    expect(progress.percent).toBe(100);
  });

  test('同一作业内某条历程失败不影响其余，失败附原因', async () => {
    const { jobs } = makeService();
    const good = stepHoldHistory('good', 0.02, 2, 11);
    const bad: Record<string, unknown> = {
      name: 'bad',
      // 控制点时间不严格递增
      segments: [
        {
          kind: 'linear',
          points: [
            { t: 0, strain: 0 },
            { t: 1, strain: 0.01 },
            { t: 1, strain: 0.02 },
          ],
        },
      ],
      output: { tStart: 0, tEnd: 1, count: 11 },
    };
    const { jobId } = await jobs.submit({
      materialId: 'mat-1',
      histories: [good, bad as never],
    });
    const job = await waitFor({ id: jobId } as Job, jobs);

    // 有成功有失败 → 作业整体 completed
    expect(job.status).toBe('completed');
    expect(job.histories[0].status).toBe('success');
    expect(job.histories[1].status).toBe('failed');
    expect(job.histories[1].error).toMatch(/严格递增/);
    expect(job.results[0].status).toBe('success');
    expect(job.results[1].status).toBe('failed');
    expect(job.results[1].error).toMatch(/严格递增/);
  });

  test('全部历程失败时作业标记 failed', async () => {
    const { jobs } = makeService();
    const { jobId } = await jobs.submit({
      materialId: 'mat-1',
      histories: [
        linearHistory('bad', [{ t: 0, strain: 0 }, { t: 1, strain: 0.01 }], 5, 11),
      ],
    });
    const job = await waitFor({ id: jobId } as Job, jobs);
    expect(job.status).toBe('failed');
    expect(job.results[0].status).toBe('failed');
  });

  test('空作业被拒绝', async () => {
    const { jobs } = makeService();
    await expect(
      jobs.submit({ materialId: 'mat-1', histories: [] }),
    ).rejects.toThrow(/至少包含一条历程/);
  });

  test('按材料档检索历史作业', async () => {
    const { jobs } = makeService();
    await jobs.submit({
      materialId: 'mat-1',
      histories: [stepHoldHistory('h', 0.02, 1, 6)],
    });
    await new Promise((r) => setTimeout(r, 50));
    const list = await jobs.listByMaterial('mat-1');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((j) => j.materialId === 'mat-1')).toBe(true);
  });

  test('查询不存在的作业抛 404', async () => {
    const { jobs } = makeService();
    await expect(jobs.getJob('nope')).rejects.toThrow(/作业不存在/);
  });
});
