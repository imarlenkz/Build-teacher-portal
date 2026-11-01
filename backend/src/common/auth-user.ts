import type { RoleCode } from '@prisma/client';

export interface AuthUser {
  id: number;
  login: string;
  fullName: string;
  role: RoleCode;
  permissions: string[];
  /** Пайдаланушының өз мектебі (ADMIN үшін null болуы мүмкін). */
  homeSchoolId: number | null;
  /** Ағымдағы сұраныстың мектебі (ADMIN X-School-Id арқылы ауыстыра алады). */
  schoolId: number;
  teacherId: number | null;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
