import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AttAgg, Paged, QuarterStat, StudentRow } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { pct } from '../lib/format';
import { useDebounced, useUrlState } from '../hooks';
import { Badge, BarRow, Card, DashboardCard, Empty, ErrorState, Spinner } from '../components/ui';
import { AreaTrend, Bars, Legend, LineTrend, PALETTE, PieBlock } from '../components/charts';

interface AttAnalytics {
  summary: AttAgg;
  byClass: { classId: number; className: string; pct: number | null; lessons: number; excused: number; unexcused: number; late: number }[];
  bySubject: { subject: string; pct: number; total: number }[];
  byMonth: { month: string; label: string; pct: number | null; excused: number; unexcused: number }[];
  byQuarter: { number: number; label: string; pct: number | null }[];
}
interface Yearly {
  schoolYearId: number;
  name: string;
  quarters: QuarterStat[];
}
interface Nat {
  total: number;
  items: { name: string; count: number; pct: number; boys: number; girls: number }[];
  byClass: ({ className: string } & Record<string, number | string>)[];
  names: string[];
}
interface Risk {
  studentId: number;
  score: number;
  reasons: string[];
  fullName: string;
  className: string | null;
  parentPhone: string | null;
  attendancePct: number | null;
  tjbPct: number | null;
  bjbPct: number | null;
}

type Tab = 'overview' | 'classes' | 'subjects' | 'student' | 'nationality' | 'risk';

