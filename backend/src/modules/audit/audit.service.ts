import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ROLE_LABELS_KK } from '../../common/permissions';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** Транзакция ішінде шақырылса, аудит жазбасы негізгі өзгеріспен бірге сақталады. */
  async record(user: AuthUser | null, entry: AuditEntry, meta?: RequestMeta, tx: Tx = this.prisma) {
    try {
      await tx.auditLog.create({
        data: {
          schoolId: user?.schoolId ?? null,
          actorId: user?.id ?? null,
          actorName: user?.fullName ?? 'Жүйе',
          actorRole: user ? ROLE_LABELS_KK[user.role] : 'Жүйе',
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId != null ? String(entry.entityId) : null,
          summary: entry.summary.slice(0, 500),
          before: entry.before === undefined ? Prisma.JsonNull : (entry.before as Prisma.InputJsonValue),
          after: entry.after === undefined ? Prisma.JsonNull : (entry.after as Prisma.InputJsonValue),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        },
      });
    } catch (e) {
      // Транзакция ішінде болса, қате жоғары көтерілуі керек — өзгеріс аудитсіз сақталмайды.
      if (tx !== this.prisma) throw e;
      this.log.error(`audit write failed: ${(e as Error).message}`);
    }
  }

  async list(schoolId: number, q: { page: number; pageSize: number; search?: string; entity?: string; from?: string; to?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      schoolId,
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.from || q.to
        ? { at: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59Z`) } : {}) } }
        : {}),
      ...(q.search
        ? {
            OR: [
              { summary: { contains: q.search, mode: 'insensitive' } },
              { actorName: { contains: q.search, mode: 'insensitive' } },
              { action: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((a) => ({ ...a, id: a.id.toString() })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
