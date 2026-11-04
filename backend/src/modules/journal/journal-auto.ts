import { slotDates } from '../plan/plan-dates';

/**
 * Кесте бойынша журналға қосылатын сабақ бағандары.
 * Бір күні кестеде N сабақ болса — N баған; сол күні бұрыннан бар бағандар есептен шығарылады.
 * Тақырып КТЖ-дан алынады: сол күнгі тақырыптар саны бағандар санына тең болса — әрқайсысына өзінікі, әйтпесе біріктіріледі.
 */
export function autoColumns(
  from: string,
  to: string,
  weekdays: number[],
  existing: Map<string, number>,
  planTopics: Map<string, string[]> = new Map(),
  topicMax = 160,
): { date: string; topic: string | null }[] {
  const need = new Map<string, number>();
  for (const d of slotDates(from, to, weekdays)) need.set(d, (need.get(d) ?? 0) + 1);
  const cut = (t: string) => (t.length > topicMax ? t.slice(0, topicMax - 1).trimEnd() + '…' : t);
  const out: { date: string; topic: string | null }[] = [];
  for (const [date, n] of need) {
    const have = existing.get(date) ?? 0;
    const list = planTopics.get(date) ?? [];
    for (let i = have; i < n; i++) {
      const topic = list.length === n ? list[i] : list.length ? list.join('; ') : null;
      out.push({ date, topic: topic ? cut(topic) : null });
    }
  }
  return out;
}
