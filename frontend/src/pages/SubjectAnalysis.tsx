import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, download } from '../api/client';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { pct } from '../lib/format';
import { useUrlState } from '../hooks';
import { Card, DashboardCard, Empty, ErrorState, ExportMenu, Segmented, Spinner } from '../components/ui';
import { Bars, Legend, LineTrend } from '../components/charts';

interface Stats {
  count: number;
  d5: number;
  d4: number;
  d3: number;
  d2: number;
  quality: number | null;
  progress: number | null;
  avgMark: number | null;
  sou: number | null;
  bjbAvg: number | null;
  tjbAvg: number | null;
  attendancePct?: number | null;
}
interface SubjectRow extends Stats {
  subjectId: number;
  name: string;
  classes: number;
  trend: { quarterId: number; label: string; quality: number | null; progress: number | null; avgMark: number | null }[];
}
interface ClassRow extends Stats {
  classId: number;
  className: string;
  grade: number;
  teacher: string | null;
  prevQuality: number | null;
}
interface Data {
  schoolYearId: number;
  yearName: string;
  quarters: { id: number; number: number; label: string; hasMarks: boolean }[];
  quarterId: number | null;
  periodLabel: string;
  totals: Stats;
  subjects: SubjectRow[];
  detail: null | {
    subjectId: number;
    name: string;
    prevLabel: string | null;
    byClass: ClassRow[];
    byGrade: ({ grade: number } & Stats)[];
    failing: { studentId: number; fullName: string; className: string }[];
  };
}

const ROMAN = ['I', 'II', 'III', 'IV'];
const qTone = (v: number | null) => (v == null ? '' : v < 30 ? 'bad' : v < 50 ? 'warn' : v >= 70 ? 'ok' : '');
const pTone = (v: number | null) => (v == null ? '' : v < 70 ? 'bad' : v < 90 ? 'warn' : 'ok');
/** Excel-дегі шартты пішімдеу сияқты: ұяшық фоны деңгейге қарай боялады. */
const fill = (tone: string) => (tone ? { background: `var(--${tone}s)`, color: `var(--${tone})`, fontWeight: 600 } : undefined);
const mark = (v: number | null) => (v == null ? '—' : v.toFixed(2));

