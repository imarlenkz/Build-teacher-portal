/** Қазақстанның тұрақты мерекелік демалыс күндері (ММ-КК). Айт күндері жыл сайын ауысады — оларды мұғалім қолмен түзетеді. */
export const HOLIDAYS = ['01-01', '01-02', '01-07', '03-08', '03-21', '03-22', '03-23', '05-01', '05-07', '05-09', '07-06', '08-30', '10-25', '12-16'];

const toD = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Кесте бойынша сабақ күндері: апта күні кестеде неше рет болса, сонша рет қайталанады. Мерекелер өткізіледі. */
export function slotDates(from: string, to: string, weekdays: number[], skip: string[] = HOLIDAYS): string[] {
  const out: string[] = [];
  if (!weekdays.length || !from || !to || from > to) return out;
  const per = new Map<number, number>();
  weekdays.forEach((w) => per.set(w, (per.get(w) ?? 0) + 1));
  for (let d = toD(from); fmt(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = fmt(d);
    if (skip.includes(s.slice(5)) || skip.includes(s)) continue;
    const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    for (let i = 0; i < (per.get(wd) ?? 0); i++) out.push(s);
  }
  return out;
}

/** Сабақтарға кезекпен күн қою: әр сабақ өз сағат санындай кесте сабағын алады (күні — біріншісі). */
export function fillDates<T extends { hours: number; date: string | null }>(lessons: T[], slots: string[]): T[] {
  let k = 0;
  return lessons.map((l) => {
    const date = slots[k] ?? null;
    k += Math.max(1, l.hours || 1);
    return { ...l, date };
  });
}
