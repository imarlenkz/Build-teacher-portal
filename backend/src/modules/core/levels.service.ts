import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Level } from '../../common/utils/stats';

export const DEFAULT_LEVELS: Level[] = [
  { name: 'Төмен', fromPct: 0, toPct: 39, order: 0 },
  { name: 'Орта', fromPct: 40, toPct: 64, order: 1 },
  { name: 'Жақсы', fromPct: 65, toPct: 84, order: 2 },
  { name: 'Жоғары', fromPct: 85, toPct: 100, order: 3 },
];

@Injectable()
export class LevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(schoolId: number): Promise<Level[]> {
    const rows = await this.prisma.levelRange.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
    return rows.length ? rows.map(({ name, fromPct, toPct, order }) => ({ name, fromPct, toPct, order })) : DEFAULT_LEVELS;
  }

  async settings(schoolId: number) {
    return (
      (await this.prisma.schoolSettings.findUnique({ where: { schoolId } })) ?? {
        schoolId,
        attendanceThreshold: 80,
        foWeight: 25,
        bjbWeight: 25,
        tjbWeight: 50,
        primaryFoWeight: 50,
        interimWeight: 50,
        updatedAt: new Date(),
      }
    );
  }
}
