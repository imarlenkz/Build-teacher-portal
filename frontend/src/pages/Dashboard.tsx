import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { AttAgg, LessonOfDay, QuarterStat } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { longDate, pct } from '../lib/format';
import { useIsMobile } from '../hooks';
import { BarRow, Card, DashboardCard, Empty, ErrorState, Segmented, Spinner } from '../components/ui';
import { AreaTrend, Bars, Donut, Legend, LineTrend } from '../components/charts';
import { NotificationList } from '../components/NotificationPanel';

type Period = 'today' | 'week' | 'month' | 'quarter' | 'year';

interface Dash {
  period: Period;
  today: string;
  quarter: { id: number; number: number };
  students: { total: number; boys: number; girls: number; classes: number };
  attendance: AttAgg;
  attendanceToday: AttAgg;
  attendanceSeries: { key: string; label: string; pct: number }[];
  movement: {
    quarter: { arrived: number; left: number; transferred: number; byType: { code: string; count: number }[] };
    byMonth: { label: string; arrived: number; left: number; transferred: number }[];
  };
  studentsByMonth: { label: string; count: number }[];
  performance: { current: QuarterStat; quarters: QuarterStat[] };
  lowAttendance: { id: number; fullName: string; className: string; pct: number }[];
  attendanceThreshold: number;
  nationality?: { name: string; count: number }[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Бүгін' },
  { value: 'week', label: 'Апта' },
  { value: 'month', label: 'Ай' },
  { value: 'quarter', label: 'Тоқсан' },
  { value: 'year', label: 'Оқу жылы' },
];
const PERIOD_WORD: Record<Period, string> = { today: 'бүгін', week: 'осы апта', month: 'осы ай', quarter: 'осы тоқсан', year: 'оқу жылы' };

export const attendanceHref = (l: Pick<LessonOfDay, 'classId' | 'subjectId' | 'period' | 'groupId'>, date: string) =>
  `/attendance?classId=${l.classId}&subjectId=${l.subjectId}&date=${date}&period=${l.period}${l.groupId ? `&groupId=${l.groupId}` : ''}`;

export function useLessons(date?: string) {
  return useQuery({
    queryKey: ['lessons', date ?? 'today'],
    queryFn: () => api.get<{ date: string; holiday: boolean; lessons: LessonOfDay[] }>('/attendance/lessons', { date }),
  });
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const { ref } = useReference();
  const isMobile = useIsMobile();
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>('today');
  const dash = useQuery({ queryKey: ['dashboard', period], queryFn: () => api.get<Dash>('/analytics/dashboard', { period }), placeholderData: (p) => p });
  const lessons = useLessons();
  const first = me?.fullName.split(' ').slice(1).join(' ') || me?.fullName;
  const ls = lessons.data?.lessons ?? [];
  const next = ls.find((l) => !l.marked);
  const today = ref.today;

  if (isMobile) return <MobileToday />;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Қайырлы күн, {first}</h1>
          <div className="page-sub">
            {longDate(today)}
            {lessons.data && (lessons.data.holiday ? ' · бүгін сабақ жоқ' : ` · бүгін ${ls.length} сабақ`)}
          </div>
        </div>
        <span className="grow" />
        <Segmented value={period} onChange={setPeriod} options={PERIODS} label="Кезең" />
      </div>

      {ls.length > 0 &&
        (next ? (
          <div className="next-action">
            <div style={{ flex: 1 }}>
              <div className="eyebrow">Келесі әрекет</div>
              <div className="big">
                {next.period}-сабақ · {next.startTime} · {next.className} {next.subject}{' '}
                <span style={{ fontSize: 13, fontWeight: 400 }}>— {next.students} оқушы, қатысу белгіленбеген</span>
              </div>
            </div>
            <button className="btn" onClick={() => nav(attendanceHref(next, lessons.data!.date))}>
              Қатысуды белгілеу →
            </button>
          </div>
        ) : (
          <div className="next-action done">
            <div className="big">✓ Бүгінгі барлық сабақтың қатысуы белгіленді</div>
          </div>
        ))}

      {dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => dash.refetch()} />
      ) : !dash.data ? (
        <Spinner block />
      ) : (
        <DashBody d={dash.data} period={period} lessons={ls} lessonsDate={lessons.data?.date ?? today} holiday={!!lessons.data?.holiday} canNat={can(PERM.NATIONALITY)} />
      )}
    </div>
  );
}

