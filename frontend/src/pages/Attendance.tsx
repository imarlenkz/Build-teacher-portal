import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AttendanceStatus, Paged, StudentRow } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot, MONTHS_CAP, pct, weekdayOf, WD_SHORT } from '../lib/format';
import { useIsMobile, useUrlState } from '../hooks';
import { Card, Empty, ErrorState, Field, Segmented, Spinner, StatusButtons } from '../components/ui';
import { useLessons } from './Dashboard';

interface Sheet {
  lessonId: number | null;
  markedAt: string | null;
  startTime: string | null;
  conflictSubject: string | null;
  students: { id: number; fullName: string; studentCode: string; gender: string; status: AttendanceStatus | null; reasonId: number | null; note: string | null }[];
}
interface CalDay {
  date: string;
  weekday: number;
  off: boolean;
  lessons: number;
  present: number;
  excused: number;
  unexcused: number;
  total: number;
}

const TIMES = ['08:30', '09:25', '10:30', '11:25', '12:20', '13:15', '14:10', '15:05'];
const KEYS: Record<string, AttendanceStatus> = { '1': 'P', '2': 'N', '3': 'S', '4': 'A', '5': 'K', '6': 'O' };

export default function Attendance() {
  const { ref } = useReference();
  const [s, set] = useUrlState({ view: 'mark', classId: 0, subjectId: 0, date: '', period: 0, month: '' });
  const lessons = useLessons();

  // Алдын ала толтыру: бүгінгі бірінші белгіленбеген сабақ.
  useEffect(() => {
    if (s.classId || !lessons.data) return;
    const l = lessons.data.lessons.find((x) => !x.marked) ?? lessons.data.lessons[0];
    if (l) set({ classId: l.classId, subjectId: l.subjectId, date: lessons.data.date, period: l.period });
    else if (ref.classes[0]) {
      const c = ref.classes[0];
      set({ classId: c.id, subjectId: ref.subjectsOf(c.id)[0]?.id ?? 0, date: ref.today, period: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons.data]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Сабаққа қатысу</h1>
        <span className="grow" />
        <Segmented
          value={s.view}
          onChange={(v) => set({ view: v })}
          options={[
            { value: 'mark', label: 'Белгілеу' },
            { value: 'calendar', label: 'Күнтізбе' },
          ]}
          label="Режим"
        />
      </div>
      {s.view === 'calendar' ? (
        <CalendarView classId={s.classId || ref.classes[0]?.id} subjectId={s.subjectId} month={s.month || (s.date || ref.today).slice(0, 7)} set={set} />
      ) : (
        <MarkView classId={s.classId} subjectId={s.subjectId} date={s.date || ref.today} period={s.period || 1} set={set} />
      )}
    </div>
  );
}

type Setter = (p: Partial<{ view: string; classId: number; subjectId: number; date: string; period: number; month: string }>) => void;

function MarkView({ classId, subjectId, date, period, set }: { classId: number; subjectId: number; date: string; period: number; set: Setter }) {
  const { ref, subjectsOf } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const subjects = subjectsOf(classId);
  const params = { classId, subjectId, date, period };
  const ready = !!(classId && subjectId && date && period);
  const sheet = useQuery({ queryKey: ['sheet', params], queryFn: () => api.get<Sheet>('/attendance/sheet', params), enabled: ready && can(PERM.ATTENDANCE) });
  const yearAtt = useQuery({
    queryKey: ['students', { classId, pageSize: 200, att: true }],
    queryFn: () => api.get<Paged<StudentRow>>('/students', { classId, pageSize: 200 }),
    enabled: !!classId && !isMobile,
  });
  const dayLessons = useQuery({ queryKey: ['lessons', date], queryFn: () => api.get<{ lessons: { period: number; classId: number; subjectId: number; startTime: string; className: string; subject: string; marked: boolean }[] }>('/attendance/lessons', { date }), enabled: !!date });
  const [marks, setMarks] = useState<Record<number, AttendanceStatus | null>>({});
  const [reasons, setReasons] = useState<Record<number, number | null>>({});
  const [missing, setMissing] = useState<Set<number>>(new Set());
  const rowRefs = useRef<(HTMLTableRowElement | HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!sheet.data) return;
    setMarks(Object.fromEntries(sheet.data.students.map((x) => [x.id, x.status])));
    setReasons(Object.fromEntries(sheet.data.students.map((x) => [x.id, x.reasonId])));
    setMissing(new Set());
  }, [sheet.data]);

  const students = sheet.data?.students ?? [];
  const count = (st: AttendanceStatus | null) => students.filter((x) => (marks[x.id] ?? null) === st).length;
  const unmarked = students.filter((x) => !marks[x.id]);
  const dirty = students.some((x) => (marks[x.id] ?? null) !== x.status || (reasons[x.id] ?? null) !== x.reasonId);

  const save = useMutation({
    mutationFn: () =>
      api.put('/attendance/sheet', {
        ...params,
        marks: students.map((x) => ({ studentId: x.id, status: marks[x.id], reasonId: ['S', 'A', 'O'].includes(marks[x.id] ?? '') ? (reasons[x.id] ?? null) : null })),
      }),
    onSuccess: () => {
      toast(sheet.data?.markedAt ? 'Өзгерістер сақталды' : 'Қатысу сақталды');
      void qc.invalidateQueries({ queryKey: ['sheet'] });
      void qc.invalidateQueries({ queryKey: ['lessons'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && Array.isArray(e.details)) setMissing(new Set(e.details as number[]));
      toast(e.message, 'error');
    },
  });

  const onSave = () => {
    if (unmarked.length) {
      setMissing(new Set(unmarked.map((x) => x.id)));
      toast(`${unmarked.length} оқушы белгіленбеген`, 'error');
      const i = students.findIndex((x) => !marks[x.id]);
      rowRefs.current[i]?.focus();
      return;
    }
    save.mutate();
  };
  const allPresent = () => {
    setMarks((m) => ({ ...m, ...Object.fromEntries(students.filter((x) => !m[x.id]).map((x) => [x.id, 'P' as const])) }));
    setMissing(new Set());
  };
  const setMark = (id: number, st: AttendanceStatus) => {
    setMarks((m) => ({ ...m, [id]: st }));
    setMissing((ms) => {
      const n = new Set(ms);
      n.delete(id);
      return n;
    });
  };
  const onKey = (e: KeyboardEvent, i: number, id: number) => {
    if (KEYS[e.key]) {
      e.preventDefault();
      setMark(id, KEYS[e.key]);
      rowRefs.current[i + 1]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowRefs.current[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rowRefs.current[i - 1]?.focus();
    }
  };
  const attOf = useMemo(() => new Map((yearAtt.data?.items ?? []).map((x) => [x.id, x.attPct])), [yearAtt.data]);
  const thisDay = dayLessons.data?.lessons ?? [];
  const periods = Array.from({ length: 8 }, (_, i) => i + 1);
  const timeOf = (p: number) => thisDay.find((l) => l.classId === classId && l.period === p)?.startTime ?? TIMES[p - 1];
  const isFuture = date > ref.today;
  const isSunday = weekdayOf(date) === 7;

  if (!can(PERM.ATTENDANCE)) return <Empty>Қатысуды белгілеуге рұқсат жоқ</Empty>;

  const chips = (
    <div className="sum-chips">
      <span className="sum-chip">
        Барлығы <b>{students.length}</b>
      </span>
      {(['P', 'N', 'S', 'A', 'K'] as const).map((st) => (
        <span key={st} className="sum-chip" style={{ background: `var(--${{ P: 'oks', N: 'bads', S: 'warns', A: 'vios', K: 'accs' }[st]})`, color: `var(--${{ P: 'ok', N: 'bad', S: 'warn', A: 'vio', K: 'acc' }[st]})` }}>
          {{ P: 'Қатысты', N: 'Себепсіз', S: 'Себепті', A: 'Ауру', K: 'Кешікті' }[st]} <b>{count(st)}</b>
        </span>
      ))}
      {count('O') > 0 && (
        <span className="sum-chip">
          Басқа <b>{count('O')}</b>
        </span>
      )}
      <span className="sum-chip" style={unmarked.length ? { color: 'var(--warn)' } : undefined}>
        Белгіленбеген <b>{unmarked.length}</b>
      </span>
    </div>
  );

  return (
    <div className="stack">
      <div className="filters" style={{ marginBottom: 0 }}>
        <Field label="Сынып">
          <select
            className="select"
            value={classId}
            onChange={(e) => {
              const c = Number(e.target.value);
              set({ classId: c, subjectId: subjectsOf(c)[0]?.id ?? 0 });
            }}
          >
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value) })}>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Күні">
          <input className="input" type="date" value={date} max={ref.today} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        <Field label="Сабақ">
          <select className="select" value={period} onChange={(e) => set({ period: Number(e.target.value) })}>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}-сабақ · {timeOf(p)}
              </option>
            ))}
          </select>
        </Field>
        <span style={{ flex: 1 }} className="desktop-only" />
        <div className="row desktop-only">
          <button className="btn ok" onClick={allPresent} disabled={!unmarked.length}>
            ✓ Барлығы қатысты
          </button>
          <button className="btn primary" onClick={onSave} disabled={save.isPending || !students.length || (!dirty && !!sheet.data?.markedAt)}>
            {save.isPending ? 'Сақталуда…' : 'Сақтау'}
          </button>
        </div>
      </div>

      {thisDay.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="muted">{date === ref.today ? 'Бүгінгі' : dot(date)} сабақтар:</span>
          {thisDay.map((l) => (
            <button
              key={`${l.period}-${l.classId}`}
              className={`btn sm ${l.classId === classId && l.period === period ? 'primary' : ''}`}
              onClick={() => set({ classId: l.classId, subjectId: l.subjectId, period: l.period })}
              title={l.marked ? 'Белгіленді' : 'Белгіленбеген'}
            >
              {l.period}. {l.className} {l.subject} {l.marked ? '✓' : ''}
            </button>
          ))}
        </div>
      )}

      {isFuture || isSunday ? (
        <Card>
          <Empty>{isFuture ? 'Болашақ күнге қатысу белгіленбейді' : 'Жексенбі — демалыс күні'}</Empty>
        </Card>
      ) : sheet.isError ? (
        <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
      ) : !sheet.data ? (
        <Spinner block />
      ) : sheet.data.conflictSubject ? (
        <Card>
          <Empty>
            Бұл сабақ нөміріне «{sheet.data.conflictSubject}» пәнінің қатысуы белгіленген. Сабақ нөмірін тексеріңіз.
          </Empty>
        </Card>
      ) : (
        <>
          {chips}
          {sheet.data.markedAt && (
            <div className="muted" style={{ fontSize: 12 }}>
              Соңғы сақталған: {new Date(sheet.data.markedAt).toLocaleString('kk-KZ')} · өзгерістер аудит журналына жазылады
            </div>
          )}
          {isMobile ? (
            <div className="m-list m-pad">
              {students.map((x, i) => (
                <div key={x.id} className="m-card" style={{ flexDirection: 'column', alignItems: 'stretch', borderColor: missing.has(x.id) ? 'var(--bad)' : undefined }} ref={(el) => (rowRefs.current[i] = el)} tabIndex={-1}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500, fontSize: 14.5 }}>
                      <span className="mono muted">{i + 1}.</span> {x.fullName}
                    </span>
                  </div>
                  <div className="m-st">
                    <StatusButtons value={marks[x.id] ?? null} onChange={(st) => setMark(x.id, st)} name={x.fullName} />
                  </div>
                </div>
              ))}
              <div className="sticky-actions">
                <button className="btn ok" onClick={allPresent} disabled={!unmarked.length}>
                  ✓ Барлығы қатысты
                </button>
                <button className="btn primary" onClick={onSave} disabled={save.isPending}>
                  Сақтау
                </button>
              </div>
            </div>
          ) : (
            <div className="card flush">
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>№</th>
                      <th>Оқушы</th>
                      <th>Статус · 1 ✓ қатысты · 2 Н себепсіз · 3 С себепті · 4 А ауру · 5 К кешікті</th>
                      <th>Себебі</th>
                      <th className="num">Оқу жылы бойынша қатысу</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((x, i) => {
                      const st = marks[x.id] ?? null;
                      const att = attOf.get(x.id);
                      return (
                        <tr key={x.id} ref={(el) => (rowRefs.current[i] = el)} tabIndex={0} onKeyDown={(e) => onKey(e, i, x.id)} style={missing.has(x.id) ? { background: 'var(--bads)' } : undefined} aria-label={x.fullName}>
                          <td className="mono muted">{i + 1}</td>
                          <td>
                            <Link to={`/students/${x.id}`} style={{ color: 'var(--ink)' }} tabIndex={-1} onClick={(e) => dirty && !confirm('Сақталмаған өзгерістер бар. Шығасыз ба?') && e.preventDefault()}>
                              {x.fullName}
                            </Link>
                          </td>
                          <td>
                            <StatusButtons value={st} onChange={(v) => setMark(x.id, v)} name={x.fullName} withOther />
                          </td>
                          <td>
                            {st && ['S', 'A', 'O'].includes(st) ? (
                              <select className="select" style={{ height: 28, maxWidth: 200 }} value={reasons[x.id] ?? ''} onChange={(e) => setReasons((r) => ({ ...r, [x.id]: e.target.value ? Number(e.target.value) : null }))} aria-label="Себебі">
                                <option value="">—</option>
                                {ref.reasons
                                  .filter((r) => r.isExcused)
                                  .map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name}
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className={`num ${att != null && att < ref.attendanceThreshold ? 'c-bad' : ''}`}>{pct(att)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!students.length && <Empty>Сыныпта оқушы жоқ</Empty>}
            </div>
          )}
        </>
      )}
      {!isMobile && (
        <div className="muted" style={{ fontSize: 12 }}>
          Пернетақта: ↑/↓ — оқушы, 1–6 — статус. <button className="btn ghost sm" onClick={() => nav('/attendance?view=calendar')}>Күнтізбеге өту</button>
        </div>
      )}
    </div>
  );
}

function CalendarView({ classId, subjectId, month, set }: { classId: number; subjectId: number; month: string; set: Setter }) {
  const { ref, subjectsOf } = useReference();
  const q = useQuery({ queryKey: ['calendar', classId, month, subjectId], queryFn: () => api.get<{ days: CalDay[] }>('/attendance/calendar', { classId, month, subjectId: subjectId || undefined }), enabled: !!classId, placeholderData: (p) => p });
  const [y, m] = month.split('-').map(Number);
  const shift = (n: number) => set({ month: new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7) });
  const days = q.data?.days ?? [];
  const lead = days.length ? days[0].weekday - 1 : 0;
  const tot = days.reduce((a, d) => ({ l: a.l + d.lessons, p: a.p + d.present, s: a.s + d.excused, n: a.n + d.unexcused, t: a.t + d.total }), { l: 0, p: 0, s: 0, n: 0, t: 0 });
  return (
    <div className="stack">
      <div className="filters" style={{ marginBottom: 0 }}>
        <Field label="Сынып">
          <select className="select" value={classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0 })}>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value) })}>
            <option value={0}>Барлық пән</option>
            {subjectsOf(classId).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <button className="btn" onClick={() => shift(-1)} aria-label="Алдыңғы ай">
            ←
          </button>
          <b style={{ minWidth: 130, textAlign: 'center' }}>
            {MONTHS_CAP[m - 1]} {y}
          </b>
          <button className="btn" onClick={() => shift(1)} aria-label="Келесі ай">
            →
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <div className="sum-chips" style={{ alignSelf: 'flex-end' }}>
          <span className="sum-chip">
            Сабақ <b>{tot.l}</b>
          </span>
          <span className="sum-chip c-ok">
            Қатысу <b>{tot.t ? pct((tot.p / tot.t) * 100) : '—'}</b>
          </span>
          <span className="sum-chip c-warn">
            Себепті <b>{tot.s}</b>
          </span>
          <span className="sum-chip c-bad">
            Себепсіз <b>{tot.n}</b>
          </span>
        </div>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="card">
          <div className="cal">
            {WD_SHORT.map((d) => (
              <div key={d} className="cal-h">
                {d}
              </div>
            ))}
            {Array.from({ length: lead }).map((_, i) => (
              <div key={`e${i}`} />
            ))}
            {days.map((d) => (
              <button
                key={d.date}
                className={`cal-d ${d.off ? 'off' : ''} ${d.date === ref.today ? 'today' : ''}`}
                onClick={() => !d.off && d.date <= ref.today && set({ view: 'mark', date: d.date, period: 1, subjectId: subjectId || subjectsOf(classId)[0]?.id })}
                disabled={d.off || d.date > ref.today}
                style={{ cursor: d.off ? 'default' : undefined, opacity: d.date > ref.today && !d.off ? 0.6 : 1 }}
                aria-label={`${dot(d.date)}: ${d.lessons} сабақ`}
              >
                <span className="n">{Number(d.date.slice(8))}</span>
                {d.off ? (
                  <span>{d.weekday === 7 ? 'демалыс' : 'каникул'}</span>
                ) : d.lessons ? (
                  <>
                    <span className="muted">{d.lessons} сабақ</span>
                    <span className="c-ok">✓ {d.present}</span>
                    <span>
                      <span className="c-warn">С {d.excused}</span> · <span className="c-bad">Н {d.unexcused}</span>
                    </span>
                  </>
                ) : (
                  <span className="muted">{d.date <= ref.today ? 'белгі жоқ' : ''}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
