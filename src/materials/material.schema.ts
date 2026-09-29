import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class BranchDoc {
  @Prop({ required: true })
  E!: number;

  @Prop({ required: true })
  tau!: number;
}

@Schema({ _id: false })
export class WlfDoc {
  @Prop({ required: true })
  tRef!: number;

  @Prop({ required: true })
  c1!: number;

  @Prop({ required: true })
  c2!: number;
}

/**
 * 具名材料档持久化结构。
 * e0 为服务端计算并回显的瞬时模量 E0 = E∞ + ΣE_i。
 */
@Schema({ collection: 'materials', timestamps: true, versionKey: false })
export class MaterialDoc {
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  eInf!: number;

  @Prop({ type: [BranchDoc], default: [] })
  branches!: BranchDoc[];

  @Prop({ type: WlfDoc, required: false, _id: false })
  wlf?: WlfDoc | null;

  @Prop({ required: true })
  e0!: number;
}

export type MaterialDocument = HydratedDocument<MaterialDoc>;
export const MaterialSchema = SchemaFactory.createForClass(MaterialDoc);
