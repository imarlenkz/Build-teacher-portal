import { FO_MAX, usesInterim } from '../../common/utils/grades';
import { APP_TZ } from '../../common/utils/dates';
import { normName, parseClassName } from '../bilimclass/bilimclass.plan';

/**
 * Тестілеу (test.imarlen.kz) нәтижелерін журналға сәйкестендіру ережелері.
 * Таза функциялар: дерекқорға жазбайды.
 */

export type Kind = 'FO' | 'BJB' | 'TJB' | 'ARALYK';

export const KIND_LABEL: Record<Kind, string> = { FO: 'ФО', BJB: 'БЖБ', TJB: 'ТЖБ', ARALYK: 'Аралық' };

/** Тест тақырыбы журналда осы белгімен басталады — Тестілеуден келген бағандарды тану үшін. */
export const TOPIC_PREFIX = 'Тест: ';

const word = (re: string) => new RegExp(`(^|[^\\p{L}])(${re})($|[^\\p{L}])`, 'iu');
const RX: [Kind, RegExp][] = [
  ['ARALYK', word('аралық|промежуточн\\p{L}*|aralyk')],
  ['TJB', word('тжб|соч|tjb')],
  ['BJB', word('бжб|сор|bjb')],
];

/** Бағалау түрі: Тестілеу айқын жіберсе — сол, әйтпесе тест атауындағы «БЖБ/СОР», «ТЖБ/СОЧ», «Аралық» сөздері; қалғаны — ФО. */
export function detectKind(explicit: string | null | undefined, title: string | null | undefined): Kind {
  const e = String(explicit ?? '').trim().toUpperCase();
  if (e === 'FO' || e === 'BJB' || e === 'TJB' || e === 'ARALYK') return e;
  const t = String(title ?? '');
  for (const [k, re] of RX) if (re.test(t)) return k;
  return 'FO';
}

/**
 * Сынып параллеліне сай түрі: 2–4 сыныптарда БЖБ/ТЖБ орнына аралық бағалау; 1-сыныпта жиынтық бағалау жоқ;
 * 5+ сыныптарда аралық бағалау жоқ.
 */
export function kindForGrade(kind: Kind, grade: number): { kind: Kind } | { skip: string } {
  if (kind === 'FO') return { kind };
  if (grade <= 1) return { skip: '1-сыныпта жиынтық бағалау алынбайды' };
  if (usesInterim(grade)) return { kind: 'ARALYK' };
  if (kind === 'ARALYK') return { skip: 'Аралық бағалау тек 2–4 сыныптарда алынады' };
  return { kind };
}

/** Пайыз → ФО баллы (1–10): 0–14% → 1, 95–100% → 10. */
export function foValue(percent: number): number {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.max(1, Math.min(FO_MAX, Math.round(p / 10)));
}

/** Нәтиже пайызы: Тестілеу жібергені, болмаса балл / ең жоғары балл. */
export function percentOf(r: { percent?: number | null; score: number; max_score: number }): number {
  if (r.percent != null && Number.isFinite(Number(r.percent))) return Math.max(0, Math.min(100, Number(r.percent)));
  return r.max_score > 0 ? Math.max(0, Math.min(100, (r.score / r.max_score) * 100)) : 0;
}

/** ISO уақыт → мектеп уақыт белдеуіндегі күн (YYYY-MM-DD). */
export function dayOf(iso: string, tz = APP_TZ): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Күн кіретін тоқсан; күн тоқсандар арасындағы демалысқа түссе — алдыңғы тоқсан; Тестілеудің тоқсан нөмірі тек қосалқы. */
export function pickQuarter<Q extends { number: number; startDate: Date; endDate: Date }>(quarters: Q[], day: string, hint?: number | null): Q | null {
  const d = new Date(`${day}T00:00:00.000Z`).getTime();
  const sorted = [...quarters].sort((a, b) => a.number - b.number);
  const inside = sorted.find((q) => q.startDate.getTime() <= d && d <= q.endDate.getTime());
  if (inside) return inside;
  if (hint) {
    const h = sorted.find((q) => q.number === hint);
    if (h) return h;
  }
  const before = sorted.filter((q) => q.endDate.getTime() < d).pop();
  return before ?? null;
}

/** «5-Ә», «5 Ә», «5Ә» → {grade, letter}. */
export const parseGroupName = (s: string | null | undefined) => (s ? parseClassName(s.replace(/[-–]/g, ' ')) : null);

/** Тестілеудегі пән атауын Ұстаздағы пәнмен сәйкестендіру: дәл сәйкестік, болмаса жақшадағы/тіл белгісін алып тастап. */
export function subjectMatcher(subjects: { id: number; name: string }[]) {
  const clean = (s: string) => normName(s).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const exact = new Map<string, number | null>();
  const loose = new Map<string, number | null>();
  const add = (m: Map<string, number | null>, k: string, id: number) => m.set(k, m.has(k) && m.get(k) !== id ? null : id);
  for (const s of subjects) {
    add(exact, normName(s.name), s.id);
    add(loose, clean(s.name), s.id);
  }
  return (name: string | null | undefined): number | null => {
    if (!name) return null;
    const n = normName(name);
    if (exact.has(n)) return exact.get(n) ?? null;
    return loose.get(clean(name)) ?? null;
  };
}

/**
 * Оқушыны аты-жөні бойынша табу (бірегей болса ғана). iMARLEN ID-да аты-жөні «Аты Тегі» ретімен
 * келуі мүмкін, Ұстазда — «Тегі Аты Әкесінің аты», сондықтан сөздер реті ескерілмейді:
 * 1) толық сәйкестік, 2) барлық сөздер жиыны, 3) тегі + аты (кез келген ретпен).
 */
export function nameMatcher(students: { id: number; fullName: string }[]) {
  const words = (s: string) => normName(s).split(' ').filter(Boolean);
  const key = (w: string[]) => [...w].sort().join(' ');
  const maps = [new Map<string, number | null>(), new Map<string, number | null>(), new Map<string, number | null>()];
  const add = (m: Map<string, number | null>, k: string, id: number) => k && m.set(k, m.has(k) && m.get(k) !== id ? null : id);
  for (const s of students) {
    const w = words(s.fullName);
    add(maps[0], w.join(' '), s.id);
    add(maps[1], key(w), s.id);
    add(maps[2], key(w.slice(0, 2)), s.id);
  }
  return (name: string | null | undefined): number | null => {
    const w = words(name ?? '');
    if (!w.length) return null;
    for (const [m, k] of [
      [maps[0], w.join(' ')],
      [maps[1], key(w)],
      [maps[2], key(w.slice(0, 2))],
    ] as const) {
      if (m.has(k)) return m.get(k) ?? null;
    }
    // «Аты Тегі Әкесінің аты» → «Тегі Аты» де тексеріледі
    if (w.length >= 3) {
      const k = key([w[0], w[1]]);
      if (maps[2].has(k)) return maps[2].get(k) ?? null;
    }
    return null;
  };
}

export { normName };
