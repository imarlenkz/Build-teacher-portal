/** Барлық күндер API-де 'YYYY-MM-DD' түрінде. Мектеп уақыт белдеуі — APP_TZ (әдепкі Asia/Almaty). */
export const APP_TZ = process.env.APP_TZ || 'Asia/Almaty';

export function todayStr(tz = APP_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export function toDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function fmtDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** dd.mm.yyyy — ресми құжаттар үшін. */
export function fmtDot(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}.${m}.${y}`;
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d)!;
}

/** ISO апта күні: 1 = Дүйсенбі … 7 = Жексенбі. */
export function weekday(s: string): number {
  const w = toDate(s).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(s: string): string {
  return addDays(s, 1 - weekday(s));
}

export function startOfMonth(s: string): string {
  return s.slice(0, 8) + '01';
}

export function endOfMonth(s: string): string {
  const d = toDate(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmtDate(d)!;
}

export function minDate(a: string, b: string) {
  return a < b ? a : b;
}
export function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

export const MONTHS_KK = ['Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым', 'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'];
export const MONTHS_KK_SHORT = ['Қаң', 'Ақп', 'Нау', 'Сәу', 'Мам', 'Мау', 'Шіл', 'Там', 'Қыр', 'Қаз', 'Қар', 'Жел'];
export const WEEKDAYS_KK = ['Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі', 'Жексенбі'];
export const QUARTER_ROMAN = ['I', 'II', 'III', 'IV'];
