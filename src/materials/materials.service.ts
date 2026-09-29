import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MaterialDoc, MaterialDocument } from './material.schema';
import { CreateMaterialDto, UpdateMaterialDto } from './materials.dto';
import { Material } from '../core/domain';
import { validateMaterialParams } from '../core/validation';
import { TtsService } from '../tts/tts.service';

/** 材料档应用服务：参数校验、E0 回显、CRUD。 */
@Injectable()
export class MaterialsService {
  constructor(
    @InjectModel(MaterialDoc.name) private readonly model: Model<MaterialDocument>,
    private readonly tts: TtsService,
  ) {}

  /** E0 = E∞ + Σ E_i */
  computeE0(eInf: number, branches: Array<{ E: number }>): number {
    return eInf + branches.reduce((sum, b) => sum + b.E, 0);
  }

  private validateDto(dto: CreateMaterialDto | UpdateMaterialDto): void {
    if (dto.eInf !== undefined || dto.branches !== undefined) {
      validateMaterialParams(dto.eInf ?? 0, dto.branches ?? []);
    }
    if (dto.wlf) {
      this.tts.validate(dto.wlf);
    }
  }

  async create(dto: CreateMaterialDto): Promise<Material> {
    this.validateDto(dto);
    const existing = await this.model.findOne({ name: dto.name }).exec();
    if (existing) {
      throw new ConflictException(`材料档名称已存在：${dto.name}`);
    }
    const e0 = this.computeE0(dto.eInf, dto.branches);
    const created = await this.model.create({
      name: dto.name,
      description: dto.description,
      eInf: dto.eInf,
      branches: dto.branches,
      wlf: dto.wlf ?? null,
      e0,
    });
    return this.toDomain(created);
  }

  async list(): Promise<Material[]> {
    const docs = await this.model.find().sort({ createdAt: -1 }).exec();
    return docs.map((d) => this.toDomain(d));
  }

  async getById(id: string): Promise<Material> {
    const doc = await this.model.findById(id).exec();
    if (!doc) {
      throw new NotFoundException(`材料档不存在：${id}`);
    }
    return this.toDomain(doc);
  }

  async getByName(name: string): Promise<Material> {
    const doc = await this.model.findOne({ name }).exec();
    if (!doc) {
      throw new NotFoundException(`材料档不存在：${name}`);
    }
    return this.toDomain(doc);
  }

  async update(id: string, dto: UpdateMaterialDto): Promise<Material> {
    const doc = await this.model.findById(id).exec();
    if (!doc) {
      throw new NotFoundException(`材料档不存在：${id}`);
    }
    const eInf = dto.eInf ?? doc.eInf;
    const branches = (dto.branches ?? doc.branches).map((b) => ({ E: b.E, tau: b.tau }));
    validateMaterialParams(eInf, branches);
    if (dto.wlf) {
      this.tts.validate(dto.wlf);
    }
    if (dto.name !== undefined && dto.name !== doc.name) {
      const clash = await this.model.findOne({ name: dto.name }).exec();
      if (clash) throw new ConflictException(`材料档名称已存在：${dto.name}`);
      doc.name = dto.name;
    }
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.eInf !== undefined) doc.eInf = dto.eInf;
    if (dto.branches !== undefined) doc.branches = branches;
    if (dto.wlf !== undefined) doc.wlf = dto.wlf;
    doc.e0 = this.computeE0(eInf, branches);
    await doc.save();
    return this.toDomain(doc);
  }

  async remove(id: string): Promise<void> {
    const res = await this.model.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException(`材料档不存在：${id}`);
    }
  }

  private toDomain(doc: MaterialDocument): Material {
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description,
      eInf: doc.eInf,
      branches: doc.branches.map((b) => ({ E: b.E, tau: b.tau })),
      wlf: doc.wlf
        ? { tRef: doc.wlf.tRef, c1: doc.wlf.c1, c2: doc.wlf.c2 }
        : null,
      e0: doc.e0,
      createdAt: (doc as unknown as { createdAt: Date }).createdAt,
      updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt,
    };
  }
}