export default function Analytics() {
  const { ref, year, subjectsOf } = useReference();
  const { can } = useAuth();
  const [s, set] = useUrlState({ tab: 'overview', classId: 0, subjectId: 0, studentId: 0 });
  const tab = (s.tab === 'low' ? 'risk' : s.tab) as Tab;
  const canNat = can(PERM.NATIONALITY);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Жалпы · I→IV тоқсан' },
    { id: 'classes', label: 'Сыныптар' },
    { id: 'subjects', label: 'Пәндер · қатысу' },
    { id: 'student', label: 'Оқушы' },
    ...(canNat ? [{ id: 'nationality' as Tab, label: 'Ұлт бойынша' }] : []),
    { id: 'risk', label: 'Тәуекел тобы' },
  ];
  const filter = { schoolYearId: year.id, classId: s.classId || undefined, subjectId: s.subjectId || undefined };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Аналитика</h1>
        <span className="page-sub">{year.name} оқу жылы</span>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => set({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab !== 'nationality' && tab !== 'student' && (
        <div className="filters">
          <select className="select" value={s.classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0 })} aria-label="Сынып">
            <option value={0}>Барлық сынып</option>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {tab !== 'risk' && (
            <select className="select" value={s.subjectId} onChange={(e) => set({ subjectId: Number(e.target.value) })} aria-label="Пән">
              <option value={0}>Барлық пән</option>
              {subjectsOf(s.classId || null).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {tab === 'overview' && <Overview filter={filter} />}
      {tab === 'classes' && <Classes filter={filter} onPick={(id) => set({ classId: id, tab: 'overview' })} />}
      {tab === 'subjects' && (
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Пәндер бойынша сапа, үлгерім, 5/4/3/2 және СОУ — <Link to="/subject-analysis">Пәндер талдауы</Link> бетінде.
        </p>
      )}
      {tab === 'subjects' && <Subjects filter={filter} />}
      {tab === 'student' && <StudentTab studentId={s.studentId} onPick={(id) => set({ studentId: id })} />}
      {tab === 'nationality' && canNat && <Nationality />}
      {tab === 'risk' && <RiskTab classId={s.classId} />}
    </div>
  );
}

type Filter = { schoolYearId: number; classId?: number; subjectId?: number };

function useAtt(filter: Filter & { studentId?: number }, enabled = true) {
  return useQuery({ queryKey: ['an-att', filter], queryFn: () => api.get<AttAnalytics>('/analytics/attendance', filter), placeholderData: keepPreviousData, enabled });
}
function useYearly(filter: Filter) {
  return useQuery({ queryKey: ['an-yearly', filter], queryFn: () => api.get<Yearly>('/analytics/yearly', filter), placeholderData: keepPreviousData });
}

function Overview({ filter }: { filter: Filter }) {
  const y = useYearly(filter);
  const att = useAtt(filter);
  if (y.isLoading || att.isLoading) return <Spinner block />;
  if (y.isError) return <ErrorState error={y.error} onRetry={() => y.refetch()} />;
  if (att.isError) return <ErrorState error={att.error} onRetry={() => att.refetch()} />;
  const qs = y.data!.quarters;
  const last = [...qs].reverse().find((q) => q.tjbAvg != null || q.bjbAvg != null);
  const prev = last ? qs.find((q) => q.number === last.number - 1) : undefined;
  const delta = (a?: number | null, b?: number | null) => (a != null && b != null ? `${a - b >= 0 ? '+' : ''}${Math.round((a - b) * 10) / 10} п.п. өткен тоқсанмен` : 'салыстыру жоқ');
  const a = att.data!;
  return (
    <div className="stack">
      <div className="kpis k4">
        <DashboardCard label={`ТЖБ орташа · ${last?.label ?? ''}`} value={pct(last?.tjbAvg)} tone="vio" sub={delta(last?.tjbAvg, prev?.tjbAvg)} />
        <DashboardCard label="БЖБ орташа" value={pct(last?.bjbAvg)} tone="acc" sub={delta(last?.bjbAvg, prev?.bjbAvg)} />
        <DashboardCard label="Сапа / Үлгерім" value={`${pct(last?.quality, 0)} / ${pct(last?.progress, 0)}`} tone="ok" />
        <DashboardCard label="Жылдық қатысу" value={pct(a.summary.pct)} sub={`себепсіз ${a.summary.unexcused} · кешікті ${a.summary.late}`} />
      </div>
      <div className="grid-auto">
        <Card title="Тоқсандар бойынша салыстыру (I → IV)">
          <Bars
            height={240}
            domain={[0, 100]}
            suffix="%"
            labels
            data={qs.map((q) => ({ label: q.label, tjb: q.tjbAvg, bjb: q.bjbAvg, quality: q.quality, progress: q.progress }))}
            x="label"
            series={[
              { key: 'tjb', name: 'ТЖБ %', color: 'vio' },
              { key: 'bjb', name: 'БЖБ %', color: 'acc' },
              { key: 'quality', name: 'Сапа', color: 'ok' },
              { key: 'progress', name: 'Үлгерім', color: 'warn' },
            ]}
          />
          <Legend items={[{ name: 'ТЖБ %', color: 'vio' }, { name: 'БЖБ %', color: 'acc' }, { name: 'Сапа', color: 'ok' }, { name: 'Үлгерім', color: 'warn' }]} />
        </Card>
        <Card title="Қатысу динамикасы · айлар">
          <AreaTrend height={240} data={a.byMonth} x="label" domain={[60, 100]} series={[{ key: 'pct', name: 'Қатысу', color: 'ok' }]} />
        </Card>
      </div>
      <Card flush title="Тоқсандық кесте">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Тоқсан</th>
                <th className="num">ТЖБ %</th>
                <th className="num">БЖБ %</th>
                <th className="num">Орташа %</th>
                <th className="num">Сапа</th>
                <th className="num">Үлгерім</th>
                <th className="num">Қатысу</th>
              </tr>
            </thead>
            <tbody>
              {qs.map((q) => (
                <tr key={q.quarterId}>
                  <td>{q.label}</td>
                  <td className="num">{pct(q.tjbAvg)}</td>
                  <td className="num">{pct(q.bjbAvg)}</td>
                  <td className="num">{pct(q.avgPct)}</td>
                  <td className="num">{pct(q.quality, 0)}</td>
                  <td className="num">{pct(q.progress, 0)}</td>
                  <td className="num">{pct(q.attendancePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Classes({ filter, onPick }: { filter: Filter; onPick: (id: number) => void }) {
  const att = useAtt({ ...filter, classId: undefined });
  const { ref } = useReference();
  if (att.isLoading) return <Spinner block />;
  if (att.isError) return <ErrorState error={att.error} onRetry={() => att.refetch()} />;
  const rows = att.data!.byClass;
  return (
    <div className="grid-2">
      <Card title="Сыныптар бойынша қатысу" sub={filter.subjectId ? ref.subjects.find((x) => x.id === filter.subjectId)?.name : 'Барлық пән'}>
        <Bars height={Math.max(220, rows.length * 34)} horizontal labels suffix="%" domain={[0, 100]} data={rows.map((r) => ({ name: r.className, pct: r.pct }))} x="name" series={[{ key: 'pct', name: 'Қатысу', color: 'ok' }]} />
      </Card>
      <Card flush title="Сынып кестесі" sub="Сыныпты басып, оның тоқсандық динамикасын ашыңыз">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Сынып</th>
                <th className="num">Қатысу</th>
                <th className="num">Себепті</th>
                <th className="num">Себепсіз</th>
                <th className="num">Кешікті</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.classId} className="clickable" tabIndex={0} onClick={() => onPick(r.classId)} onKeyDown={(e) => e.key === 'Enter' && onPick(r.classId)}>
                  <td style={{ fontWeight: 500 }}>{r.className}</td>
                  <td className={`num ${r.pct != null && r.pct < ref.attendanceThreshold ? 'c-bad' : ''}`}>{pct(r.pct)}</td>
                  <td className="num">{r.excused}</td>
                  <td className="num">{r.unexcused}</td>
                  <td className="num">{r.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Subjects({ filter }: { filter: Filter }) {
  const att = useAtt({ ...filter, subjectId: undefined });
  const { ref } = useReference();
  if (att.isLoading) return <Spinner block />;
  if (att.isError) return <ErrorState error={att.error} onRetry={() => att.refetch()} />;
  const rows = att.data!.bySubject;
  return (
    <div className="grid-2">
      <Card title="Пәндер бойынша қатысу" sub={filter.classId ? `${ref.classes.find((c) => c.id === filter.classId)?.name} сынып` : 'Барлық сынып'}>
        {rows.length ? (
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((r) => (
              <BarRow key={r.subject} label={r.subject} value={r.pct} display={pct(r.pct)} color={r.pct < ref.attendanceThreshold ? 'bad' : 'ok'} />
            ))}
          </div>
        ) : (
          <Empty>Дерек жоқ</Empty>
        )}
      </Card>
      <Card title="Тоқсандар бойынша қатысу">
        <LineTrend height={240} data={att.data!.byQuarter} x="label" series={[{ key: 'pct', name: 'Қатысу', color: 'acc' }]} domain={[60, 100]} />
      </Card>
    </div>
  );
}

function StudentTab({ studentId, onPick }: { studentId: number; onPick: (id: number) => void }) {
  const { year } = useReference();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const found = useQuery({ queryKey: ['an-pick', dq], queryFn: () => api.get<Paged<StudentRow>>('/students', { search: dq, pageSize: 8, page: 1 }), enabled: dq.trim().length >= 2 });
  const att = useAtt({ schoolYearId: year.id, studentId: studentId || undefined }, !!studentId);
  const st = useQuery({ queryKey: ['student', studentId], queryFn: () => api.get<{ fullName: string; className: string | null }>(`/students/${studentId}`), enabled: !!studentId });
  return (
    <div className="stack">
      <div className="filters">
        <div style={{ position: 'relative' }}>
          <input className="input search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Оқушыны іздеу (кемінде 2 таңба)" aria-label="Оқушыны іздеу" />
          {found.data && dq.length >= 2 && (
            <div className="popover" style={{ left: 0, right: 'auto', minWidth: 300, padding: 4 }}>
              {found.data.items.length ? (
                found.data.items.map((r) => (
                  <button
                    key={r.id}
                    className="menu-item"
                    onClick={() => {
                      onPick(r.id);
                      setQ('');
                    }}
                  >
                    {r.fullName} <span className="muted">· {r.className}</span>
                  </button>
                ))
              ) : (
                <div className="muted" style={{ padding: 8 }}>
                  Табылмады
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {!studentId ? (
        <Card>
          <Empty>Оқушыны таңдаңыз: жеке қатысу динамикасы мен пәндер бойынша көрсеткіштер шығады.</Empty>
        </Card>
      ) : att.isLoading ? (
        <Spinner block />
      ) : att.isError ? (
        <ErrorState error={att.error} />
      ) : (
        <>
          <div className="row">
            <b style={{ fontSize: 16 }}>{st.data?.fullName}</b>
            <span className="muted">{st.data?.className}</span>
            <Link to={`/students/${studentId}`} className="btn sm">
              Профиль
            </Link>
          </div>
          <div className="kpis k4">
            <DashboardCard label="Жылдық қатысу" value={pct(att.data!.summary.pct)} tone="ok" />
            <DashboardCard label="Себепсіз" value={att.data!.summary.unexcused} tone="bad" />
            <DashboardCard label="Себепті / ауырды" value={`${att.data!.summary.excused} / ${att.data!.summary.sick}`} />
            <DashboardCard label="Кешікті" value={att.data!.summary.late} tone="warn" />
          </div>
          <div className="grid-2">
            <Card title="Айлар бойынша">
              <AreaTrend height={220} data={att.data!.byMonth} x="label" domain={[0, 100]} series={[{ key: 'pct', name: 'Қатысу', color: 'ok' }]} />
            </Card>
            <Card title="Пәндер бойынша">
              <div className="stack" style={{ gap: 8 }}>
                {att.data!.bySubject.map((r) => (
                  <BarRow key={r.subject} label={r.subject} value={r.pct} display={pct(r.pct)} color="acc" />
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Nationality() {
  const { ref } = useReference();
  const [classId, setClassId] = useState(0);
  const q = useQuery({ queryKey: ['an-nat', classId], queryFn: () => api.get<Nat>('/analytics/nationality', { classId: classId || undefined }), placeholderData: keepPreviousData });
  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];
  return (
    <div className="stack">
      <div className="filters">
        <select className="select" value={classId} onChange={(e) => setClassId(Number(e.target.value))} aria-label="Сынып">
          <option value={0}>Барлық сынып</option>
          {ref.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted">Құпия дерек: тек әкімшілік рөлдеріне көрінеді</span>
      </div>
      <div className="grid-2">
        <Card title={`Ұлттық құрам · ${d.total} оқушы`}>
          <PieBlock size={240} data={d.items.map((n, i) => ({ name: n.name, value: n.count, color: colorOf(i) }))} />
          <Legend items={d.items.map((n, i) => ({ name: n.name, color: colorOf(i), value: `${n.count} · ${n.pct}%` }))} />
        </Card>
        <Card flush title="Кесте">
          <table className="tbl">
            <thead>
              <tr>
                <th>Ұлты</th>
                <th className="num">Барлығы</th>
                <th className="num">%</th>
                <th className="num">Ұл</th>
                <th className="num">Қыз</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((n) => (
                <tr key={n.name}>
                  <td>{n.name}</td>
                  <td className="num">{n.count}</td>
                  <td className="num">{n.pct}%</td>
                  <td className="num">{n.boys}</td>
                  <td className="num">{n.girls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      {!classId && d.byClass.length > 0 && (
        <Card title="Сыныптар бойынша">
          <Bars height={280} stacked data={d.byClass} x="className" series={d.names.map((n, i) => ({ key: n, name: n, color: colorOf(d.items.findIndex((x) => x.name === n) >= 0 ? d.items.findIndex((x) => x.name === n) : i) }))} />
        </Card>
      )}
    </div>
  );
}

function RiskTab({ classId }: { classId: number }) {
  const q = useQuery({ queryKey: ['an-risk', classId], queryFn: () => api.get<Risk[]>('/analytics/risk', { classId: classId || undefined }), placeholderData: keepPreviousData });
  const { ref } = useReference();
  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  return (
    <Card flush title={`Тәуекел тобындағы оқушылар · ${rows.length}`} sub={`Ағымдағы тоқсан бойынша: қатысу ${ref.attendanceThreshold}%-дан төмен, 3+ себепсіз, ТЖБ ең төменгі деңгейде немесе БЖБ 40%-дан төмен`}>
      {rows.length ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Оқушы</th>
                <th>Сынып</th>
                <th>Себептер</th>
                <th className="num">Қатысу</th>
                <th className="num">ТЖБ</th>
                <th className="num">БЖБ</th>
                <th>Ата-ана тел.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td>
                    <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                      {r.fullName}
                    </Link>
                  </td>
                  <td>{r.className}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {r.reasons.map((x) => (
                        <Badge key={x} tone={r.score >= 3 ? 'bad' : 'warn'}>
                          {x}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="num">{pct(r.attendancePct)}</td>
                  <td className="num">{pct(r.tjbPct)}</td>
                  <td className="num">{pct(r.bjbPct)}</td>
                  <td className="mono">{r.parentPhone ? <a href={`tel:${r.parentPhone.replace(/[^+0-9]/g, '')}`}>{r.parentPhone}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Тәуекел тобында оқушы жоқ</Empty>
      )}
    </Card>
  );
}