/** Пәндер бойынша жалпы талдау: тоқсандық/жылдық бағалар негізінде сапа, үлгерім, 5/4/3/2, СОУ, БЖБ/ТЖБ, қатысу. */
export default function SubjectAnalysis() {
  const { ref, year } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  // p: 0 — бағасы бар соңғы тоқсан, -1 — жылдық, әйтпесе тоқсан id.
  const [s, set] = useUrlState({ p: 0, grade: 0, classId: 0, subjectId: 0, sort: 'name' });
  const query = {
    schoolYearId: year.id,
    quarterId: s.p === -1 ? 0 : s.p || undefined,
    grade: s.grade || undefined,
    classId: s.classId || undefined,
    subjectId: s.subjectId || undefined,
  };
  const q = useQuery({ queryKey: ['an-subjects', query], queryFn: () => api.get<Data>('/analytics/subjects', query), placeholderData: keepPreviousData });
  const grades = [...new Set(ref.classes.map((c) => c.grade).filter((g) => g >= 2))].sort((a, b) => a - b);
  const classes = ref.classes.filter((c) => c.grade >= 2 && (!s.grade || c.grade === s.grade));
  const d = q.data;
  const rows = useMemo(() => {
    const r = [...(d?.subjects ?? [])];
    if (s.sort === 'quality') r.sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
    if (s.sort === 'progress') r.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
    return r;
  }, [d, s.sort]);

  const exportFile = async (format: string) => {
    try {
      await download('/analytics/subjects/export', { ...query, format });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const period = s.p === -1 ? -1 : (d?.quarterId ?? s.p);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Пәндер бойынша талдау</h1>
        <span className="page-sub">
          {year.name} оқу жылы{d ? ` · ${d.periodLabel}` : ''}
        </span>
        <span className="grow" />
        {can(PERM.EXPORT) && <ExportMenu onExport={exportFile} formats={['xlsx', 'csv']} />}
      </div>
      <div className="filters">
        <Segmented
          label="Кезең"
          value={period}
          onChange={(v) => set({ p: v })}
          options={[
            ...(d?.quarters ?? year.quarters.map((x) => ({ id: x.id, number: x.number, label: '', hasMarks: true }))).map((x) => ({
              value: x.id,
              label: <span className={'hasMarks' in x && !x.hasMarks ? 'muted' : ''}>{ROMAN[x.number - 1]} тоқсан</span>,
            })),
            { value: -1, label: 'Жылдық' },
          ]}
        />
        <select className="select" value={s.grade} onChange={(e) => set({ grade: Number(e.target.value), classId: 0 })} aria-label="Параллель">
          <option value={0}>Барлық параллель</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}-сыныптар
            </option>
          ))}
        </select>
        <select className="select" value={s.classId} onChange={(e) => set({ classId: Number(e.target.value) })} aria-label="Сынып">
          <option value={0}>Барлық сынып</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Spinner block />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d!.subjects.length ? (
        <Card>
          <Empty>Бұл кезеңде тоқсандық баға әлі қойылмаған. Журналда (Тоқсан) баға қойылған соң немесе BilimClass-тан импорттағаннан кейін талдау шығады.</Empty>
        </Card>
      ) : (
        <div className="stack">
          <div className="kpis">
            <DashboardCard label="Сапа" value={pct(d!.totals.quality)} tone="ok" sub="«5» + «4» үлесі" />
            <DashboardCard label="Үлгерім" value={pct(d!.totals.progress)} tone="warn" sub="«2»-сіз бағалар үлесі" />
            <DashboardCard label="Орташа баға" value={mark(d!.totals.avgMark)} sub={`${d!.subjects.length} пән`} />
            <DashboardCard label="СОУ" value={pct(d!.totals.sou)} sub="білім деңгейі" />
            <DashboardCard label="«2» саны" value={d!.totals.d2} tone={d!.totals.d2 ? 'bad' : undefined} sub={`«5» ${d!.totals.d5} · «4» ${d!.totals.d4} · «3» ${d!.totals.d3} · барлығы ${d!.totals.count}`} />
            <DashboardCard label="БЖБ / ТЖБ орташа" value={`${pct(d!.totals.bjbAvg, 0)} / ${pct(d!.totals.tjbAvg, 0)}`} sub={`қатысу ${pct(d!.totals.attendancePct)}`} />
          </div>
          <Card
            flush
            title="Пәндер кестесі"
            sub="Пәнді басып, сыныптар бойынша толық талдауды ашыңыз"
            action={
              <Segmented
                label="Сұрыптау"
                value={s.sort}
                onChange={(v) => set({ sort: v })}
                options={[
                  { value: 'name', label: 'Атауы' },
                  { value: 'quality', label: 'Сапа' },
                  { value: 'progress', label: 'Үлгерім' },
                ]}
              />
            }
          >
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Пән</th>
                    <th className="num">Сынып</th>
                    <th className="num">Баға</th>
                    <th className="num">«5»</th>
                    <th className="num">«4»</th>
                    <th className="num">«3»</th>
                    <th className="num">«2»</th>
                    <th className="num">Сапа</th>
                    <th className="num">Үлгерім</th>
                    <th className="num">Орт. баға</th>
                    <th className="num">СОУ</th>
                    <th className="num">БЖБ</th>
                    <th className="num">ТЖБ</th>
                    <th className="num">Қатысу</th>
                    <th>Сапа · I–IV</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.subjectId}
                      className={`clickable ${r.subjectId === s.subjectId ? 'selected' : ''}`}
                      tabIndex={0}
                      onClick={() => set({ subjectId: r.subjectId === s.subjectId ? 0 : r.subjectId })}
                      onKeyDown={(e) => e.key === 'Enter' && set({ subjectId: r.subjectId })}
                    >
                      <td style={{ fontWeight: 500 }}>{r.name}</td>
                      <td className="num">{r.classes}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{r.d5}</td>
                      <td className="num">{r.d4}</td>
                      <td className="num">{r.d3}</td>
                      <td className={`num ${r.d2 ? 'c-bad' : ''}`}>{r.d2}</td>
                      <td className="num" style={fill(qTone(r.quality))}>{pct(r.quality)}</td>
                      <td className="num" style={fill(pTone(r.progress))}>{pct(r.progress)}</td>
                      <td className="num">{mark(r.avgMark)}</td>
                      <td className="num">{pct(r.sou)}</td>
                      <td className="num">{pct(r.bjbAvg)}</td>
                      <td className="num">{pct(r.tjbAvg)}</td>
                      <td className="num">{pct(r.attendancePct)}</td>
                      <td className="mono muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                        {r.trend.map((t) => (t.quality == null ? '—' : Math.round(t.quality))).join(' · ')}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td>Барлығы</td>
                    <td className="num" />
                    <td className="num">{d!.totals.count}</td>
                    <td className="num">{d!.totals.d5}</td>
                    <td className="num">{d!.totals.d4}</td>
                    <td className="num">{d!.totals.d3}</td>
                    <td className="num">{d!.totals.d2}</td>
                    <td className="num">{pct(d!.totals.quality)}</td>
                    <td className="num">{pct(d!.totals.progress)}</td>
                    <td className="num">{mark(d!.totals.avgMark)}</td>
                    <td className="num">{pct(d!.totals.sou)}</td>
                    <td className="num">{pct(d!.totals.bjbAvg)}</td>
                    <td className="num">{pct(d!.totals.tjbAvg)}</td>
                    <td className="num">{pct(d!.totals.attendancePct)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          {s.subjectId > 0 && d!.detail && <Detail d={d!} onClose={() => set({ subjectId: 0 })} />}
          <Card title="Пәндер бойынша сапа мен үлгерім" sub={d!.periodLabel}>
            <Bars
              height={Math.max(220, rows.length * 30)}
              horizontal
              labels
              suffix="%"
              domain={[0, 100]}
              data={rows.map((r) => ({ name: r.name, quality: r.quality, progress: r.progress }))}
              x="name"
              series={[
                { key: 'quality', name: 'Сапа', color: 'ok' },
                { key: 'progress', name: 'Үлгерім', color: 'warn' },
              ]}
            />
            <Legend items={[{ name: 'Сапа', color: 'ok' }, { name: 'Үлгерім', color: 'warn' }]} />
          </Card>
          <p className="muted" style={{ fontSize: 12 }}>
            Сапа = («5» + «4») / барлық баға · Үлгерім = «2»-сіз бағалар / барлық баға · СОУ = (100·n5 + 64·n4 + 36·n3 + 16·n2) / N. Жылдық баға — оқушының қойылған тоқсандық бағаларының орташасы. 2–4 сыныптарда ТЖБ орнына аралық бағалау есептеледі; 1-сынып кірмейді.
          </p>
        </div>
      )}
    </div>
  );
}

