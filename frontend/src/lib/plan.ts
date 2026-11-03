/** Күнтізбелік-тақырыптық жоспар (КТЖ). */
export interface PlanLesson {
  id?: number;
  section: string | null;
  topic: string;
  objectives: string | null;
  hours: number;
  date: string | null;
  notes: string | null;
  /** Журналда сол күнге баған бар болса — оның id-і. */
  columnId?: number | null;
  past?: boolean;
}

export interface Plan {
  classId: number;
  className: string;
  grade: number;
  subjectId: number;
  subject: string;
  groupId: number | null;
  groupName: string | null;
  quarterId: number;
  quarter: number;
  startDate: string;
  endDate: string;
  schoolYear: string;
  today: string;
  canWrite: boolean;
  /** Сабақ кестесі бойынша апта күндері (1 = Дс … 6 = Сб), әр сабақ — бір элемент. */
  weekdays: number[];
  quarters: { id: number; number: number; lessons: number; hours: number }[];
  journalColumns: number;
  lessons: PlanLesson[];
}

export const WEEKDAYS_KK = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'];

/** Қазақстанның тұрақты мерекелік демалыс күндері (ММ-КК). Ораза/Құрбан айт жыл сайын ауысады — оны қолмен түзетіңіз. */
export const HOLIDAYS = ['01-01', '01-02', '01-07', '03-08', '03-21', '03-22', '03-23', '05-01', '05-07', '05-09', '07-06', '08-30', '10-25', '12-16'];

const toD = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const isoWeekday = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

/** Кесте бойынша сабақ күндері: апта күні кестеде неше рет болса, сонша рет қайталанады. Мерекелер өткізіледі. */
export function slotDates(from: string, to: string, weekdays: number[], skip: string[] = HOLIDAYS): string[] {
  const out: string[] = [];
  if (!weekdays.length || !from || !to || from > to) return out;
  const per = new Map<number, number>();
  weekdays.forEach((w) => per.set(w, (per.get(w) ?? 0) + 1));
  for (let d = toD(from); fmt(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = fmt(d);
    if (skip.includes(s.slice(5)) || skip.includes(s)) continue;
    for (let i = 0; i < (per.get(isoWeekday(d)) ?? 0); i++) out.push(s);
  }
  return out;
}

/** Сабақтарға кезекпен күн қою: әр сабақ өз сағат санындай кесте сабағын алады (күні — біріншісі). */
export function fillDates<T extends { hours: number; date: string | null }>(lessons: T[], slots: string[], fromIndex = 0): T[] {
  let k = 0;
  return lessons.map((l, i) => {
    if (i < fromIndex) return l;
    const date = slots[k] ?? null;
    k += Math.max(1, l.hours || 1);
    return { ...l, date };
  });
}

export const totalHours = (ls: { hours: number }[]) => ls.reduce((a, l) => a + (l.hours || 0), 0);

/** Журнал бағанын қосқанда: таңдалған күнгі жоспар тақырыбы. */
export function topicOn(lessons: PlanLesson[], date: string) {
  const t = lessons.filter((l) => l.date === date).map((l) => l.topic);
  const s = t.join('; ');
  return s.length > 160 ? s.slice(0, 159).trimEnd() + '…' : s;
}
