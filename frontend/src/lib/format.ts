export const MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
export const MONTHS_CAP = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
export const WEEKDAYS = ['Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі', 'Жексенбі'];
export const WD_SHORT = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс'];
export const ROMAN = ['I', 'II', 'III', 'IV'];

export const dot = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '—');
export const pct = (v?: number | null, digits = 1) => (v == null ? '—' : `${Number(v.toFixed(digits))}%`);
export const num = (v?: number | null) => (v == null ? '—' : String(v));
export const weekdayOf = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
};
export const longDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(d) - 1]}, ${dd} ${MONTHS[m - 1]} ${y}`;
};
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
export const dateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
export const LEVEL_COLORS = ['bad', 'warn', 'acc', 'ok'];
export const levelColor = (i: number | null | undefined, total = 4) => {
  if (i == null) return '';
  if (total === 4) return LEVEL_COLORS[i];
  if (i === 0) return 'bad';
  if (i === total - 1) return 'ok';
  return i === total - 2 ? 'acc' : 'warn';
};
export const STATUS_COLOR: Record<string, string> = { P: 'ok', N: 'bad', S: 'warn', A: 'vio', K: 'acc', O: 'muted' };
export const MOVEMENT_COLOR: Record<string, string> = {
  ADMITTED: 'ok',
  ARRIVED_FROM_SCHOOL: 'ok',
  READMITTED: 'ok',
  TRANSFERRED_CLASS: 'acc',
  LEFT_TO_SCHOOL: 'bad',
  EXPELLED: 'bad',
};
export const cssVar = (name: string) => `var(--${name})`;
