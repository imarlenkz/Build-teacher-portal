import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, download } from '../api/client';
import type { AttAgg, Level, QuarterStat } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dateTime, dot, ROMAN } from '../lib/format';
import { useUrlState } from '../hooks';
import { Badge, Card, Empty, ErrorState, Field, Spinner } from '../components/ui';
import { Bars, Legend } from '../components/charts';

interface StudentLine {
  id: number;
  fullName: string;
  gender: 'M' | 'F';
  attendancePct: number | null;
  unexcused: number;
  bjbPct: number | null;
  tjbPct: number | null;
  tjbScore: number | null;
  level: string | null;
  levelIndex: number | null;
}
interface Report {
  meta: {
    school: string;
    schoolYear: string;
    quarter: number;
    quarterLabel: string;
    period: { from: string; to: string };
    className: string;
    subject: string;
    teacher: string;
    generatedAt: string;
    generatedBy: string;
    status: 'DRAFT' | 'SUBMITTED';
    /** 'ТЖБ' немесе 2–4 сыныптарда 'Аралық'. */
    summative: string;
    submittedAt: string | null;
    dueDate: string | null;
  };
  levels: Level[];
  counts: { students: number; boys: number; girls: number };
  nationality: { name: string; count: number }[] | null;
  movement: { arrived: number; left: number; transferred: number; items: { date: string; student: string; type: string; from: string; to: string; order: string }[] };
  attendance: AttAgg | null;
  bjb: { id: number; title: string; section: string | null; maxScore: number; avgScore: number; avgPct: number; quality: number; progress: number }[];
  tjb: { title: string; maxScore: number; avgScore: number; avgPct: number; maxPct: number; minPct: number; quality: number; progress: number; distribution: number[] } | null;
  overall: { avgPct: number; quality: number; progress: number; avgScore: number | null };
  top: StudentLine[];
  struggling: (StudentLine & { reasons: string[] })[];
  students: StudentLine[];
  dynamics: QuarterStat[];
  summary: string;
  completeness: { hasTjb: boolean; hasBjb: boolean; hasAttendance: boolean };
}
interface StatusRow {
  classId: number;
  className: string;
  subjectId: number;
  subject: string;
  teacher: string;
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt: string | null;
}
interface ClassInfo {
  id: number;
  name: string;
  subjects: { subjectId: number; subject: string; teacher: string }[];
}

const v = (x: number | null | undefined, suf = '%') => (x == null ? '—' : `${x}${suf}`);

