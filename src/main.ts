import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AnalysisExceptionFilter } from './core/analysis-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AnalysisExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Prony 粘弹核算服务已启动，端口 ${port}`);
}
void bootstrap();
