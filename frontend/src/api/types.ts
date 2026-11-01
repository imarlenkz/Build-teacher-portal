export type Role = 'ADMIN' | 'SCHOOL_ADMIN' | 'TEACHER';
export type AttendanceStatus = 'P' | 'N' | 'S' | 'A' | 'K' | 'O';
export type Gender = 'M' | 'F';

export interface Me {
  id: number;
  login: string;
  fullName: string;
  title: string | null;
  role: Role;
  roleLabel: string;
  permissions: string[];
  locale: string;
  teacherId: number | null;
  homeroomClasses: { id: number; name: string }[];
  school: { id: number; name: string; shortName: string } | null;
  schools: { id: number; name: string; shortName: string }[];
}

export interface Level {
  name: string;
  fromPct: number;
  toPct: number;
  order: number;
}

export interface QuarterRef {
  id: number;
  number: number;
  startDate: string;
  endDate: string;
  reportDueDate: string | null;
}

export interface Reference {
  today: string;
  weekday: number;
  currentYearId: number;
  currentQuarterId: number | null;
  years: { id: number; name: string; isCurrent: boolean; startDate: string; endDate: string; quarters: QuarterRef[] }[];
  classes: { id: number; name: string; grade: number; isHomeroom: boolean }[];
  subjects: { id: number; name: string }[];
  classSubjects: { classId: number; subjectId: number }[];
  nationalities: { id: number; name: string }[] | null;
  reasons: { id: number; code: string; name: string; isExcused: boolean }[];
  levels: Level[];
  attendanceThreshold: number;
  movementTypes: { code: MovementType; name: string; dir: 'in' | 'out' | 'move' }[];
  attendanceStatuses: { code: AttendanceStatus; short: string; name: string }[];
}

export type MovementType = 'ADMITTED' | 'TRANSFERRED_CLASS' | 'ARRIVED_FROM_SCHOOL' | 'LEFT_TO_SCHOOL' | 'EXPELLED' | 'READMITTED';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StudentRow {
  id: number;
  studentCode: string;
  fullName: string;
  gender: Gender;
  birthDate: string;
  classId: number | null;
  className: string | null;
  nationality?: string | null;
  status: string;
  attPct: number | null;
  tjbPct: number | null;
  level: string | null;
  levelIndex: number | null;
}

export interface StudentProfile {
  id: number;
  studentCode: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  fullName: string;
  gender: Gender;
  birthDate: string;
  classId: number | null;
  className: string | null;
  schoolYear: string;
  nationalityId?: number | null;
  nationality?: string | null;
  iinMasked: string | null;
  canRevealIin: boolean;
  phone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  enrolledAt: string | null;
  previousSchool: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'LEFT' | 'EXPELLED';
  attendance: { total: number; pct: number | null; excused: number; sick: number; unexcused: number; late: number };
}

export interface LessonOfDay {
  period: number;
  startTime: string;
  endTime: string;
  classId: number;
  className: string;
  subjectId: number;
  subject: string;
  teacher: string;
  students: number;
  marked: boolean;
  present: number;
  absent: number;
  excused: number;
  unexcused: number;
}

export interface Notification {
  id: number;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  body: string | null;
  link: { screen: string; params?: Record<string, string | number> } | null;
  readAt: string | null;
  createdAt: string;
}

export interface QuarterStat {
  quarterId: number;
  number: number;
  label: string;
  tjbAvg: number | null;
  bjbAvg: number | null;
  quality: number | null;
  progress: number | null;
  avgPct: number | null;
  attendancePct?: number | null;
}

export interface AttAgg {
  total: number;
  present: number;
  absent: number;
  excused: number;
  sick: number;
  unexcused: number;
  late: number;
  pct: number | null;
}
