import ExcelJS from 'exceljs';
import { cellText } from '../students/student-import';

/** КТЖ файлынан оқылған бір сабақ. */
export interface PlanRow {
  row: number;
  /** Файлда «1-тоқсан» сияқты бөлгіш болса — тоқсан нөмірі, болмаса null. */
  quarter: number | null;
  section: string | null;
  topic: string;
  objectives: string | null;
  hours: number;
  date: string | null;
  notes: string | null;
}

export interface PlanIssue {
  row: number;
  message: string;
}

type ColKey = 'number' | 'section' | 'topic' | 'objectives' | 'hours' | 'date' | 'notes';

export const LIMITS = { section: 300, topic: 500, objectives: 3000, notes: 500, hours: 20 };

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Тақырып жолындағы ұяшықты бағанға сәйкестендіру (қазақша / орысша). Ретті сақтау маңызды: «ортақ тақырып» — бөлім, тақырып емес. */
export function headerKey(text: string): ColKey | null {
  const t = norm(text);
  if (!t || t.length > 80) return null;
  if (/ескерт|примеч|түзет|коррекц/.test(t)) return 'notes';
  if (/бөлім|раздел|ортақ тақыры[пб]|сквозн|модуль/.test(t)) return 'section';
  if (/мақсат|цел[иья]|цель/.test(t)) return 'objectives';
  if (/сағат|час/.test(t)) return 'hours';
  if (/тақыры[пб]|тема/.test(t)) return 'topic';
  if (/күні|күн$|мерзім|дата|срок/.test(t)) return 'date';
  if (/^(№|р\/с|р\/н|п\/п|№ ?п\/п|№ ?р\/с|сабақ №|№ ?сабақ|рет саны|#)/.test(t)) return 'number';
  return null;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };

/** «1-тоқсан», «II тоқсан», «3 четверть», «IV четверть» → тоқсан нөмірі. */
export function quarterOf(text: string): number | null {
  const t = norm(text);
  const m = /(?:^|[^\p{L}\d])([1-4]|iv|i{1,3})\s*[-–.]?\s*(?:ші|шы|-ші|-шы)?\s*(тоқсан|токсан|четверт)/u.exec(t);
  if (m) return ROMAN[m[1]] ?? Number(m[1]);
  const m2 = /(тоқсан|токсан|четверть)\s*[-–:]?\s*([1-4]|iv|i{1,3})(?![\p{L}\d])/u.exec(t);
  if (m2) return ROMAN[m2[2]] ?? Number(m2[2]);
  return null;
}

/**
 * Сабақ күні: Excel күні, «02.09.2026», «2026-09-02», «02.09» (жылсыз — оқу жылынан анықталады),
 * «02.09-06.09» сияқты аралықтың бірінші күні.
 */
export function parsePlanDate(v: ExcelJS.CellValue, startYear: number): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = cellText(v).trim();
  let y: number, mo: number, d: number;
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(s))) {
    d = Number(m[1]);
    mo = Number(m[2]);
    if (m[3]) y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    // Оқу жылы қыркүйекте басталады: 9–12 айлар — бастапқы жыл, 1–8 — келесі жыл.
    else y = mo >= 9 ? startYear : startYear + 1;
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const isTotal = (s: string) => /^(барлығы|барлык|жиыны|итого|всего|қорытынды)/.test(norm(s));

/**
 * КТЖ Excel файлын оқу. Бір парақтағы тақырып жолын іздеп («Тақырып» / «Тема» бағаны міндетті),
 * әр жолды сабақ ретінде оқиды. «1-тоқсан» жолдары тоқсанды, тақырыбы жоқ біріккен жолдар бөлімді ауыстырады.
 */
export async function parsePlanWorkbook(buf: Buffer, opts: { startYear: number }) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error('Файл оқылмады. .xlsx форматындағы Excel файлын жүктеңіз');
  }
  const errors: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const rows: PlanRow[] = [];
  let sheetName: string | null = null;

  for (const ws of wb.worksheets) {
    let headerRow = 0;
    let col: Partial<Record<ColKey, number>> = {};
    let quarter: number | null = null;
    // Тақырып жолы: «Тақырып» + тағы кемінде бір таныс баған (атауы «Күнтізбелік-тақырыптық жоспар» жолымен шатастырмау үшін).
    // Болмаса — «Тақырып» жалғыз тұрған бірінші жол. Оған дейінгі «2-тоқсан» сияқты атау да ескеріледі.
    let fallback = 0;
    let fallbackCol: typeof col = {};
    const preQuarter: (number | null)[] = [];
    for (let r = 1; r <= Math.min(20, ws.rowCount) && !headerRow; r++) {
      const found: typeof col = {};
      let q: number | null = null;
      ws.getRow(r).eachCell((cell, c) => {
        const t = cellText(cell.value);
        const k = headerKey(t);
        if (k && !found[k]) found[k] = c;
        q = quarterOf(t) ?? q;
      });
      preQuarter[r] = q;
      if (found.topic && Object.keys(found).length >= 2) {
        headerRow = r;
        col = found;
      } else if (found.topic && !fallback && Object.keys(found).length === 1 && norm(cellText(ws.getRow(r).getCell(found.topic).value)).length <= 25) {
        fallback = r;
        fallbackCol = found;
      }
    }
    if (!headerRow && fallback) {
      headerRow = fallback;
      col = fallbackCol;
    }
    for (let r = 1; r < headerRow; r++) quarter = preQuarter[r] ?? quarter;
    if (!headerRow) continue;
    sheetName = ws.name;
    // Тақырыптан кейінгі жол «1, 2, 3…» нөмірлеу жолы болуы мүмкін — оны өткіземіз.
    let section: string | null = null;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: ColKey) => (col[k] ? row.getCell(col[k]!).value : null);
      const texts: string[] = [];
      row.eachCell((cell) => {
        const t = clean(cellText(cell.value));
        if (t && !texts.includes(t)) texts.push(t);
      });
      if (!texts.length) continue;
      if (texts.every((t) => /^\d{1,2}$/.test(t)) && r <= headerRow + 2) continue;
      if (texts.some(isTotal)) continue;

      const topicRaw = clean(cellText(get('topic')));
      const q = texts.length <= 2 ? texts.map(quarterOf).find((x) => x != null) : null;
      if (q != null && (!topicRaw || quarterOf(topicRaw) === q)) {
        quarter = q;
        section = null;
        continue;
      }
      const sectionCell = clean(cellText(get('section')));
      const hoursText = cellText(get('hours')).trim();
      const numText = cellText(get('number')).trim();
      // Бөлім жолы: тақырыбы жоқ, немесе бүкіл жолға біріктірілген бір мәтін (нөмірі мен сағаты жоқ).
      const single = texts.length === 1 && !/^\d+\.?$/.test(numText) && [numText, hoursText].every((t) => !t || clean(t) === texts[0]);
      const sectionLike = /^(\d+[-.\s]*)?(бөлім|раздел|модуль)|^(\d+[-.\s]*)?(-?ші|-?шы)?\s*бөлім/.test(norm(texts[0]));
      if (!topicRaw || (single && (sectionLike || !!col.number || !!col.hours))) {
        const t = sectionCell || topicRaw || texts[0];
        if (!/^\d+([.,]\d+)?$/.test(t)) section = clip(t, LIMITS.section);
        continue;
      }
      if (sectionCell) section = clip(sectionCell, LIMITS.section);

      let hours = 1;
      if (hoursText) {
        const n = Number(hoursText.replace(',', '.').replace(/[^\d.]/g, ''));
        if (Number.isFinite(n) && n >= 1) hours = Math.min(LIMITS.hours, Math.round(n));
        else if (Number.isFinite(n) && n > 0) hours = 1;
        else warnings.push({ row: r, message: `Сағат саны танылмады («${hoursText}»), 1 сағат деп алынды` });
      }
      const dateCell = get('date');
      const dateText = cellText(dateCell).trim();
      const date = dateText ? parsePlanDate(dateCell, opts.startYear) : null;
      if (dateText && !date) warnings.push({ row: r, message: `Күні танылмады («${clip(dateText, 30)}»)` });
      if (topicRaw.length > LIMITS.topic) warnings.push({ row: r, message: `Тақырып ұзын, ${LIMITS.topic} таңбаға дейін қысқартылды` });

      rows.push({
        row: r,
        quarter,
        section,
        topic: clip(topicRaw, LIMITS.topic),
        objectives: clip(clean(cellText(get('objectives'))), LIMITS.objectives) || null,
        hours,
        date,
        notes: clip(clean(cellText(get('notes'))), LIMITS.notes) || null,
      });
    }
    if (rows.length) break;
  }
  if (!sheetName) throw new Error('«Тақырып» (немесе «Тема») бағаны бар тақырып жолы табылмады');
  if (!rows.length) errors.push({ row: 0, message: 'Файлда сабақ табылмады' });
  return { sheet: sheetName, rows, errors, warnings };
}
