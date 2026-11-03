import ExcelJS from 'exceljs';
import { isValidIin } from '../../common/utils/crypto';

/** Excel-ден оқылған бір жол (тексерілген). */
export interface ImportRow {
  row: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  iin: string | null;
  grade: number;
  letter: string;
  className: string;
  birthDate: string; // YYYY-MM-DD
  gender: 'M' | 'F';
}

export interface ImportIssue {
  row: number;
  message: string;
}

/** Бағандарды тану: қазақша және орысша тақырыптар. */
const HEADERS: Record<keyof Omit<ImportRow, 'row' | 'grade' | 'letter' | 'gender'> | 'gender', string[]> = {
  lastName: ['тегі', 'фамилия'],
  firstName: ['аты', 'имя'],
  middleName: ['әкесінің аты', 'әкесінің аты-жөні', 'отчество'],
  iin: ['жсн', 'иин', 'жсн/иин'],
  className: ['сынып', 'класс'],
  birthDate: ['туған күні', 'туған күн', 'дата рождения'],
  gender: ['жынысы', 'пол'],
};

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** «ЕРДЕН» → «Ерден», «ахмет-әли» → «Ахмет-Әли»; аралас регистр өзгермейді. */
export function fixCase(s: string) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v);
}

/** «03.12.2019», «2019-12-03» немесе Excel күні → YYYY-MM-DD. */
export function parseDate(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = cellText(v).trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** «1 А», «10Ә», «4-Ғ» → {grade, letter}. */
export function parseClass(s: string): { grade: number; letter: string } | null {
  const m = /^(\d{1,2})\s*[-–]?\s*([\p{L}]{1,3})$/u.exec(s.replace(/["«»]/g, '').trim());
  if (!m) return null;
  const grade = Number(m[1]);
  if (grade < 0 || grade > 12) return null;
  return { grade, letter: m[2].toUpperCase() };
}

/** ЖСН-нің 7-цифры: 1,3,5 — ер; 2,4,6 — әйел. Болмаса әкесінің атының жалғауы бойынша. */
export function genderOf(iin: string | null, middleName: string | null, explicit: string, lastName = ''): 'M' | 'F' | null {
  const e = norm(explicit);
  if (['ер', 'ұл', 'м', 'муж', 'мужской', 'm'].includes(e)) return 'M';
  if (['әйел', 'қыз', 'ж', 'жен', 'женский', 'f'].includes(e)) return 'F';
  const c = iin ? Number(iin[6]) : 0;
  if (c >= 1 && c <= 6) return c % 2 ? 'M' : 'F';
  const p = norm(middleName);
  if (/(ұлы|улы|uly|ович|евич|ич)$/.test(p)) return 'M';
  if (/(қызы|кызы|qyzy|овна|евна|ична|инична)$/.test(p)) return 'F';
  const l = norm(lastName);
  if (/(ова|ева|ёва|ина|ая)$/.test(l)) return 'F';
  if (/(ов|ев|ёв|ин|ий|ой)$/.test(l)) return 'M';
  return null;
}

/** ЖСН-дегі туған күн (YYMMDD + ғасыр цифры). */
export function birthFromIin(iin: string): string | null {
  const c = Number(iin[6]);
  if (c < 1 || c > 6) return null;
  const century = c <= 2 ? 1800 : c <= 4 ? 1900 : 2000;
  return `${century + Number(iin.slice(0, 2))}-${iin.slice(2, 4)}-${iin.slice(4, 6)}`;
}

export async function parseStudentWorkbook(buf: Buffer, today: string) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error('Файл оқылмады. .xlsx форматындағы Excel файлын жүктеңіз');
  }
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const rows: ImportRow[] = [];

  for (const ws of wb.worksheets) {
    // Тақырып жолын алғашқы 10 жолдан іздейміз.
    let headerRow = 0;
    const col: Partial<Record<keyof typeof HEADERS, number>> = {};
    for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
      const found: typeof col = {};
      ws.getRow(r).eachCell((cell, c) => {
        const t = norm(cellText(cell.value));
        for (const [k, names] of Object.entries(HEADERS)) if (names.includes(t) && !found[k as keyof typeof HEADERS]) found[k as keyof typeof HEADERS] = c;
      });
      if (found.lastName && found.firstName && found.className) {
        headerRow = r;
        Object.assign(col, found);
      }
    }
    if (!headerRow) continue;
    if (!col.birthDate && !col.iin) throw new Error('«Туған күні» немесе «ЖСН» бағаны табылмады');

    const seenIin = new Map<string, number>();
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: keyof typeof HEADERS) => (col[k] ? row.getCell(col[k]!).value : null);
      const lastName = fixCase(cellText(get('lastName')));
      const firstName = fixCase(cellText(get('firstName')));
      const classText = cellText(get('className')).trim();
      if (!lastName && !firstName && !classText) continue;
      const middle = fixCase(cellText(get('middleName'))) || null;
      const label = `${lastName} ${firstName}`.trim();

      if (lastName.length < 2 || firstName.length < 2) {
        errors.push({ row: r, message: `Тегі мен аты кемінде 2 әріп болуы керек${label ? ` (${label})` : ''}` });
        continue;
      }
      const cls = parseClass(classText);
      if (!cls) {
        errors.push({ row: r, message: `${label}: сынып танылмады («${classText}»). Мысал: «5 А»` });
        continue;
      }
      let iin: string | null = cellText(get('iin')).replace(/\D/g, '') || null;
      if (iin && iin.length < 12) iin = iin.padStart(12, '0');
      if (iin && !isValidIin(iin)) {
        errors.push({ row: r, message: `${label}: ЖСН қате (${iin.slice(0, 2)}…${iin.slice(-2)})` });
        continue;
      }
      if (iin && seenIin.has(iin)) {
        errors.push({ row: r, message: `${label}: ЖСН ${seenIin.get(iin)}-жолмен қайталанады` });
        continue;
      }
      let birthDate = col.birthDate ? parseDate(get('birthDate')) : null;
      const fromIin = iin ? birthFromIin(iin) : null;
      if (!birthDate && fromIin) birthDate = fromIin;
      if (!birthDate) {
        errors.push({ row: r, message: `${label}: туған күні танылмады` });
        continue;
      }
      if (birthDate > today) {
        errors.push({ row: r, message: `${label}: туған күні болашақта` });
        continue;
      }
      if (fromIin && fromIin !== birthDate) warnings.push({ row: r, message: `${label}: туған күні ЖСН-мен сәйкес емес — кестедегі күн алынды` });
      const gender = genderOf(iin, middle, cellText(get('gender')), lastName);
      if (!gender) {
        errors.push({ row: r, message: `${label}: жынысын анықтау мүмкін болмады — «Жынысы» бағанын қосыңыз` });
        continue;
      }
      if (iin) seenIin.set(iin, r);
      rows.push({ row: r, lastName, firstName, middleName: middle, iin, grade: cls.grade, letter: cls.letter, className: `${cls.grade}${cls.letter}`, birthDate, gender });
    }
    break; // бірінші танылған парақ
  }
  if (!rows.length && !errors.length) throw new Error('Оқушылар табылмады. Бағандар: Тегі, Аты, Әкесінің аты, ЖСН, Сынып, Туған күні');
  return { rows, errors, warnings };
}
