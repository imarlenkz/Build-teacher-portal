import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ScopeService } from '../core/scope.service';
import { PiiService } from '../core/pii.service';
import { AuditService } from '../audit/audit.service';
import { fmtDate, todayStr, toDate } from '../../common/utils/dates';
import { ImportRow, parseStudentWorkbook } from './student-import';

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Оқушылар тізімін Excel-ден импорттау (контингент файлы).
 * Алдымен алдын ала қарау (apply=false), содан кейін сақтау. Ағымдағы оқу жылында жоқ сыныптар жасалады.
 * Бар оқушы ЖСН бойынша (ЖСН жоқ болса — аты-жөні мен туған күні бойынша) табылып, жаңартылады.
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async run(user: AuthUser, base64: string, apply: boolean, meta: RequestMeta) {
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) throw new BadRequestException('Файл бос');
    if (buf.length > MAX_BYTES) throw new BadRequestException('Файл тым үлкен (4 МБ-тан аспауы керек)');
    let parsed: Awaited<ReturnType<typeof parseStudentWorkbook>>;
    try {
      parsed = await parseStudentWorkbook(buf, todayStr());
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const { rows, errors, warnings } = parsed;
    const year = await this.scope.currentYear(user.schoolId);

    const classes = await this.prisma.class.findMany({ where: { schoolId: user.schoolId, schoolYearId: year.id }, select: { id: true, name: true } });
    const classByName = new Map(classes.map((c) => [c.name.toUpperCase(), c.id]));
    const newClasses = [...new Map(rows.filter((r) => !classByName.has(r.className.toUpperCase())).map((r) => [r.className.toUpperCase(), r])).values()].sort(
      (a, b) => a.grade - b.grade || a.letter.localeCompare(b.letter, 'kk'),
    );

    const existing = await this.prisma.student.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      select: { id: true, iinHash: true, fullName: true, lastName: true, firstName: true, middleName: true, birthDate: true, gender: true, classId: true, class: { select: { name: true } } },
    });
    const byHash = new Map(existing.filter((s) => s.iinHash).map((s) => [s.iinHash!, s]));
    const byNameBirth = new Map(existing.map((s) => [`${s.fullName.toLowerCase()}|${fmtDate(s.birthDate)}`, s]));

    type Plan = { r: ImportRow; hash: string | null; match?: (typeof existing)[number]; changes: string[] };
    const plan: Plan[] = rows.map((r) => {
      const hash = r.iin ? this.pii.hash(r.iin) : null;
      const full = [r.lastName, r.firstName, r.middleName].filter(Boolean).join(' ');
      const match = (hash && byHash.get(hash)) || byNameBirth.get(`${full.toLowerCase()}|${r.birthDate}`);
      const changes: string[] = [];
      if (match) {
        if (match.fullName !== full) changes.push('аты-жөні');
        if ((match.class?.name ?? '').toUpperCase() !== r.className.toUpperCase()) changes.push('сыныбы');
        if (fmtDate(match.birthDate) !== r.birthDate) changes.push('туған күні');
        if (match.gender !== r.gender) changes.push('жынысы');
        if (hash && !match.iinHash) changes.push('ЖСН');
      }
      return { r, hash, match, changes };
    });
    const toCreate = plan.filter((p) => !p.match);
    const toUpdate = plan.filter((p) => p.match && p.changes.length);
    const perClass = new Map<string, number>();
    for (const r of rows) perClass.set(r.className, (perClass.get(r.className) ?? 0) + 1);

    const summary = {
      applied: false,
      schoolYear: year.name,
      total: rows.length,
      create: toCreate.length,
      update: toUpdate.length,
      unchanged: plan.length - toCreate.length - toUpdate.length,
      newClasses: newClasses.map((c) => c.className),
      classes: [...perClass.entries()].map(([name, count]) => ({ name, count, isNew: !classByName.has(name.toUpperCase()) })),
      updates: toUpdate.slice(0, 50).map((p) => ({ row: p.r.row, name: p.match!.fullName, changes: p.changes })),
      errors,
      warnings,
    };
    if (!apply) return summary;
    if (!rows.length) throw new BadRequestException('Импорттауға жарамды жол жоқ');

    await this.prisma.$transaction(
      async (tx) => {
        for (const c of newClasses) {
          const created = await tx.class.create({ data: { schoolId: user.schoolId, schoolYearId: year.id, grade: c.grade, letter: c.letter, name: c.className } });
          classByName.set(c.className.toUpperCase(), created.id);
        }
        const last = await tx.student.findFirst({ where: { schoolId: user.schoolId }, orderBy: { id: 'desc' }, select: { studentCode: true } });
        let num = last ? Number(last.studentCode.replace(/\D/g, '')) || 26000 : 26000;
        const start = fmtDate(year.startDate)!;
        const enrolledAt = toDate(start < todayStr() ? start : todayStr());
        if (toCreate.length) {
          await tx.student.createMany({
            data: toCreate.map(({ r, hash }) => ({
              schoolId: user.schoolId,
              studentCode: `ST-${++num}`,
              lastName: r.lastName,
              firstName: r.firstName,
              middleName: r.middleName,
              fullName: [r.lastName, r.firstName, r.middleName].filter(Boolean).join(' '),
              gender: r.gender,
              birthDate: toDate(r.birthDate),
              classId: classByName.get(r.className.toUpperCase())!,
              enrolledAt,
              ...(r.iin ? { iinEncrypted: this.pii.encrypt(r.iin), iinLast4: r.iin.slice(-4), iinHash: hash } : {}),
            })),
          });
        }
        for (const { r, hash, match } of toUpdate) {
          await tx.student.update({
            where: { id: match!.id },
            data: {
              lastName: r.lastName,
              firstName: r.firstName,
              middleName: r.middleName,
              fullName: [r.lastName, r.firstName, r.middleName].filter(Boolean).join(' '),
              gender: r.gender,
              birthDate: toDate(r.birthDate),
              classId: classByName.get(r.className.toUpperCase())!,
              ...(r.iin && !match!.iinHash ? { iinEncrypted: this.pii.encrypt(r.iin), iinLast4: r.iin.slice(-4), iinHash: hash } : {}),
            },
          });
        }
        await this.audit.record(
          user,
          {
            action: 'Оқушыларды Excel-ден импорттады',
            entity: 'student',
            summary: `${summary.create} жаңа, ${summary.update} жаңартылды, ${summary.newClasses.length} жаңа сынып (${year.name})`,
            after: { create: summary.create, update: summary.update, unchanged: summary.unchanged, newClasses: summary.newClasses, skipped: errors.length },
          },
          meta,
          tx,
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    await this.cache.bump(user.schoolId);
    return { ...summary, applied: true };
  }
}
