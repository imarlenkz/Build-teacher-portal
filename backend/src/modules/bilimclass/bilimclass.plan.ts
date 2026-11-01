import { AssessmentType } from '@prisma/client';
import { FO_MAX, usesInterim } from '../../common/utils/grades';

/**
 * BilimClass экспортын (groups.csv, grades_q1.csv) Ұстаз деректеріне сәйкестендіру.
 * Бұл файл таза функциялардан тұрады: дерекқорға жазбайды, тек жоспар құрады.
 */

export interface GroupRow {
  subject: string;
  group: string;
  teacher?: string | null;
  student: string;
}

export interface GradeRow {
  subject: string;
  group: string;
  student: string;
  date?: string | null;
  type?: string | null;
  mark?: string | null;
  max?: string | null;
  quarterMark?: string | null;
}

export interface Existing {
  grade: number;
  students: { id: number; fullName: string }[];
  subjects: { id: number; name: string }[];
  teachers: { id: number; fullName: string }[];
}

export type Kind = 'FO' | AssessmentType;

export interface PlannedGroup {
  subject: string;
  name: string;
  key: string;
  teacherId: number | null;
  teacherName: string | null;
  members: number[];
}

export interface PlannedFo {
  subject: string;
  groupKey: string | null;
  date: string;
  /** Бір күні бір оқушыға бірнеше ФО қойылса — әрқайсысы жеке бағанға. */
  slot: number;
  marks: { studentId: number; value: number }[];
}

export interface PlannedSummative {
  subject: string;
  groupKey: string | null;
  type: AssessmentType;
  date: string | null;
  maxScore: number;
  title: string;
  results: { studentId: number; score: number; percent: number }[];
}

export interface Plan {
  subjects: string[];
  missingSubjects: string[];
  students: { file: number; matched: number; unmatched: string[] };
  groups: PlannedGroup[];
  fo: PlannedFo[];
  summatives: PlannedSummative[];
  quarterMarks: { subject: string; studentId: number; mark: number }[];
  /** Қате/жарамсыз жолдар саны (себебі warnings ішінде). */
  skipped: number;
  warnings: string[];
}

export const TYPE_LABEL: Record<AssessmentType, string> = {
  BJB: 'БЖБ',
  TJB: 'ТЖБ',
  ARALYK: 'Аралық бағалау',
};

/** Аты-жөнін салыстыру үшін қалыпқа келтіру: кіші әріп, ё→е, нүкте/артық бос орынсыз. */
export function normName(s: string | null | undefined) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «4 А ҚАЗ», «10Ә РУС», «4-Ғ» → {grade, letter}. Тіл бөлімінің белгісі ескерілмейді. */
export function parseClassName(s: string): { grade: number; letter: string } | null {
  const m = /^\s*(\d{1,2})\s*[-–]?\s*["«]?([\p{L}])["»]?(?:\s|$)/u.exec(String(s ?? '').replace(/\s+/g, ' ') + ' ');
  if (!m) return null;
  const grade = Number(m[1]);
  if (grade < 0 || grade > 12) return null;
  return { grade, letter: m[2].toUpperCase() };
}

const WHOLE = new Set(['', 'барлық сынып', 'весь класс', 'все', 'барлығы', 'сынып', 'класс', '-']);

/** Топ атауының кілті: «1 топ», «1-топ», «Группа 1», «1» → «1». Бүкіл сынып → null. */
export function groupKey(name: string | null | undefined): string | null {
  const n = normName(name);
  if (WHOLE.has(n)) return null;
  const d = /\d+/.exec(n);
  return d ? d[0] : n;
}

export function parseKind(s: string | null | undefined): Kind | null {
  const n = normName(s);
  if (!n) return null;
  if (['фо', 'fo', 'формативті', 'формативное', 'ағымдағы', 'текущая'].includes(n)) return 'FO';
  if (['бжб', 'сор', 'bjb'].includes(n)) return 'BJB';
  if (['тжб', 'соч', 'tjb'].includes(n)) return 'TJB';
  if (n.startsWith('аралық') || n.startsWith('промежут') || n === 'aralyk') return 'ARALYK';
  return null;
}

