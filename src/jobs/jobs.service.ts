import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JobDoc, JobDocument } from './job.schema';
import { SubmitJobBodyDto } from './jobs.dto';
import { MaterialsService } from '../materials/materials.service';
import { AnalysisService } from '../core/analysis.service';
import { AnalysisError } from '../core/validation';
import { HistoryResult, Job } from '../core/domain';

/**
 * 作业调度服务（进程内异步执行）。
 *
 * - submit：落库为 queued 后立即返回作业号；
 * - setImmediate 触发后台执行，逐条历程独立计算：
 *   某条失败只把该条标 failed 并附原因，不影响其余历程；
 * - 进度查询直接读 histories[].status。
 *
 * 设计上内核调用集中在 AnalysisService，本服务只做调度与持久化。
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** 正在执行的作业（防止进程内重复触发；重启后由 queued 状态可人工/启动钩子恢复） */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectModel(JobDoc.name) private readonly jobModel: Model<JobDocument>,
    private readonly materials: MaterialsService,
    private readonly analysis: AnalysisService,
  ) {}

  async submit(dto: SubmitJobBodyDto): Promise<{ jobId: string; status: string }> {
    if (!dto.histories || dto.histories.length === 0) {
      throw new AnalysisError('作业至少包含一条历程');
    }
    // 提前解析材料档引用（不存在直接 404），具体历程错误在执行时逐条捕获
    await this.materials.getById(dto.materialId);

    const created = await this.jobModel.create({
      materialId: dto.materialId,
      status: 'queued',
      histories: dto.histories.map((h) => ({ name: h.name, status: 'pending' as const })),
      results: dto.histories.map((h) => ({ name: h.name, status: 'failed' as const })),
      inputs: dto.histories.map((h) => h as unknown as Record<string, unknown>),
    });

    const jobId = created._id.toString();
    // 异步执行，不阻塞响应
    setImmediate(() => {
      void this.runJob(jobId);
    });

    return { jobId, status: 'queued' };
  }

  async getJob(jobId: string): Promise<Job> {
    const doc = await this.jobModel.findById(jobId).exec();
    if (!doc) {
      throw new NotFoundException(`作业不存在：${jobId}`);
    }
    return this.toDomain(doc);
  }

  /** 按材料档检索历史作业（最近优先） */
  async listByMaterial(materialId: string, limit = 50): Promise<Job[]> {
    const docs = await this.jobModel
      .find({ materialId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return docs.map((d) => this.toDomain(d));
  }

  /**
   * 作业进度摘要。
   */
  async getProgress(jobId: string) {
    const job = await this.getJob(jobId);
    const total = job.histories.length;
    const succeeded = job.histories.filter((h) => h.status === 'success').length;
    const failed = job.histories.filter((h) => h.status === 'failed').length;
    const completed = succeeded + failed;
    return {
      jobId: job.id,
      status: job.status,
      total,
      completed,
      succeeded,
      failed,
      pending: total - completed,
      percent: total === 0 ? 0 : (completed / total) * 100,
    };
  }

  /**
   * 后台执行一个作业。逐条历程独立 try/catch。
   */
  private async runJob(jobId: string): Promise<void> {
    if (this.inFlight.has(jobId)) return;
    this.inFlight.add(jobId);
    try {
      const doc = await this.jobModel.findById(jobId).exec();
      if (!doc || doc.status !== 'queued') return;

      doc.status = 'running';
      doc.startedAt = new Date();
      await doc.save();

      const material = await this.materials.getById(doc.materialId);

      for (let i = 0; i < doc.inputs.length; i++) {
        const input = doc.inputs[i];
        const name = (input.name as string) ?? `history-${i + 1}`;
        let result: HistoryResult;
        try {
          result = this.analysis.analyze(material, input);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          this.logger.warn(`作业 ${jobId} 历程[${name}] 失败：${reason}`);
          result = { name, status: 'failed', error: reason };
        }

        // 原子更新单条结果与状态
        doc.histories[i].status = result.status === 'success' ? 'success' : 'failed';
        if (result.error) doc.histories[i].error = result.error;
        doc.results[i] = this.toResultDoc(result);
        await doc.save();
      }

      const anySuccess = doc.histories.some((h) => h.status === 'success');
      doc.status = anySuccess ? 'completed' : 'failed';
      doc.finishedAt = new Date();
      await doc.save();
    } catch (e) {
      this.logger.error(`作业 ${jobId} 执行异常：${e instanceof Error ? e.stack : String(e)}`);
      await this.jobModel
        .updateOne({ _id: jobId }, { $set: { status: 'failed', finishedAt: new Date() } })
        .exec();
    } finally {
      this.inFlight.delete(jobId);
    }
  }

  private toResultDoc(r: HistoryResult) {
    if (r.status === 'failed') {
      return { name: r.name, status: 'failed' as const, error: r.error };
    }
    return {
      name: r.name,
      status: 'success' as const,
      shiftFactor: r.shiftFactor,
      temperature: r.temperature,
      time: r.output!.time,
      strain: r.output!.strain,
      stress: r.output!.stress,
      relaxationModulus: r.output!.relaxationModulus,
      dynamicModulus: r.dynamicModulus,
      steadyStateFit: r.steadyStateFit,
    };
  }

  private toDomain(doc: JobDocument): Job {
    return {
      id: doc._id.toString(),
      materialId: doc.materialId,
      status: doc.status,
      histories: doc.histories.map((h) => ({
        name: h.name,
        status: h.status,
        error: h.error,
      })),
      results: doc.results.map((r) => {
        if (r.status === 'failed' || !r.time) {
          return { name: r.name, status: 'failed' as const, error: r.error ?? '未知错误' };
        }
        return {
          name: r.name,
          status: 'success' as const,
          shiftFactor: r.shiftFactor,
          temperature: r.temperature,
          output: {
            time: r.time,
            strain: r.strain!,
            stress: r.stress!,
            relaxationModulus: r.relaxationModulus!,
          },
          dynamicModulus: r.dynamicModulus?.map((d) => ({ ...d })),
          steadyStateFit: r.steadyStateFit
            ? {
                warmupCycles: r.steadyStateFit.warmupCycles,
                samplesPerCycle: r.steadyStateFit.samplesPerCycle,
                storageModulus: r.steadyStateFit.storageModulus,
                lossModulus: r.steadyStateFit.lossModulus,
                lossTangent: r.steadyStateFit.lossTangent,
              }
            : undefined,
        };
      }),
      createdAt: (doc as unknown as { createdAt: Date }).createdAt,
      startedAt: doc.startedAt,
      finishedAt: doc.finishedAt,
    };
  }
}