function DashBody({ d, period, lessons, lessonsDate, holiday, canNat }: { d: Dash; period: Period; lessons: LessonOfDay[]; lessonsDate: string; holiday: boolean; canNat: boolean }) {
  const nav = useNavigate();
  const { ref } = useReference();
  const a = period === 'today' ? d.attendanceToday : d.attendance;
  const todayMarked = lessons.filter((l) => l.marked).reduce((s, l) => s + l.students, 0);
  const unmarked = lessons.filter((l) => !l.marked).reduce((s, l) => s + l.students, 0);
  const cur = d.performance.current;
  const typeName = (c: string) => ref.movementTypes.find((t) => t.code === c)?.name ?? c;
  const maxType = Math.max(1, ...d.movement.quarter.byType.map((x) => x.count));
  const qBars = d.performance.quarters.map((q) => ({ label: q.label.replace(' тоқсан', ''), bjb: q.bjbAvg, tjb: q.tjbAvg, quality: q.quality, progress: q.progress }));
  const avgAtt = d.attendanceSeries.length ? Math.round((d.attendanceSeries.reduce((s, x) => s + x.pct, 0) / d.attendanceSeries.length) * 10) / 10 : null;
  const minAtt = Math.min(100, ...d.attendanceSeries.map((x) => x.pct));

  return (
    <>
      <div className="kpis">
        <DashboardCard label="Оқушылар" value={d.students.total} sub={`ұл ${d.students.boys} · қыз ${d.students.girls} · ${d.students.classes} сынып`} onClick={() => nav('/students')} />
        <DashboardCard
          label={period === 'today' ? 'Бүгін қатысты' : `Қатысу · ${PERIOD_WORD[period]}`}
          value={period === 'today' ? a.present : pct(a.pct)}
          tone="ok"
          sub={period === 'today' ? `${pct(a.pct)}${unmarked ? ` · ${unmarked} белгіленбеген` : ''}` : `${a.present} / ${a.total} белгі`}
          onClick={() => nav('/analytics')}
        />
        <DashboardCard label="Қатыспады" value={a.absent} tone="bad" sub={`себепті ${a.excused} · себепсіз ${a.unexcused}`} />
        <DashboardCard
          label="Қозғалыс · тоқсан"
          value={`+${d.movement.quarter.arrived} / −${d.movement.quarter.left}`}
          sub={`ауысты ${d.movement.quarter.transferred}`}
          onClick={() => nav(`/movements?quarterId=${d.quarter.id}`)}
        />
        <DashboardCard label="БЖБ орташа" value={pct(cur?.bjbAvg)} tone="acc" sub={`${cur?.label ?? ''} · орташа үлгерім ${pct(cur?.avgPct)}`} onClick={() => nav('/bjb')} />
        <DashboardCard label="ТЖБ орташа" value={pct(cur?.tjbAvg)} tone="vio" sub={`сапа ${pct(cur?.quality, 0)} · үлгерім ${pct(cur?.progress, 0)}`} onClick={() => nav('/tjb-analysis')} />
      </div>

      <div className="grid-2">
        <Card title="Сабаққа қатысу динамикасы" action={<span className="card-sub">орташа <b className="mono">{pct(avgAtt)}</b> · {PERIOD_WORD[period]}</span>}>
          {d.attendanceSeries.length ? (
            <AreaTrend data={d.attendanceSeries} x="label" series={[{ key: 'pct', name: 'Қатысу', color: 'acc' }]} domain={[Math.max(0, Math.floor(Math.min(88, minAtt) - 2)), 100]} height={230} />
          ) : (
            <Empty>{period === 'today' ? (holiday ? 'Бүгін сабақ жоқ (демалыс немесе каникул)' : 'Бүгін әлі қатысу белгіленбеген') : 'Кезең бойынша дерек жоқ'}</Empty>
          )}
        </Card>
        <Card title="Ескертулер" action={<Link to="/notifications">Барлығы</Link>}>
          <NotificationList compact />
        </Card>
      </div>

      <div className="grid-3">
        <Card title="Бүгінгі сабақтар" sub={holiday ? 'Демалыс / каникул' : `${todayMarked} оқушы белгіленді`}>
          {!lessons.length ? (
            <Empty>{holiday ? 'Бүгін сабақ жоқ' : 'Кестеде сабақ жоқ'}</Empty>
          ) : (
            <table className="tbl">
              <tbody>
                {lessons.map((l) => (
                  <tr key={`${l.period}-${l.classId}-${l.groupId ?? 0}`}>
                    <td className="mono muted" style={{ width: 52 }}>
                      {l.startTime}
                    </td>
                    <td style={{ fontWeight: 600, width: 44 }}>{l.className}</td>
                    <td>
                      {l.subject}
                      {l.groupName && <span className="muted"> · {l.groupName}</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {l.marked ? (
                        <Link className="btn sm" to={attendanceHref(l, lessonsDate)} title={`${l.present}/${l.students} қатысты`}>
                          Белгіленді
                        </Link>
                      ) : (
                        <Link className="btn sm primary" style={{ height: 26 }} to={attendanceHref(l, lessonsDate)}>
                          Белгілеу
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="БЖБ / ТЖБ динамикасы" action={<Legend items={[{ name: 'БЖБ', color: 'acc' }, { name: 'ТЖБ', color: 'vio' }]} />}>
          <Bars data={qBars} x="label" series={[{ key: 'bjb', name: 'БЖБ', color: 'acc' }, { key: 'tjb', name: 'ТЖБ', color: 'vio' }]} domain={[0, 100]} suffix="%" height={200} />
        </Card>
        <Card title="Құрам және сапа">
          <div className="row" style={{ gap: 16, marginBottom: 14 }}>
            <Donut
              size={96}
              center={d.students.total}
              data={[
                { name: 'Ұлдар', value: d.students.boys, color: 'acc' },
                { name: 'Қыздар', value: d.students.girls, color: 'warn' },
              ]}
            />
            <div className="stack" style={{ gap: 6 }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="sq" style={{ background: 'var(--acc)' }} /> Ұлдар <b className="mono">{d.students.boys}</b>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="sq" style={{ background: 'var(--warn)' }} /> Қыздар <b className="mono">{d.students.girls}</b>
              </span>
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Үлгерім</span>
                <b className="mono">{pct(cur?.progress, 0)}</b>
              </div>
              <div className="bar" style={{ marginTop: 4 }}>
                <span style={{ width: `${cur?.progress ?? 0}%`, background: 'var(--ok)' }} />
              </div>
            </div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>Сапа</span>
                <b className="mono">{pct(cur?.quality, 0)}</b>
              </div>
              <div className="bar" style={{ marginTop: 4 }}>
                <span style={{ width: `${cur?.quality ?? 0}%`, background: 'var(--acc)' }} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid-auto">
        <Card title={`Оқушы қозғалысы · ${cur?.label ?? ''}`} action={<Link to={`/movements?quarterId=${d.quarter.id}`}>Ашу</Link>}>
          {d.movement.quarter.byType.map((t) => (
            <BarRow key={t.code} label={typeName(t.code)} value={t.count} max={maxType} color={['LEFT_TO_SCHOOL', 'EXPELLED'].includes(t.code) ? 'bad' : t.code === 'TRANSFERRED_CLASS' ? 'acc' : 'ok'} />
          ))}
        </Card>
        <Card title="Қатысуы төмен оқушылар" action={<span className="card-sub">&lt; {d.attendanceThreshold}%</span>}>
          {d.lowAttendance.length ? (
            <table className="tbl">
              <tbody>
                {d.lowAttendance.slice(0, 6).map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => nav(`/students/${s.id}`)}>
                    <td>
                      <Link to={`/students/${s.id}`} style={{ color: 'var(--ink)' }}>
                        {s.fullName}
                      </Link>{' '}
                      <span className="muted">· {s.className}</span>
                    </td>
                    <td className="num c-bad" style={{ fontWeight: 600 }}>
                      {pct(s.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Қатысуы төмен оқушы жоқ</Empty>
          )}
        </Card>
        {canNat && d.nationality && (
          <Card title="Ұлт бойынша" action={<span className="card-sub">шектеулі рұқсат</span>}>
            {d.nationality.slice(0, 6).map((n) => (
              <BarRow key={n.name} label={n.name} value={n.count} max={d.students.total} />
            ))}
          </Card>
        )}
      </div>

      <div className="grid-3">
        <Card title="Айлар бойынша оқушы саны">
          <Bars data={d.studentsByMonth} x="label" series={[{ key: 'count', name: 'Оқушылар', color: 'acc' }]} height={180} labels domain={[0, 'auto']} />
        </Card>
        <Card title="Оқушы қозғалысының динамикасы" action={<Legend items={[{ name: 'Келді', color: 'ok' }, { name: 'Кетті', color: 'bad' }, { name: 'Ауысты', color: 'acc' }]} />}>
          <Bars
            data={d.movement.byMonth}
            x="label"
            series={[
              { key: 'arrived', name: 'Келді', color: 'ok' },
              { key: 'left', name: 'Кетті', color: 'bad' },
              { key: 'transferred', name: 'Ауысты', color: 'acc' },
            ]}
            height={180}
          />
        </Card>
        <Card title="Сапа және үлгерім көрсеткіші" action={<Legend items={[{ name: 'Үлгерім', color: 'ok' }, { name: 'Сапа', color: 'acc' }]} />}>
          <LineTrend
            data={qBars}
            x="label"
            series={[
              { key: 'progress', name: 'Үлгерім', color: 'ok' },
              { key: 'quality', name: 'Сапа', color: 'acc' },
            ]}
            height={180}
          />
        </Card>
      </div>
    </>
  );
}

/** Mobile «Бүгін» экраны (1b): 3 KPI және сабақ карточкалары. */
function MobileToday() {
  const { ref } = useReference();
  const lessons = useLessons();
  const nav = useNavigate();
  const ls = lessons.data?.lessons ?? [];
  const present = ls.reduce((s, l) => s + l.present, 0);
  const absent = ls.reduce((s, l) => s + l.absent, 0);
  const unmarked = ls.filter((l) => !l.marked).reduce((s, l) => s + l.students, 0);
  return (
    <div className="stack">
      <div>
        <div className="muted">{longDate(ref.today)}</div>
        <h1 className="page-title">Бүгінгі сабақтар</h1>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <DashboardCard label="Қатысты" value={present} tone="ok" />
        <DashboardCard label="Жоқ" value={absent} tone="bad" />
        <DashboardCard label="Белгіленбеген" value={unmarked} tone="warn" />
      </div>
      {lessons.isLoading ? (
        <Spinner block />
      ) : !ls.length ? (
        <Empty>{lessons.data?.holiday ? 'Бүгін сабақ жоқ — демалыс немесе каникул' : 'Бүгін кестеде сабақ жоқ'}</Empty>
      ) : (
        <div className="m-list">
          {ls.map((l) => (
            <button key={`${l.period}-${l.classId}-${l.groupId ?? 0}`} className="m-card" onClick={() => nav(attendanceHref(l, lessons.data!.date))}>
              <div style={{ width: 52 }}>
                <div className="mono" style={{ fontWeight: 600 }}>
                  {l.startTime}
                </div>
                <div className="muted mono" style={{ fontSize: 11.5 }}>
                  {l.period}-сабақ
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                  {l.className} · {l.subject}
                  {l.groupName ? ` · ${l.groupName}` : ''}
                </div>
                {l.marked ? (
                  <div className="c-ok" style={{ fontSize: 12.5 }}>
                    ✓ {l.present}/{l.students} қатысты · {l.absent} жоқ
                  </div>
                ) : (
                  <div className="c-warn" style={{ fontSize: 12.5 }}>
                    Белгіленбеген
                  </div>
                )}
              </div>
              <span className="muted" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      )}
      <Card title="Ескертулер">
        <NotificationList compact />
      </Card>
    </div>
  );
}
