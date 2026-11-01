import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { CacheService } from './cache.service';

/**
 * Rate limit есептегіштері Redis-те сақталады, сондықтан бірнеше backend данасы
 * бір лимитті бөліседі. Redis уақытша қолжетімсіз болса, жадтағы есептегішке ауысады.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private mem = new Map<string, { hits: number; exp: number; blockedUntil: number }>();

  constructor(private readonly cache: CacheService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string): Promise<ThrottlerStorageRecord> {
    const k = `rl:${name}:${key}`;
    if (this.cache.isHealthy) {
      try {
        const r = this.cache.redis;
        const blockedTtl = await r.pttl(`${k}:b`);
        if (blockedTtl > 0) {
          return { totalHits: limit + 1, timeToExpire: Math.ceil(blockedTtl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedTtl / 1000) };
        }
        const [[, hits], [, pttl]] = (await r.multi().incr(k).pttl(k).exec()) as [[null, number], [null, number]];
        if (pttl < 0) await r.pexpire(k, ttl);
        const exp = pttl > 0 ? pttl : ttl;
        if (hits > limit) {
          await r.set(`${k}:b`, '1', 'PX', blockDuration || ttl);
          return { totalHits: hits, timeToExpire: Math.ceil(exp / 1000), isBlocked: true, timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000) };
        }
        return { totalHits: hits, timeToExpire: Math.ceil(exp / 1000), isBlocked: false, timeToBlockExpire: 0 };
      } catch {
        /* fall through to memory */
      }
    }
    const now = Date.now();
    let rec = this.mem.get(k);
    if (!rec || rec.exp < now) rec = { hits: 0, exp: now + ttl, blockedUntil: rec?.blockedUntil ?? 0 };
    if (rec.blockedUntil > now) {
      return { totalHits: rec.hits, timeToExpire: Math.ceil((rec.exp - now) / 1000), isBlocked: true, timeToBlockExpire: Math.ceil((rec.blockedUntil - now) / 1000) };
    }
    rec.hits++;
    if (rec.hits > limit) rec.blockedUntil = now + (blockDuration || ttl);
    this.mem.set(k, rec);
    if (this.mem.size > 50_000) this.mem.clear();
    return {
      totalHits: rec.hits,
      timeToExpire: Math.ceil((rec.exp - now) / 1000),
      isBlocked: rec.hits > limit,
      timeToBlockExpire: rec.hits > limit ? Math.ceil((rec.blockedUntil - now) / 1000) : 0,
    };
  }
}
