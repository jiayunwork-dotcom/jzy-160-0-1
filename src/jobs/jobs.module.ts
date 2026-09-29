import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobDoc, JobSchema } from './job.schema';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { MaterialsModule } from '../materials/materials.module';
import { HistoryParser } from '../history/history.parser';
import { DynamicModulusService } from '../dynamic/dynamic-modulus.service';
import { AnalysisService } from '../core/analysis.service';
import { TtsModule } from '../tts/tts.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: JobDoc.name, schema: JobSchema }]),
    MaterialsModule,
    TtsModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, HistoryParser, DynamicModulusService, AnalysisService],
  exports: [JobsService, AnalysisService, HistoryParser, DynamicModulusService],
})
export class JobsModule {}