function Detail({ d, onClose }: { d: Data; onClose: () => void }) {
  const det = d.detail!;
  const subj = d.subjects.find((x) => x.subjectId === det.subjectId);
  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0, fontSize: 18 }}>{det.name}</h2>
        <span className="muted">{d.periodLabel}</span>
        <span className="grow" />
        <button className="btn sm" onClick={onClose}>
          Жабу
        </button>
      </div>
      <div className="grid-2">
        <Card title="Тоқсандар динамикасы">
          {subj ? (
            <>
              <LineTrend
                height={220}
                data={subj.trend.map((t) => ({ label: t.label, quality: t.quality, progress: t.progress }))}
                x="label"
                series={[
                  { key: 'quality', name: 'Сапа', color: 'ok' },
                  { key: 'progress', name: 'Үлгерім', color: 'warn' },
                ]}
              />
              <Legend items={[{ name: 'Сапа', color: 'ok' }, { name: 'Үлгерім', color: 'warn' }]} />
            </>
          ) : (
            <Empty>Дерек жоқ</Empty>
          )}
        </Card>
        <Card flush title="Параллельдер бойынша">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Параллель</th>
                  <th className="num">Баға</th>
                  <th className="num">5/4/3/2</th>
                  <th className="num">Сапа</th>
                  <th className="num">Үлгерім</th>
                  <th className="num">Орт. баға</th>
                  <th className="num">ТЖБ</th>
                </tr>
              </thead>
              <tbody>
                {det.byGrade.map((g) => (
                  <tr key={g.grade}>
                    <td>{g.grade}-сынып</td>
                    <td className="num">{g.count}</td>
                    <td className="num">{`${g.d5}/${g.d4}/${g.d3}/${g.d2}`}</td>
                    <td className="num" style={fill(qTone(g.quality))}>{pct(g.quality)}</td>
                    <td className="num" style={fill(pTone(g.progress))}>{pct(g.progress)}</td>
                    <td className="num">{mark(g.avgMark)}</td>
                    <td className="num">{pct(g.tjbAvg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card flush title={`${det.name} · сыныптар бойынша`} sub={det.prevLabel ? `Δ — ${det.prevLabel}пен салыстырғанда сапаның өзгерісі` : undefined}>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Сынып</th>
                <th>Мұғалім</th>
                <th className="num">Баға</th>
                <th className="num">«5»</th>
                <th className="num">«4»</th>
                <th className="num">«3»</th>
                <th className="num">«2»</th>
                <th className="num">Сапа</th>
                {det.prevLabel && <th className="num">Δ</th>}
                <th className="num">Үлгерім</th>
                <th className="num">Орт. баға</th>
                <th className="num">СОУ</th>
                <th className="num">БЖБ</th>
                <th className="num">ТЖБ</th>
                <th className="num">Қатысу</th>
              </tr>
            </thead>
            <tbody>
              {det.byClass.map((r) => {
                const delta = r.quality != null && r.prevQuality != null ? Math.round((r.quality - r.prevQuality) * 10) / 10 : null;
                return (
                  <tr key={r.classId}>
                    <td style={{ fontWeight: 500 }}>{r.className}</td>
                    <td className="muted">{r.teacher ?? '—'}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{r.d5}</td>
                    <td className="num">{r.d4}</td>
                    <td className="num">{r.d3}</td>
                    <td className={`num ${r.d2 ? 'c-bad' : ''}`}>{r.d2}</td>
                    <td className="num" style={fill(qTone(r.quality))}>{pct(r.quality)}</td>
                    {det.prevLabel && <td className={`num ${delta == null ? '' : delta < 0 ? 'c-bad' : delta > 0 ? 'c-ok' : ''}`}>{delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}</td>}
                    <td className="num" style={fill(pTone(r.progress))}>{pct(r.progress)}</td>
                    <td className="num">{mark(r.avgMark)}</td>
                    <td className="num">{pct(r.sou)}</td>
                    <td className="num">{pct(r.bjbAvg)}</td>
                    <td className="num">{pct(r.tjbAvg)}</td>
                    <td className="num">{pct(r.attendancePct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card flush title={`«2» алған оқушылар · ${det.failing.length}`}>
        {det.failing.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Оқушы</th>
                  <th>Сынып</th>
                </tr>
              </thead>
              <tbody>
                {det.failing.map((r, i) => (
                  <tr key={`${r.studentId}-${r.className}`}>
                    <td className="mono muted">{i + 1}</td>
                    <td>
                      <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        {r.fullName}
                      </Link>
                    </td>
                    <td>{r.className}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Бұл пәннен «2» алған оқушы жоқ</Empty>
        )}
      </Card>
    </>
  );
}