export default function QuarterReport() {
  const { ref, quarterId, setQuarterId, year } = useReference();
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [s, set] = useUrlState({ classId: 0, subjectId: 0, quarterId: 0 });
  useEffect(() => {
    if (s.quarterId && ref.years.some((y) => y.quarters.some((q) => q.id === s.quarterId))) setQuarterId(s.quarterId);
    if (s.quarterId) set({ quarterId: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.quarterId]);

  const classes = useQuery({ queryKey: ['classes', year.id], queryFn: () => api.get<ClassInfo[]>('/classes', { schoolYearId: year.id }) });
  const myTeacherName = me?.fullName;
  const classList = classes.data ?? [];
  const classId = classList.some((c) => c.id === s.classId) ? s.classId : (classList.find((c) => ref.classes.some((r) => r.id === c.id && r.isHomeroom))?.id ?? classList[0]?.id ?? 0);
  const cls = classList.find((c) => c.id === classId);
  // Мұғалім үшін алдымен өз пәндері; сынып жетекшісі сыныптың барлық пәнін көре алады.
  const subjects = useMemo(() => {
    const all = cls?.subjects ?? [];
    if (can(PERM.SCHOOL_WIDE)) return all;
    const mine = all.filter((x) => x.teacher === myTeacherName);
    const isHome = ref.classes.some((r) => r.id === classId && r.isHomeroom);
    return isHome ? [...mine, ...all.filter((x) => !mine.includes(x))] : mine.length ? mine : all.filter((x) => ref.classSubjects.some((c) => c.classId === classId && c.subjectId === x.subjectId));
  }, [cls, can, myTeacherName, ref, classId]);
  const subjectId = subjects.some((x) => x.subjectId === s.subjectId) ? s.subjectId : (subjects[0]?.subjectId ?? 0);

  const key = { quarterId, classId, subjectId };
  const report = useQuery({ queryKey: ['report', key], queryFn: () => api.get<Report>('/reports/quarter', key), enabled: !!classId && !!subjectId, placeholderData: keepPreviousData });
  const status = useQuery({ queryKey: ['report-status', quarterId], queryFn: () => api.get<StatusRow[]>('/reports/quarter/status', { quarterId }) });
  const [summary, setSummary] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (report.data) {
      setSummary(report.data.summary);
      setEditing(false);
    }
  }, [report.data]);

  const submit = useMutation({
    mutationFn: () => api.post('/reports/quarter/submit', { ...key, summary }),
    onSuccess: () => {
      toast('Есеп тапсырылды');
      qc.invalidateQueries({ queryKey: ['report'] });
      qc.invalidateQueries({ queryKey: ['report-status'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const exportFile = async (format: 'pdf' | 'xlsx' | 'csv') => {
    setBusy(format);
    try {
      await download('/reports/quarter/export', { ...key, format });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const d = report.data;
  const submittedCount = status.data?.filter((x) => x.status === 'SUBMITTED').length ?? 0;
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Тоқсандық есеп</h1>
        {d && <Badge tone={d.meta.status === 'SUBMITTED' ? 'ok' : 'warn'}>{d.meta.status === 'SUBMITTED' ? `Тапсырылды · ${dateTime(d.meta.submittedAt!)}` : 'Жоба'}</Badge>}
        <span className="grow" />
        {d && can(PERM.EXPORT) && (
          <>
            {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
              <button key={f} className="btn" onClick={() => exportFile(f)} disabled={!!busy}>
                {busy === f ? <Spinner /> : null} {f === 'pdf' ? 'PDF' : f === 'xlsx' ? 'Excel' : 'CSV'}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <Field label="Оқу жылы">
          <select
            className="select"
            value={year.id}
            onChange={(e) => {
              const y = ref.years.find((x) => x.id === Number(e.target.value))!;
              setQuarterId(y.quarters[0].id);
              set({ classId: 0, subjectId: 0 });
            }}
          >
            {ref.years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тоқсан">
          <select className="select" value={quarterId} onChange={(e) => setQuarterId(Number(e.target.value))}>
            {year.quarters.map((q) => (
              <option key={q.id} value={q.id}>
                {ROMAN[q.number - 1]} тоқсан
              </option>
            ))}
          </select>
        </Field>
        <Field label="Сынып">
          <select className="select" value={classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0 })}>
            {classList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value) })}>
            {subjects.map((x) => (
              <option key={x.subjectId} value={x.subjectId}>
                {x.subject}
              </option>
            ))}
          </select>
        </Field>
        <span className="muted" style={{ paddingBottom: 8 }}>
          Есеп деректер бойынша автоматты құрылады
        </span>
      </div>

      <div className="side-layout">
        <div>
          {classes.isLoading || (report.isLoading && !!subjectId) ? (
            <Spinner block />
          ) : !classId || !subjectId ? (
            <Card>
              <Empty>Бұл оқу жылында сізге бекітілген сынып немесе пән жоқ.</Empty>
            </Card>
          ) : report.isError ? (
            <ErrorState error={report.error} onRetry={() => report.refetch()} />
          ) : d ? (
            <Doc d={d} summary={summary} />
          ) : null}
        </div>
        <div className="stack">
          {d && (
            <Card title="Тапсыру" sub={d.meta.dueDate ? `Мерзімі: ${dot(d.meta.dueDate)}` : undefined}>
              <div className="stack" style={{ gap: 8 }}>
                <div className="stack" style={{ gap: 4, fontSize: 12.5 }}>
                  <Check ok={d.completeness.hasAttendance} label="Қатысу белгіленген" />
                  {d.meta.summative === 'ТЖБ' && <Check ok={d.completeness.hasBjb} label="БЖБ нәтижелері енгізілген" />}
                  <Check ok={d.completeness.hasTjb} label={`${d.meta.summative === 'ТЖБ' ? 'ТЖБ' : 'Аралық бағалау'} нәтижелері енгізілген`} />
                </div>
                <Field label="Қорытынды (есепке енеді)">
                  {editing ? (
                    <textarea className="textarea" rows={7} value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} />
                  ) : (
                    <div className="insight" style={{ background: 'var(--soft)' }}>
                      {summary}
                    </div>
                  )}
                </Field>
                <div className="row">
                  <button className="btn" onClick={() => setEditing((x) => !x)}>
                    {editing ? 'Алдын ала қарау' : 'Қорытындыны өңдеу'}
                  </button>
                  <button className="btn primary" disabled={submit.isPending || (!d.completeness.hasBjb && !d.completeness.hasTjb)} onClick={() => submit.mutate()}>
                    {submit.isPending && <Spinner />} {d.meta.status === 'SUBMITTED' ? 'Қайта тапсыру' : 'Есепті тапсыру'}
                  </button>
                </div>
                {!d.completeness.hasBjb && !d.completeness.hasTjb && <div className="muted" style={{ fontSize: 12 }}>Тапсыру үшін {d.meta.summative === 'ТЖБ' ? 'БЖБ немесе ТЖБ' : 'аралық бағалау'} нәтижесі қажет.</div>}
              </div>
            </Card>
          )}
          <Card title="Есептер күйі" sub={status.data ? `${submittedCount} / ${status.data.length} тапсырылды` : undefined}>
            {status.isLoading ? (
              <Spinner block />
            ) : !status.data?.length ? (
              <Empty>Тізім бос</Empty>
            ) : (
              <div className="stack" style={{ gap: 2, maxHeight: 420, overflowY: 'auto' }}>
                {status.data.map((x) => (
                  <button
                    key={`${x.classId}-${x.subjectId}`}
                    className="bar-btn row"
                    style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}
                    aria-pressed={x.classId === classId && x.subjectId === subjectId}
                    onClick={() => set({ classId: x.classId, subjectId: x.subjectId })}
                  >
                    <span style={{ minWidth: 0 }}>
                      <b style={{ fontWeight: 500 }}>
                        {x.className} · {x.subject}
                      </b>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {x.teacher}
                      </div>
                    </span>
                    <Badge tone={x.status === 'SUBMITTED' ? 'ok' : 'warn'}>{x.status === 'SUBMITTED' ? 'тапсырылды' : 'жоба'}</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 'c-ok' : 'muted'}>
      {ok ? '✓' : '○'} {label}
    </span>
  );
}

/** Ресми есеп түріндегі алдын ала қарау (PDF-пен бірдей 14 бөлім). */
function Doc({ d, summary }: { d: Report; summary: string }) {
  const m = d.meta;
  const S = m.summative;
  const bjbAvg = d.bjb.length ? Math.round((d.bjb.reduce((s, b) => s + b.avgPct, 0) / d.bjb.length) * 10) / 10 : null;
  const kpis: [string, string, string?][] = [
    ['1. Оқушылар саны', String(d.counts.students)],
    ['2. Ұлдар', String(d.counts.boys)],
    ['3. Қыздар', String(d.counts.girls)],
    ['6. Сабаққа қатысу', v(d.attendance?.pct), d.attendance ? `себепті ${d.attendance.excused} · себепсіз ${d.attendance.unexcused}` : undefined],
    ['7. БЖБ нәтижесі', v(bjbAvg), `${d.bjb.length} БЖБ`],
    [`8. ${S} нәтижесі`, v(d.tjb?.avgPct), d.tjb?.title],
    ['9. Үлгерім / 10. Сапа', `${v(d.overall.progress)} / ${v(d.overall.quality)}`],
    ['11. Орташа балл', d.tjb ? `${d.tjb.avgScore} / ${d.tjb.maxScore}` : '—'],
  ];
  return (
    <div className="doc">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <b>{m.school}</b>
          <div className="muted">
            {m.schoolYear} оқу жылы · {m.quarterLabel}
          </div>
        </div>
        <div className="muted" style={{ textAlign: 'right' }}>
          Құрылған күні: {dot(m.generatedAt.slice(0, 10))}
          <div>Мұғалім: {m.teacher}</div>
        </div>
      </div>
      <div className="rule" />
      <h1>
        {m.className} сынып · {m.subject} · {m.quarterLabel} қорытындысы
      </h1>
      <div className="muted" style={{ margin: '4px 0 14px' }}>
        Тоқсандық есеп · кезең {dot(m.period.from)} – {dot(m.period.to)}
      </div>
      <div className="kgrid">
        {kpis.map(([l, val, sub]) => (
          <div className="k" key={l}>
            <div className="l">{l}</div>
            <div className="v">{val}</div>
            {sub && (
              <div className="l" style={{ marginTop: 2 }}>
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h2>4. Ұлт бойынша статистика</h2>
          {d.nationality ? (
            <table>
              <thead>
                <tr>
                  <th>Ұлты</th>
                  <th className="num">Саны</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {d.nationality.map((n) => (
                  <tr key={n.name}>
                    <td>{n.name}</td>
                    <td className="num">{n.count}</td>
                    <td className="num">{Math.round((n.count / Math.max(1, d.counts.students)) * 1000) / 10}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Ұлт бойынша дерек тек рұқсаты бар қызметкерлерге көрсетіледі.</div>
          )}
        </div>
        <div>
          <h2>5. Оқушы қозғалысы</h2>
          <div>
            Келді: <b>{d.movement.arrived}</b> · Кетті: <b>{d.movement.left}</b> · Ауысты: <b>{d.movement.transferred}</b>
          </div>
          {d.movement.items.length ? (
            <table style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>Күні</th>
                  <th>Оқушы</th>
                  <th>Түрі</th>
                  <th>Бұйрық</th>
                </tr>
              </thead>
              <tbody>
                {d.movement.items.map((x, i) => (
                  <tr key={i}>
                    <td className="num">{dot(x.date)}</td>
                    <td>{x.student}</td>
                    <td>
                      {x.type} ({x.from} → {x.to})
                    </td>
                    <td>{x.order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted" style={{ marginTop: 4 }}>
              Тоқсанда қозғалыс болған жоқ.
            </div>
          )}
        </div>
      </div>

      <h2>7. БЖБ нәтижелері</h2>
      {d.bjb.length ? (
        <table>
          <thead>
            <tr>
              <th>БЖБ</th>
              <th className="num">Макс.</th>
              <th className="num">Орташа балл</th>
              <th className="num">Орташа %</th>
              <th className="num">Сапа %</th>
              <th className="num">Үлгерім %</th>
            </tr>
          </thead>
          <tbody>
            {d.bjb.map((b) => (
              <tr key={b.id}>
                <td>{b.section ? `${b.title} · ${b.section}` : b.title}</td>
                <td className="num">{b.maxScore}</td>
                <td className="num">{b.avgScore}</td>
                <td className="num">{b.avgPct}</td>
                <td className="num">{b.quality}</td>
                <td className="num">{b.progress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">БЖБ нәтижелері енгізілмеген.</div>
      )}

      <h2>8. {S} нәтижелері</h2>
      {d.tjb ? (
        <table>
          <tbody>
            <tr>
              <td>Атауы</td>
              <td>{d.tjb.title}</td>
            </tr>
            <tr>
              <td>Орташа балл / пайыз</td>
              <td className="num" style={{ textAlign: 'left' }}>
                {d.tjb.avgScore} / {d.tjb.maxScore} · {d.tjb.avgPct}%
              </td>
            </tr>
            <tr>
              <td>Ең жоғары / ең төмен</td>
              <td className="num" style={{ textAlign: 'left' }}>
                {d.tjb.maxPct}% / {d.tjb.minPct}%
              </td>
            </tr>
            {d.levels.map((l, i) => (
              <tr key={l.name}>
                <td>
                  {l.name} ({l.fromPct}–{l.toPct}%)
                </td>
                <td>{d.tjb!.distribution[i]} оқушы</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">{S} нәтижелері енгізілмеген.</div>
      )}

      <h2>12. Жоғары нәтиже көрсеткен оқушылар</h2>
      <StudentsTable rows={d.top} S={S} empty="Жоғары деңгейдегі оқушы жоқ." />
      <h2>13. Қиындық көріп отырған оқушылар</h2>
      {d.struggling.length ? (
        <table>
          <thead>
            <tr>
              <th>Оқушы</th>
              <th>Себебі</th>
              <th className="num">{S} %</th>
              <th className="num">Қатысу</th>
            </tr>
          </thead>
          <tbody>
            {d.struggling.map((x) => (
              <tr key={x.id}>
                <td>{x.fullName}</td>
                <td>{x.reasons.join(', ')}</td>
                <td className="num">{v(x.tjbPct, '')}</td>
                <td className="num">{v(x.attendancePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="muted">Қиындық көріп отырған оқушы жоқ.</div>
      )}

      <h2>14. Пән бойынша динамика және оқу жылы бойынша салыстыру</h2>
      <table>
        <thead>
          <tr>
            <th>Көрсеткіш</th>
            {d.dynamics.map((q) => (
              <th key={q.quarterId} className="num">
                {q.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              [`${S} %`, 'tjbAvg'],
              ['БЖБ %', 'bjbAvg'],
              ['Сапа %', 'quality'],
              ['Үлгерім %', 'progress'],
              ['Қатысу %', 'attendancePct'],
            ] as const
          ).map(([label, k]) => (
            <tr key={k}>
              <td>{label}</td>
              {d.dynamics.map((q) => (
                <td key={q.quarterId} className="num">
                  {q[k] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10 }}>
        <Bars
          height={170}
          domain={[0, 100]}
          suffix="%"
          data={d.dynamics.map((q) => ({ label: q.label, progress: q.progress, quality: q.quality, tjb: q.tjbAvg, bjb: q.bjbAvg }))}
          x="label"
          series={[
            { key: 'progress', name: 'Үлгерім', color: 'ok' },
            { key: 'quality', name: 'Сапа', color: 'acc' },
            { key: 'tjb', name: `${S} %`, color: 'vio' },
            { key: 'bjb', name: 'БЖБ %', color: 'warn' },
          ]}
        />
        <Legend
          items={[
            { name: 'Үлгерім', color: 'ok' },
            { name: 'Сапа', color: 'acc' },
            { name: `${S} %`, color: 'vio' },
            { name: 'БЖБ %', color: 'warn' },
          ]}
        />
      </div>

      <h2>Оқушылар бойынша жиынтық</h2>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Оқушы</th>
            <th className="num">Қатысу</th>
            <th className="num">БЖБ %</th>
            <th className="num">{S} %</th>
            <th>Деңгей</th>
          </tr>
        </thead>
        <tbody>
          {d.students.map((x, i) => (
            <tr key={x.id}>
              <td className="num">{i + 1}</td>
              <td>{x.fullName}</td>
              <td className="num">{v(x.attendancePct)}</td>
              <td className="num">{v(x.bjbPct, '')}</td>
              <td className="num">{v(x.tjbPct, '')}</td>
              <td>{x.level ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Қорытынды</h2>
      <div className="dashed" style={{ whiteSpace: 'pre-wrap' }}>
        {summary || '—'}
      </div>

      <div className="sign">
        <div>
          <div className="muted">Пән мұғалімі</div>
          <div className="line" />
          <div>{m.teacher}</div>
        </div>
        <div>
          <div className="muted">Директордың оқу ісі жөніндегі орынбасары</div>
          <div className="line" />
        </div>
      </div>
    </div>
  );
}

function StudentsTable({ rows, empty, S }: { rows: StudentLine[]; empty: string; S: string }) {
  if (!rows.length) return <div className="muted">{empty}</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Оқушы</th>
          <th className="num">БЖБ %</th>
          <th className="num">{S} %</th>
          <th className="num">Қатысу</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}>
            <td>{x.fullName}</td>
            <td className="num">{v(x.bjbPct, '')}</td>
            <td className="num">{v(x.tjbPct, '')}</td>
            <td className="num">{v(x.attendancePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
