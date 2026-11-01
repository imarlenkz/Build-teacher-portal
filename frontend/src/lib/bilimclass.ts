/** BilimClass экспортының CSV файлдарын оқу (groups.csv, grades_q1.csv) және сыныптарға бөлу. */

export interface GroupRow {
  subject: string;
  group: string;
  teacher: string | null;
  student: string;
}

export interface GradeRow {
  subject: string;
  group: string;
  student: string;
  date: string | null;
  type: string | null;
  mark: string | null;
  max: string | null;
  quarterMark: string | null;
}

export interface ClassBatch {
  className: string;
  groups: GroupRow[];
  grades: GradeRow[];
}

/** RFC 4180 CSV: тырнақшалар, ішкі жол ауысуы, BOM. Бөлгіш автоматты (`,` `;` немесе таб). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') ((cell += '"'), i++);
        else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      (row.push(cell), rows.push(row), (row = []), (cell = ''));
    } else cell += c;
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const ALIASES: Record<string, string[]> = {
  class: ['class', 'сынып', 'класс'],
  subject: ['subject', 'пән', 'предмет'],
  group: ['group', 'топ', 'группа', 'подгруппа'],
  teacher: ['teacher', 'мұғалім', 'учитель'],
  student: ['student', 'оқушы', 'ученик'],
  date: ['date', 'күні', 'дата'],
  type: ['type', 'түрі', 'тип'],
  mark: ['mark', 'баға', 'балл', 'оценка'],
  max: ['max', 'макс', 'max_score'],
  quarterMark: ['quarter_mark', 'quartermark', 'тоқсандық баға', 'четвертная'],
};

export type CsvKind = 'groups' | 'grades';

/** Тақырып жолы бойынша файл түрін анықтап, жолдарды объектке айналдырады. */
export function readExport(text: string): { kind: CsvKind; className: string; rows: (GroupRow | GradeRow)[] }[] | { error: string } {
  const rows = parseCsv(text);
  if (!rows.length) return { error: 'Файл бос' };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const [k, names] of Object.entries(ALIASES)) idx[k] = head.findIndex((h) => names.includes(h));
  for (const k of ['class', 'subject', 'group', 'student']) if (idx[k] < 0) return { error: `«${ALIASES[k][0]}» бағаны жоқ` };
  const kind: CsvKind = idx.date >= 0 || idx.mark >= 0 || idx.quarterMark >= 0 ? 'grades' : 'groups';
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  const opt = (r: string[], k: string) => get(r, k) || null;
  const byClass = new Map<string, (GroupRow | GradeRow)[]>();
  for (const r of rows.slice(1)) {
    const cls = get(r, 'class');
    if (!cls || !get(r, 'student')) continue;
    const row: GroupRow | GradeRow =
      kind === 'groups'
        ? {
            subject: get(r, 'subject'),
            group: get(r, 'group'),
            teacher: opt(r, 'teacher'),
            student: get(r, 'student'),
          }
        : {
            subject: get(r, 'subject'),
            group: get(r, 'group'),
            student: get(r, 'student'),
            date: opt(r, 'date'),
            type: opt(r, 'type'),
            mark: opt(r, 'mark'),
            max: opt(r, 'max'),
            quarterMark: opt(r, 'quarterMark'),
          };
    byClass.set(cls, [...(byClass.get(cls) ?? []), row]);
  }
  return [...byClass.entries()].map(([className, list]) => ({
    kind,
    className,
    rows: list,
  }));
}

/** Бірнеше файлдың деректерін сынып бойынша біріктіру. */
export function mergeBatches(parts: { kind: CsvKind; className: string; rows: (GroupRow | GradeRow)[] }[]): ClassBatch[] {
  const m = new Map<string, ClassBatch>();
  for (const p of parts) {
    const b = m.get(p.className) ?? {
      className: p.className,
      groups: [],
      grades: [],
    };
    if (p.kind === 'groups') b.groups.push(...(p.rows as GroupRow[]));
    else b.grades.push(...(p.rows as GradeRow[]));
    m.set(p.className, b);
  }
  return [...m.values()].sort((a, b) => a.className.localeCompare(b.className, 'kk', { numeric: true }));
}
