import { useMemo, useState } from 'react';
import type { LessonOfDay } from '../api/types';

type DayLesson = LessonOfDay;

/** Аз болса (мұғалімнің өз сабақтары) — бәрі бір қатарда; көп болса (бүкіл мектеп) — сабақ нөмірі бойынша топталады. */
export function DayLessons({ lessons, label, classId, groupId, period, onPick }: { lessons: DayLesson[]; label: string | null; classId: number; groupId: number | null; period: number; onPick: (l: DayLesson) => void }) {
  const periods = useMemo(() => [...new Set(lessons.map((l) => l.period))].sort((a, b) => a - b), [lessons]);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open ?? (periods.includes(period) ? period : periods[0]);
  const active = (l: DayLesson) => l.classId === classId && l.period === period && (!l.groupId || l.groupId === groupId);
  const key = (l: DayLesson) => `${l.period}-${l.classId}-${l.groupId ?? 0}`;

  if (lessons.length <= 12)
    return (
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {label && <span className="muted">{label} сабақтар:</span>}
        {lessons.map((l) => (
          <button key={key(l)} className={`btn sm ${active(l) ? 'primary' : ''}`} onClick={() => onPick(l)} title={`${l.teacher} · ${l.marked ? 'белгіленді' : 'белгіленбеген'}`}>
            {l.period}. {l.className} {l.subject}
            {l.groupName ? ` · ${l.groupName}` : ''} {l.marked ? '✓' : ''}
          </button>
        ))}
      </div>
    );

  const list = lessons
    .filter((l) => l.period === shown)
    .sort((a, b) => a.className.localeCompare(b.className, 'kk', { numeric: true }) || (a.groupName ?? '').localeCompare(b.groupName ?? '', 'kk', { numeric: true }));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {label && <span className="muted">{label} сабақтар:</span>}
        <div className="seg" role="tablist" style={{ maxWidth: '100%', overflowX: 'auto', flexWrap: 'nowrap' }}>
          {periods.map((p) => {
            const all = lessons.filter((l) => l.period === p);
            const done = all.filter((l) => l.marked).length;
            return (
              <button key={p} role="tab" aria-pressed={p === shown} aria-selected={p === shown} onClick={() => setOpen(p)} title={`${done} / ${all.length} сынып белгіленді`} style={{ whiteSpace: 'nowrap' }}>
                {p}-сабақ <span className={done === all.length ? 'c-ok' : 'muted'} style={{ fontSize: 11.5 }}>{done}/{all.length}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {list.map((l) => (
          <button
            key={key(l)}
            className={`btn sm ${active(l) ? 'primary' : l.marked ? 'ok' : ''}`}
            style={{ minWidth: 48, padding: '2px 8px' }}
            onClick={() => onPick(l)}
            title={`${l.subject}${l.groupName ? ` · ${l.groupName}` : ''} · ${l.teacher} · ${l.marked ? 'белгіленді' : 'белгіленбеген'}`}
          >
            {l.className}
            {l.groupName ? <span style={{ opacity: 0.75 }}> · {shortGroup(l.groupName)}</span> : null}
            {l.marked ? ' ✓' : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

/** «1-топ» → «1-т», «1-топ · Тынышбай» → «1-т», басқасы — алғашқы сөзі. */
function shortGroup(name: string) {
  const d = /\d+/.exec(name);
  return d ? `${d[0]}-т` : name.split(/[\s·]+/)[0];
}
