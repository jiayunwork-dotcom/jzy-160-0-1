import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** 单条历程的执行状态 */
@Schema({ _id: false })
export class JobHistoryStateDoc {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['pending', 'success', 'failed'] })
  status!: 'pending' | 'success' | 'failed';

  @Prop()
  error?: string;
}

@Schema({ _id: false })
export class SineDynamicResultDoc {
  @Prop({ required: true })
  segmentIndex!: number;

  @Prop({ required: true })
  frequency!: number;

  @Prop({ required: true })
  omega!: number;

  @Prop({ required: true })
  storageModulus!: number;

  @Prop({ required: true })
  lossModulus!: number;

  @Prop({ required: true })
  lossTangent!: number;
}

@Schema({ _id: false })
export class SteadyStateFitDoc {
  @Prop({ required: true })
  warmupCycles!: number;

  @Prop({ required: true })
  samplesPerCycle!: number;

  @Prop({ required: true })
  storageModulus!: number;

  @Prop({ required: true })
  lossModulus!: number;

  @Prop({ required: true })
  lossTangent!: number;
}

@Schema({ _id: true })
export class HistoryResultDoc {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['success', 'failed'] })
  status!: 'success' | 'failed';

  @Prop()
  error?: string;

  @Prop()
  shiftFactor?: number;

  @Prop()
  temperature?: number;

  @Prop({ type: [Number], required: false })
  time?: number[];

  @Prop({ type: [Number], required: false })
  strain?: number[];

  @Prop({ type: [Number], required: false })
  stress?: number[];

  @Prop({ type: [Number], required: false })
  relaxationModulus?: number[];

  @Prop({ type: [SineDynamicResultDoc], required: false, _id: false })
  dynamicModulus?: SineDynamicResultDoc[];

  @Prop({ type: SteadyStateFitDoc, required: false, _id: false })
  steadyStateFit?: SteadyStateFitDoc;
}

/**
 * 作业持久化结构。一个作业引用一个材料档，含一批历程。
 * results 与 histories 按下标对应；进度查询走 histories[].status。
 */
@Schema({ collection: 'jobs', timestamps: true, versionKey: false })
export class JobDoc {
  @Prop({ required: true, index: true })
  materialId!: string;

  @Prop({ required: true, enum: ['queued', 'running', 'completed', 'failed'] })
  status!: 'queued' | 'running' | 'completed' | 'failed';

  @Prop({ type: [JobHistoryStateDoc], required: true, _id: false })
  histories!: JobHistoryStateDoc[];

  @Prop({ type: [HistoryResultDoc], required: true })
  results!: HistoryResultDoc[];

  @Prop()
  startedAt?: Date;

  @Prop()
  finishedAt?: Date;

  /** 原始历程定义，便于审计/复算 */
  @Prop({ type: [Object], required: true })
  inputs!: Record<string, unknown>[];
}

export type JobDocument = HydratedDocument<JobDoc>;
export const JobSchema = SchemaFactory.createForClass(JobDoc);

// 按材料档检索历史作业
JobSchema.index({ materialId: 1, createdAt: -1 });