/** «09.09.26», «09.09.2026», «2026-09-09» → YYYY-MM-DD. */
export function parseDay(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])];
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseNum(s: string | null | undefined): number | null {
  const t = String(s ?? '')
    .trim()
    .replace(',', '.');
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Оқушыны сынып тізімінен табу: толық аты-жөні, болмаса «Тегі Аты» бойынша (бірегей болса). */
export function studentMatcher(students: Existing['students']) {
  const full = new Map<string, number | null>();
  const short = new Map<string, number | null>();
  const add = (m: Map<string, number | null>, k: string, id: number) => m.set(k, m.has(k) && m.get(k) !== id ? null : id);
  for (const s of students) {
    const n = normName(s.fullName);
    add(full, n, s.id);
    add(short, n.split(' ').slice(0, 2).join(' '), s.id);
  }
  return (name: string): number | null => {
    const n = normName(name);
    if (!n) return null;
    if (full.has(n)) return full.get(n) ?? null;
    return short.get(n.split(' ').slice(0, 2).join(' ')) ?? null;
  };
}

/**
 * Мұғалімді табу (бірегей болса ғана): толық аты-жөні, «Тегі А.Б.» (тегі + инициалдар),
 * «Тегі Аты» (алғашқы екі сөз), соңында тек тегі. Бір ұяшықта бірнеше мұғалім болса
 * («Тегі А., Тегі Б.»), бірінші табылғаны алынады.
 */
export function teacherMatcher(teachers: Existing['teachers']) {
  const list = teachers.map((t) => ({ id: t.id, w: normName(t.fullName).split(' ') }));
  const unique = (hits: { id: number }[]) => (new Set(hits.map((h) => h.id)).size === 1 ? hits[0].id : null);
  const one = (n: string): number | null => {
    const w = n.split(' ');
    const exact = list.filter((t) => t.w.join(' ') === n);
    if (exact.length) return unique(exact);
    if (w.length > 1 && w.slice(1).every((x) => x.length === 1)) {
      // «Ахметова Г С» (нүктелер алынған)
      return unique(list.filter((t) => t.w[0] === w[0] && w.slice(1).every((x, i) => t.w[i + 1]?.[0] === x)));
    }
    if (w.length >= 2) {
      const hit = unique(list.filter((t) => t.w[0] === w[0] && t.w[1] === w[1]));
      if (hit != null) return hit;
    }
    return unique(list.filter((t) => t.w[0] === w[0]));
  };
  return (name: string | null | undefined): number | null => {
    for (const part of String(name ?? '').split(/[,;/]|\sжәне\s|\sи\s/)) {
      const n = normName(part);
      if (!n) continue;
      const id = one(n);
      if (id != null) return id;
    }
    return null;
  };
}

export function buildPlan(groupsIn: GroupRow[], gradesIn: GradeRow[], ex: Existing): Plan {
  const warnings: string[] = [];
  const warnOnce = new Set<string>();
  const warn = (m: string) => {
    if (warnOnce.has(m)) return;
    warnOnce.add(m);
    if (warnings.length < 200) warnings.push(m);
  };
  let skipped = 0;
  const findStudent = studentMatcher(ex.students);
  const findTeacher = teacherMatcher(ex.teachers);
  const subjectByName = new Map(ex.subjects.map((s) => [normName(s.name), s.name]));

  // Пән атауын Ұстаздағы жазылуына келтіру (табылмаса — файлдағы атауы).
  const subjects = new Map<string, string>();
  const missing = new Set<string>();
  const subj = (name: string) => {
    const n = normName(name);
    if (!subjects.has(n)) {
      const hit = subjectByName.get(n);
      subjects.set(n, hit ?? name.trim());
      if (!hit) missing.add(name.trim());
    }
    return subjects.get(n)!;
  };

  const unmatched = new Set<string>();
  const matchedStudents = new Set<number>();
  const student = (name: string) => {
    const n = normName(name);
    if (!n) return null;
    const id = findStudent(name);
    if (id == null) unmatched.add(name.trim());
    else matchedStudents.add(id);
    return id;
  };

  // ── Топтар ──
  const groups = new Map<string, PlannedGroup>();
  const ensureGroup = (subject: string, name: string, key: string) => {
    const k = `${normName(subject)}|${key}`;
    if (!groups.has(k))
      groups.set(k, {
        subject,
        name: name.trim(),
        key,
        teacherId: null,
        teacherName: null,
        members: [],
      });
    return groups.get(k)!;
  };
  const memberOf = new Map<string, string>(); // subject|studentId → groupKey
  const addMember = (g: PlannedGroup, studentId: number) => {
    const mk = `${normName(g.subject)}|${studentId}`;
    const prev = memberOf.get(mk);
    if (prev && prev !== g.key) {
      warn(`${g.subject}: бір оқушы екі топта көрсетілген, соңғысы алынды`);
      const old = groups.get(`${normName(g.subject)}|${prev}`);
      if (old) old.members = old.members.filter((x) => x !== studentId);
    }
    memberOf.set(mk, g.key);
    if (!g.members.includes(studentId)) g.members.push(studentId);
  };

  for (const r of groupsIn) {
    const subject = subj(r.subject);
    const key = groupKey(r.group);
    const sid = student(r.student);
    if (key == null) continue;
    const g = ensureGroup(subject, r.group, key);
    if (r.teacher && !g.teacherName) {
      g.teacherName = r.teacher.trim();
      g.teacherId = findTeacher(r.teacher);
      if (g.teacherId == null) warn(`Мұғалім табылмады: «${r.teacher.trim()}» (${subject}, ${g.name}) — топ мұғалімсіз жасалады`);
    }
    if (sid != null) addMember(g, sid);
  }

  // ── Бағалар ──
  const fo = new Map<string, PlannedFo>();
  const foCount = new Map<string, number>(); // subject|group|date|student → неше баға
  const sums = new Map<string, PlannedSummative>();
  const quarter = new Map<string, { subject: string; studentId: number; mark: number }>();

  for (const r of gradesIn) {
    const subject = subj(r.subject);
    const gk = groupKey(r.group);
    const sid = student(r.student);
    if (sid == null) {
      skipped++;
      continue;
    }
    if (gk != null) addMember(ensureGroup(subject, r.group, gk), sid);

    // «тоқсандық» түрлі жол: күнделікті баға жоқ, тек қорытынды баға (mark немесе quarter_mark бағанында).
    const quarterOnly = /^(тоқсандық|четвертная|quarter)/.test(normName(r.type));
    const qm = parseNum(r.quarterMark) ?? (quarterOnly ? parseNum(r.mark) : null);
    if (qm != null) {
      if (Number.isInteger(qm) && qm >= 2 && qm <= 5)
        quarter.set(`${normName(subject)}|${sid}`, {
          subject,
          studentId: sid,
          mark: qm,
        });
      else warn(`${subject}: тоқсандық баға «${qm}» 2–5 аралығында емес — өткізілді`);
    }

    const kind = parseKind(r.type);
    const raw = String(r.mark ?? '').trim();
    if (quarterOnly || (!kind && !raw)) continue; // тек тоқсандық баға бар жол
    if (!kind) {
      warn(`Белгісіз баға түрі: «${r.type ?? ''}»`);
      skipped++;
      continue;
    }
    const mark = parseNum(r.mark);
    if (mark == null) {
      if (raw) skipped++; // «н», «бос» т.б. — баға емес
      continue;
    }
    const day = parseDay(r.date);
    const max = parseNum(r.max);

    if (kind === 'FO') {
      if (!day) {
        warn(`${subject}: ФО күні танылмады («${r.date ?? ''}») — өткізілді`);
        skipped++;
        continue;
      }
      const m = max && max !== FO_MAX ? (mark / max) * FO_MAX : mark;
      const value = Math.min(FO_MAX, Math.max(1, Math.round(m)));
      if (mark < 0 || (max ? mark > max : mark > FO_MAX)) {
        warn(`${subject}: ФО бағасы ${mark} шектен тыс — өткізілді`);
        skipped++;
        continue;
      }
      const ck = `${normName(subject)}|${gk ?? ''}|${day}|${sid}`;
      const slot = foCount.get(ck) ?? 0;
      foCount.set(ck, slot + 1);
      const k = `${normName(subject)}|${gk ?? ''}|${day}|${slot}`;
      if (!fo.has(k)) fo.set(k, { subject, groupKey: gk, date: day, slot, marks: [] });
      fo.get(k)!.marks.push({ studentId: sid, value });
      continue;
    }

    const interim = usesInterim(ex.grade);
    if (kind === 'ARALYK' ? !interim : interim || ex.grade < 5) {
      warn(`${subject}: ${ex.grade}-сыныпта ${TYPE_LABEL[kind]} қабылданбайды — өткізілді`);
      skipped++;
      continue;
    }
    if (!max || max <= 0 || mark < 0 || mark > max) {
      warn(`${subject}: ${TYPE_LABEL[kind]} балы ${mark}/${r.max ?? '?'} жарамсыз — өткізілді`);
      skipped++;
      continue;
    }
    const k = `${normName(subject)}|${gk ?? ''}|${kind}|${day ?? ''}|${max}`;
    if (!sums.has(k))
      sums.set(k, {
        subject,
        groupKey: gk,
        type: kind,
        date: day,
        maxScore: max,
        title: '',
        results: [],
      });
    const s = sums.get(k)!;
    const prev = s.results.findIndex((x) => x.studentId === sid);
    const res = {
      studentId: sid,
      score: mark,
      percent: Math.round((mark / max) * 1000) / 10,
    };
    if (prev >= 0) s.results[prev] = res;
    else s.results.push(res);
  }

  // Атаулар: «БЖБ 1», «БЖБ 2» … күні бойынша (пән мен топ ішінде).
  const summatives = [...sums.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const counter = new Map<string, number>();
  for (const s of summatives) {
    const ck = `${normName(s.subject)}|${s.groupKey ?? ''}|${s.type}`;
    const n = (counter.get(ck) ?? 0) + 1;
    counter.set(ck, n);
    s.title = s.type === 'TJB' ? 'ТЖБ' : `${TYPE_LABEL[s.type]} ${n}`;
  }
  // Бір тоқсанда бірнеше ТЖБ болса — нөмірлейміз.
  for (const s of summatives.filter((x) => x.type === 'TJB')) {
    if ((counter.get(`${normName(s.subject)}|${s.groupKey ?? ''}|TJB`) ?? 0) > 1) {
      const same = summatives.filter((x) => x.type === 'TJB' && normName(x.subject) === normName(s.subject) && x.groupKey === s.groupKey);
      s.title = `ТЖБ ${same.indexOf(s) + 1}`;
    }
  }

  return {
    subjects: [...new Set(subjects.values())].sort((a, b) => a.localeCompare(b, 'kk')),
    missingSubjects: [...missing].sort((a, b) => a.localeCompare(b, 'kk')),
    students: {
      file: matchedStudents.size + unmatched.size,
      matched: matchedStudents.size,
      unmatched: [...unmatched].sort((a, b) => a.localeCompare(b, 'kk')),
    },
    groups: [...groups.values()],
    fo: [...fo.values()].sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot),
    summatives,
    quarterMarks: [...quarter.values()],
    skipped,
    warnings,
  };
}
