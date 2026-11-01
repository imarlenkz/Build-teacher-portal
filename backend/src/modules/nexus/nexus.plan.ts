/** Nexus /integration/lessons жауабының бір жолы (nesus_new: backend/app/routers/integration.py). */
export interface NexusLesson {
  lesson_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  day_of_week: number; // ISO: 1 = Дүйсенбі
  period_index: number;
  subject_name: string;
  teacher_name: string;
  teacher_email: string;
  group_name: string;
  grade_level: number;
  section: string | null;
  subgroup: string | null;
  classroom: string | null;
}

export interface Existing {
  teachers: { id: number; fullName: string; email: string | null }[];
  classes: { id: number; grade: number; letter: string }[];
  subjects: { id: number; name: string }[];
}

export interface PlanSlot {
  classKey: string;
  subject: string;
  subgroup: string | null;
  teacherEmail: string;
  weekday: number;
  period: number;
  startTime: string;
  endTime: string;
}

export interface Plan {
  teachers: { email: string; fullName: string; existingId: number | null }[];
  classes: { key: string; grade: number; letter: string; name: string; existingId: number | null }[];
  subjects: { name: string; existingId: number | null }[];
  /** Сынып+пән → негізгі мұғалім. */
  assignments: { classKey: string; subject: string; teacherEmail: string }[];
  /** Сынып+пән+топ → топ мұғалімі. */
  groups: { classKey: string; subject: string; name: string; teacherEmail: string }[];
  slots: PlanSlot[];
  warnings: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const LETTER_RE = /^[А-ЯӘҒҚҢӨҰҮҺІA-Z]{1,3}$/u;

/** Ең жиі кездесетін мән (тең болса — алфавит бойынша бірінші). */
function mostFrequent(values: string[]): string {
  const c = new Map<string, number>();
  values.forEach((v) => c.set(v, (c.get(v) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * Nexus-тің күнделікті сабақтарынан Ұстаз-дың апталық кестесін құрады.
 * Мұғалім email бойынша (болмаса аты-жөні бойынша), сынып параллель+литер бойынша,
 * пән атауы бойынша сәйкестендіріледі. Топ (subgroup) сабағы Ұстаз-дағы пән тобына айналады.
 */
export function buildPlan(lessons: NexusLesson[], existing: Existing): Plan {
  const warnings: string[] = [];
  const teachers = new Map<string, { email: string; fullName: string; existingId: number | null }>();
  const classes = new Map<string, Plan['classes'][number]>();
  const subjects = new Map<string, Plan['subjects'][number]>();
  const slots = new Map<string, PlanSlot>();
  const skippedClasses = new Set<string>();

  for (const l of lessons) {
    const email = (l.teacher_email || '').trim().toLowerCase();
    if (!teachers.has(email)) {
      const byEmail = email ? existing.teachers.find((t) => t.email && t.email.toLowerCase() === email) : undefined;
      const byName = byEmail ?? existing.teachers.find((t) => norm(t.fullName) === norm(l.teacher_name));
      teachers.set(email, { email, fullName: l.teacher_name.trim(), existingId: byName?.id ?? null });
    }
    const letter = (l.section ?? '').trim().toUpperCase();
    if (!LETTER_RE.test(letter)) {
      if (!skippedClasses.has(l.group_name)) warnings.push(`«${l.group_name}» сыныбының литері анықталмады — өткізіліп жіберілді`);
      skippedClasses.add(l.group_name);
      continue;
    }
    const key = `${l.grade_level}${letter}`;
    if (!classes.has(key)) {
      const ex = existing.classes.find((c) => c.grade === l.grade_level && c.letter.toUpperCase() === letter);
      classes.set(key, { key, grade: l.grade_level, letter, name: key, existingId: ex?.id ?? null });
    }
    const subj = l.subject_name.trim();
    if (!subjects.has(norm(subj))) {
      const ex = existing.subjects.find((s) => norm(s.name) === norm(subj));
      subjects.set(norm(subj), { name: ex?.name ?? subj, existingId: ex?.id ?? null });
    }
    const subjectName = subjects.get(norm(subj))!.name;
    const sg = l.subgroup?.trim() || null;
    const sk = `${key}|${subjectName}|${sg ?? ''}|${l.day_of_week}|${l.period_index}`;
    if (!slots.has(sk)) {
      slots.set(sk, { classKey: key, subject: subjectName, subgroup: sg, teacherEmail: email, weekday: l.day_of_week, period: l.period_index, startTime: l.starts_at, endTime: l.ends_at });
    }
  }

  const slotList = [...slots.values()];
  const pairs = new Map<string, PlanSlot[]>();
  slotList.forEach((s) => {
    const k = `${s.classKey}|${s.subject}`;
    pairs.set(k, [...(pairs.get(k) ?? []), s]);
  });
  const assignments: Plan['assignments'] = [];
  const groups: Plan['groups'] = [];
  for (const [k, list] of pairs) {
    const [classKey, subject] = k.split('|');
    const whole = list.filter((s) => !s.subgroup);
    const sub = list.filter((s) => s.subgroup);
    assignments.push({ classKey, subject, teacherEmail: mostFrequent((whole.length ? whole : sub).map((s) => s.teacherEmail)) });
    const names = [...new Set(sub.map((s) => s.subgroup!))].sort((a, b) => a.localeCompare(b));
    if (names.length === 1) warnings.push(`${classKey} · ${subject}: тек «${names[0]}» тобы бар — топтарға бөлінбеді`);
    if (names.length >= 2) {
      for (const n of names) groups.push({ classKey, subject, name: n, teacherEmail: mostFrequent(sub.filter((s) => s.subgroup === n).map((s) => s.teacherEmail)) });
    }
  }
  // Бір сыныптың бір уақытында бірнеше сабақ болса (топтарсыз) — ескерту.
  const busy = new Map<string, number>();
  slotList.filter((s) => !s.subgroup).forEach((s) => busy.set(`${s.classKey}|${s.weekday}|${s.period}`, (busy.get(`${s.classKey}|${s.weekday}|${s.period}`) ?? 0) + 1));
  [...busy.entries()].filter(([, n]) => n > 1).forEach(([k]) => warnings.push(`${k.replace(/\|/g, ' · ')}: бір уақытта бірнеше сабақ`));

  return {
    teachers: [...teachers.values()].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    classes: [...classes.values()].sort((a, b) => a.grade - b.grade || a.letter.localeCompare(b.letter)),
    subjects: [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)),
    assignments,
    groups,
    slots: slotList,
    warnings,
  };
}
