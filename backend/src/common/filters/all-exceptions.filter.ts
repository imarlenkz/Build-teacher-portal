import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Бірыңғай қате форматы: { statusCode, error, message, details?, path, timestamp, requestId }.
 * Ішкі қателердің мәтіні клиентке жіберілмейді (ақпарат ағуының алдын алу).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'Ішкі қате орын алды';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const m = (body as { message?: unknown }).message;
        if (Array.isArray(m)) {
          message = 'Енгізілген деректер қате';
          details = m;
        } else if (typeof m === 'string') message = m;
        if ((body as { details?: unknown }).details) details = (body as { details?: unknown }).details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Мұндай жазба бұрыннан бар';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Жазба табылмады';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        message = 'Байланысты жазбалар бар, әрекет орындалмайды';
      } else {
        this.log.error(exception);
      }
    } else {
      this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }

    if (status >= 500) this.log.error(`${req.method} ${req.url} → ${status}`);
    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      ...(details ? { details } : {}),
      path: req.url,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }
}
