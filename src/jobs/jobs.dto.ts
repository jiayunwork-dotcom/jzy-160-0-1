import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** 分段线性控制点 */
export class StrainPointDto {
  @IsNumber()
  t!: number;

  @IsNumber()
  strain!: number;
}

export class LinearSegmentBodyDto {
  @IsEnum(['linear'])
  kind!: 'linear';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrainPointDto)
  points!: StrainPointDto[];
}

export class SineSegmentBodyDto {
  @IsEnum(['sine'])
  kind!: 'sine';

  @IsNumber()
  amplitude!: number;

  /** 频率 Hz，> 0（领域层校验） */
  @IsNumber()
  frequency!: number;

  /** 周期数，> 0（领域层校验） */
  @IsNumber()
  cycles!: number;

  @IsOptional()
  @IsNumber()
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(4)
  pointsPerCycle?: number;
}

export class OutputGridBodyDto {
  @IsNumber()
  tStart!: number;

  @IsNumber()
  tEnd!: number;

  @IsInt()
  @Min(2)
  count!: number;
}

export class HistoryBodyDto {
  @IsString()
  name!: string;

  /**
   * 判别联合（kind: linear | sine）：用 class-transformer 的 discriminator
   * 按 kind 字段实例化对应 DTO，再各自做嵌套校验。
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: LinearSegmentBodyDto, name: 'linear' },
        { value: SineSegmentBodyDto, name: 'sine' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  segments!: Array<LinearSegmentBodyDto | SineSegmentBodyDto>;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => OutputGridBodyDto)
  output?: OutputGridBodyDto;
}

export class SubmitJobBodyDto {
  @IsString()
  materialId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryBodyDto)
  histories!: HistoryBodyDto[];
}
