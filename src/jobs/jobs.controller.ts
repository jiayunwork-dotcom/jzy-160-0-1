import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { SubmitJobBodyDto } from './jobs.dto';

/** 作业 REST 接口：提交（异步）、查询进度/结果、按材料档检索历史 */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** 提交作业，立即返回作业号 */
  @Post()
  submit(@Body() dto: SubmitJobBodyDto) {
    return this.jobs.submit(dto);
  }

  /** 查询作业完整结果 */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.jobs.getJob(id);
  }

  /** 查询作业进度 */
  @Get(':id/progress')
  progress(@Param('id') id: string) {
    return this.jobs.getProgress(id);
  }

  /** 按材料档检索历史作业 */
  @Get()
  listByMaterial(@Query('materialId') materialId: string) {
    return this.jobs.listByMaterial(materialId);
  }
}
