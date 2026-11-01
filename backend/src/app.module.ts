import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { validateEnv } from './common/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { CacheModule } from './common/cache/cache.module';
import { CacheService } from './common/cache/cache.service';
import { RedisThrottlerStorage } from './common/cache/redis-throttler.storage';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CoreModule } from './modules/core/core.module';
import { ExportModule } from './modules/exports/export.service';
import { InsightsModule } from './modules/insights/insights';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { StudentsModule } from './modules/students/students.module';
import { ClassesModule } from './modules/classes/classes.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { MovementsModule } from './modules/movements/movements.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AdminModule } from './modules/admin/admin.module';
import { BackupsModule } from './modules/backups/backups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) || randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'req.body.password'],
        autoLogging: { ignore: (req) => req.url === '/health' },
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CacheModule,
    ThrottlerModule.forRootAsync({
      inject: [CacheService],
      useFactory: (cache: CacheService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 300) }],
        storage: new RedisThrottlerStorage(cache),
      }),
    }),
    CoreModule,
    ExportModule,
    InsightsModule,
    AuditModule,
    AuthModule,
    HealthModule,
    ReferenceModule,
    StudentsModule,
    ClassesModule,
    AttendanceModule,
    MovementsModule,
    AssessmentsModule,
    AnalyticsModule,
    ReportsModule,
    NotificationsModule,
    SettingsModule,
    AdminModule,
    BackupsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
