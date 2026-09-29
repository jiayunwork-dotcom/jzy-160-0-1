import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AnalysisError } from './validation';

/**
 * 把内核/领域层的 AnalysisError 统一映射为 HTTP 400，
 * 响应体形如 { statusCode:400, error:'AnalysisError', message:'...原因...' }，
 * 便于分析员直接看到是哪条输入规则不满足。
 */
@Catch(AnalysisError)
export class AnalysisExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AnalysisExceptionFilter.name);

  catch(exception: AnalysisError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    this.logger.debug(exception.message);
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'AnalysisError',
      message: exception.message,
    });
  }
}
