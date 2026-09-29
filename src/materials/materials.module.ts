import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MaterialDoc, MaterialSchema } from './material.schema';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';
import { TtsModule } from '../tts/tts.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MaterialDoc.name, schema: MaterialSchema }]),
    TtsModule,
  ],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService, MongooseModule],
})
export class MaterialsModule {}
