import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * DTO 只做类型/结构校验；
 * τ_i>0、E_i>=0、E∞>=0、C2>0 等领域规则由 MaterialsService 校验，
 * 错误以 AnalysisError 经全局过滤器返回中文原因。
 */
export class BranchDto {
  @IsNumber()
  E!: number;

  /** 松弛时间（秒），必须 > 0（领域层校验） */
  @IsNumber()
  tau!: number;
}

export class WlfDto {
  @IsNumber()
  tRef!: number;

  @IsNumber()
  c1!: number;

  @IsNumber()
  c2!: number;
}

export class CreateMaterialDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 平衡（长期）模量 E∞ */
  @IsNumber()
  eInf!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchDto)
  branches!: BranchDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => WlfDto)
  wlf?: WlfDto;
}

export class UpdateMaterialDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  eInf?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchDto)
  branches?: BranchDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => WlfDto)
  wlf?: WlfDto;
}
