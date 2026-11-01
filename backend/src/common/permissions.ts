/**
 * Жүйедегі барлық рұқсаттар. Рөлдер `roles.permissions` бағанында осы кодтарды сақтайды,
 * сондықтан жаңа рөл қосу немесе рұқсатты өзгерту код өзгертуді қажет етпейді.
 */
export const P = {
  STUDENTS_READ: 'students.read',
  STUDENTS_WRITE: 'students.write',
  STUDENTS_IIN_VIEW: 'students.iin.view',
  NATIONALITY_VIEW: 'nationality.view',
  ATTENDANCE_WRITE: 'attendance.write',
  MOVEMENTS_WRITE: 'movements.write',
  ASSESSMENTS_WRITE: 'assessments.write',
  REPORTS_READ: 'reports.read',
  REPORTS_EXPORT: 'reports.export',
  ANALYTICS_READ: 'analytics.read',
  /** Мектептегі барлық сыныптарды көру (мұғалім тек өз сыныптарын көреді). */
  SCHOOL_WIDE: 'school.wide',
  LEVELS_MANAGE: 'levels.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_READ: 'audit.read',
  CLASSES_MANAGE: 'classes.manage',
  USERS_MANAGE: 'users.manage',
  SCHOOLS_MANAGE: 'schools.manage',
  BACKUP_MANAGE: 'backup.manage',
  /** Платформадағы кез келген мектепке ауыса алу (multi-school). */
  PLATFORM_WIDE: 'platform.wide',
} as const;

export type Permission = (typeof P)[keyof typeof P];

const TEACHER: Permission[] = [
  P.STUDENTS_READ,
  P.STUDENTS_WRITE,
  P.ATTENDANCE_WRITE,
  P.MOVEMENTS_WRITE,
  P.ASSESSMENTS_WRITE,
  P.REPORTS_READ,
  P.REPORTS_EXPORT,
  P.ANALYTICS_READ,
];

const SCHOOL_ADMIN: Permission[] = [
  ...TEACHER,
  P.STUDENTS_IIN_VIEW,
  P.NATIONALITY_VIEW,
  P.SCHOOL_WIDE,
  P.LEVELS_MANAGE,
  P.SETTINGS_MANAGE,
  P.AUDIT_READ,
  P.CLASSES_MANAGE,
];

const ADMIN: Permission[] = [...SCHOOL_ADMIN, P.USERS_MANAGE, P.SCHOOLS_MANAGE, P.BACKUP_MANAGE, P.PLATFORM_WIDE];

export const DEFAULT_ROLE_PERMISSIONS = { TEACHER, SCHOOL_ADMIN, ADMIN } as const;

export const ROLE_LABELS_KK = { TEACHER: 'Мұғалім', SCHOOL_ADMIN: 'Әкімшілік', ADMIN: 'Admin' } as const;
