import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MaterialsModule } from './materials/materials.module';
import { JobsModule } from './jobs/jobs.module';
import { TtsModule } from './tts/tts.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGO_URI ?? 'mongodb://mongo:27017/prony',
        // mongo 容器短暂不可用时持续重试，避免应用启动失败
        retryAttempts: 30,
        retryDelay: 1000,
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    TtsModule,
    MaterialsModule,
    JobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
