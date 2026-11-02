import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable('x-powered-by');
  // Excel импорты base64 түрінде келеді (nginx шегі 5 МБ).
  app.useBodyParser('json', { limit: '6mb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  const origin = process.env.CORS_ORIGIN;
  if (origin) app.enableCors({ origin: origin.split(','), credentials: true });
  app.enableShutdownHooks();

  if (process.env.SWAGGER_ENABLED !== 'false') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('USTAZ API')
        .setDescription('Мектеп мұғаліміне арналған портал API. Аутентификация: httpOnly cookie + X-CSRF-Token немесе Bearer.')
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('ustaz_at')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
