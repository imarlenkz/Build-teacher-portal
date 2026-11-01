import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis кэші. Аналитика сияқты ауыр есептеулер мектептің «нұсқа» кілтімен сақталады:
 * деректер өзгергенде `bump(schoolId)` шақырылады да, ескі кэш автоматты түрде жарамсыз болады.
 * Redis қолжетімсіз болса, жүйе кэшсіз жұмысын жалғастырады.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly log = new Logger(CacheService.name);
  readonly redis: Redis;
  private healthy = false;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('ready', () => (this.healthy = true));
    this.redis.on('error', (e) => {
      if (this.healthy) this.log.warn(`Redis error: ${e.message}`);
      this.healthy = false;
    });
  }

  get isHealthy() {
    return this.healthy;
  }

  private async version(schoolId: number): Promise<string> {
    if (!this.healthy) return '0';
    return (await this.redis.get(`v:school:${schoolId}`)) ?? '0';
  }

  async bump(schoolId: number): Promise<void> {
    if (!this.healthy) return;
    try {
      await this.redis.incr(`v:school:${schoolId}`);
    } catch (e) {
      this.log.warn(`cache bump failed: ${(e as Error).message}`);
    }
  }

  async wrap<T>(schoolId: number, key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    if (!this.healthy) return fn();
    try {
      const k = `c:${schoolId}:${await this.version(schoolId)}:${key}`;
      const hit = await this.redis.get(k);
      if (hit) return JSON.parse(hit) as T;
      const val = await fn();
      await this.redis.set(k, JSON.stringify(val), 'EX', ttlSec);
      return val;
    } catch (e) {
      this.log.warn(`cache wrap failed: ${(e as Error).message}`);
      return fn();
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
