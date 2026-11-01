import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, download } from '../api/client';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { levelColor, pct } from '../lib/format';
import { AssessmentDetail, AssessmentListItem } from '../lib/assess';
import { useUrlState } from '../hooks';
import { DataTable, Col } from '../components/DataTable';
import { Badge, Card, DashboardCard, Empty, ErrorState, ExportMenu, Field, LevelBadge, Segmented, Spinner } from '../components/ui';
import { Bars } from '../components/charts';
import { LevelDistribution } from './Assessments';

type Row = AssessmentDetail['rows'][number] & { no: number };

export default function TjbAnalysis() {
  const { ref, quarterId, setQuarterId, year, subjectsOf } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const [s, set] = useUrlState({ classId: 0, subjectId: 0, quarterId: 0, id: 0 });
  // Хабарламадан келген сілтемедегі тоқсанды қолдану.
  useEffect(() => {
    if (!s.quarterId) return;
    if (s.quarterId !== quarterId && ref.years.some((y) => y.quarters.some((q) => q.id === s.quarterId))) setQuarterId(s.quarterId);
    set({ quarterId: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.quarterId]);
  const overview = useQuery({ queryKey: ['assessments', { type: 'TJB', quarterId }], queryFn: () => api.get<AssessmentListItem[]>('/assessments', { type: 'TJB', quarterId }) });
  // URL-да таңдау жоқ болса: алдымен өз сыныбымның нәтижесі бар ТЖБ, әйтпесе нәтижесі бар кез келген ТЖБ.
  const withResults = (overview.data ?? []).filter((a) => a.results > 0);
  const homeIds = new Set(ref.classes.filter((c) => c.isHomeroom).map((c) => c.id));
  const fallback = withResults.find((a) => homeIds.has(a.classId)) ?? withResults[0];
  const classId = s.classId || fallback?.classId || ref.classes.find((c) => c.isHomeroom)?.id || ref.classes[0]?.id || 0;
  const subjects = subjectsOf(classId);
  const wantSubject = s.subjectId || (!s.classId && fallback ? fallback.subjectId : 0);
  const subjectId = subjects.some((x) => x.id === wantSubject) ? wantSubject : (subjects[0]?.id ?? 0);
  const [view, setView] = useState<'all' | 'low'>('all');

  // Пән топтарға бөлінсе, әр топтың өз ТЖБ-сы болады.
  const tjbs = (overview.data ?? []).filter((a) => a.classId === classId && a.subjectId === subjectId);
  const tjb = tjbs.find((a) => a.id === s.id) ?? tjbs[0];
  const detail = useQuery({ queryKey: ['assessment', tjb?.id], queryFn: () => api.get<AssessmentDetail>(`/assessments/${tjb!.id}`), enabled: !!tjb });
  const a = detail.data;

  const rows: Row[] = useMemo(() => {
    const r = (a?.rows ?? []).filter((x) => x.entered).map((x, i) => ({ ...x, no: i + 1 }));
    return view === 'low' ? r.filter((x) => x.levelIndex === 0 || x.absent) : r;
  }, [a, view]);

  const columns = useMemo<Col<Row>[]>(
    () => [
      { id: 'no', header: '№', accessorKey: 'no', enableHiding: false, size: 44, cell: (c) => <span className="mono muted">{c.getValue() as number}</span> },
      {
        id: 'name',
        header: 'Оқушы',
        accessorKey: 'fullName',
        enableHiding: false,
        cell: ({ row: { original: r } }) => (
          <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
            {r.fullName}
          </Link>
        ),
      },
      ...(a?.criteria ?? []).map(
        (c, j) =>
          ({
            id: `c${j}`,
            header: c.code,
            accessorFn: (r: Row) => r.criteria[j],
            meta: { align: 'num', label: `${c.code} · ${c.topic}` },
            cell: ({ row: { original: r } }: { row: { original: Row } }) => {
              const v = r.criteria[j];
              if (r.absent || v == null) return <span className="muted">—</span>;
              return <span className={`mono ${(v / c.maxScore) * 100 < 50 ? 'c-bad' : ''}`}>{v}</span>;
            },
          }) as Col<Row>,
      ),
      { id: 'score', header: 'Балл', accessorFn: (r) => (r.absent ? -1 : r.score), meta: { align: 'num', label: 'Балл' }, cell: ({ row: { original: r } }) => <span className="mono">{r.absent ? '—' : `${r.score} / ${a?.maxScore}`}</span> },
      { id: 'pct', header: '%', accessorFn: (r) => (r.absent ? -1 : r.pct), meta: { align: 'num', label: '%' }, cell: ({ row: { original: r } }) => <span className="mono">{r.absent ? '—' : pct(r.pct)}</span> },
      { id: 'level', header: 'Деңгей', accessorFn: (r) => r.levelIndex ?? -1, meta: { label: 'Деңгей' }, cell: ({ row: { original: r } }) => <LevelBadge name={r.level} index={r.levelIndex} levels={a?.levels} /> },
      {
        id: 'result',
        header: 'Нәтиже',
        accessorFn: (r) => (r.absent ? -1 : (r.levelIndex ?? 0)),
        meta: { label: 'Нәтиже' },
        cell: ({ row: { original: r } }) => (r.absent ? <Badge>Қатыспады</Badge> : (r.levelIndex ?? 0) > 0 ? <span className="c-ok">Меңгерді</span> : <span className="c-bad" style={{ fontWeight: 600 }}>Меңгермеді</span>),
      },
    ],
    [a],
  );

  const exportFile = async (format: string) => {
    try {
      await download(`/assessments/${tjb!.id}/export`, { format });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const st = a?.stats;
  const byClass = useMemo(() => {
    const list = (overview.data ?? []).filter((x) => x.results > 0);
    return [...list].sort((x, y) => x.avgPct - y.avgPct);
  }, [overview.data]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">ТЖБ талдауы</h1>
        <span className="page-sub">{a ? `${a.className} · ${a.subject} · ${a.quarter}-тоқсан` : ''}</span>
        <span className="grow" />
        {tjb && (
          <Link className="btn" to={`/tjb?classId=${classId}&subjectId=${subjectId}`}>
            Нәтижені өңдеу
          </Link>
        )}
        {a && can(PERM.EXPORT) && <ExportMenu onExport={exportFile} />}
      </div>
      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <Field label="Сынып">
          <select className="select" value={classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0, id: 0 })}>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value), id: 0 })}>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        {tjbs.length > 1 && (
          <Field label="Топ">
            <select className="select" value={tjb?.id} onChange={(e) => set({ id: Number(e.target.value) })}>
              {tjbs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.groupName ?? 'Бүкіл сынып'}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Тоқсан">
          <select className="select" value={quarterId} onChange={(e) => setQuarterId(Number(e.target.value))}>
            {year.quarters.map((q) => (
              <option key={q.id} value={q.id}>
                {q.number}-тоқсан
              </option>
            ))}
          </select>
        </Field>
      </div>

      {overview.isLoading || detail.isLoading ? (
        <Spinner block />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !tjb ? (
        <Card>
          <Empty>
            <div style={{ marginBottom: 10 }}>Бұл сынып пен пәнге {year.quarters.find((q) => q.id === quarterId)?.number}-тоқсанда ТЖБ құрылмаған.</div>
            <Link className="btn primary" to={`/tjb?classId=${classId}&subjectId=${subjectId}`}>
              ТЖБ бетіне өту
            </Link>
          </Empty>
        </Card>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      ) : a && st ? (
        !a.entered ? (
          <Card>
            <Empty>
              <div style={{ marginBottom: 10 }}>«{a.title}» бойынша нәтиже әлі енгізілмеген.</div>
              <Link className="btn primary" to={`/tjb?classId=${classId}&subjectId=${subjectId}`}>
                Нәтиже енгізу
              </Link>
            </Empty>
          </Card>
        ) : (
          <div className="stack">
            <div className="kpis k4">
              <DashboardCard label="Орташа пайыз" value={pct(st.avgPct)} tone="acc" sub={`орташа балл ${st.avgScore} / ${a.maxScore}`} />
              <DashboardCard label="Сапа" value={`${st.quality}%`} tone="ok" sub="жоғары екі деңгей" />
              <DashboardCard label="Үлгерім" value={`${st.progress}%`} tone="vio" sub="ең төменгі деңгейден жоғары" />
              <DashboardCard label="Жазды" value={`${st.count} / ${a.rows.length}`} sub={`ең жоғары ${pct(st.maxPct)} · ең төмен ${pct(st.minPct)}`} />
            </div>
            <div className="side-layout">
              <DataTable
                id="tjb-analysis"
                columns={columns}
                data={rows}
                hideFooter
                pageSize={500}
                rowClassName={(r) => (r.levelIndex === 0 && !r.absent ? 'row-bad' : '')}
                toolbar={
                  <Segmented
                    value={view}
                    onChange={setView}
                    label="Көрініс"
                    options={[
                      { value: 'all', label: `Барлығы · ${a.entered}` },
                      { value: 'low', label: `Меңгермегендер · ${st.distribution[0] ?? 0}` },
                    ]}
                  />
                }
              />
              <div className="stack">
                <Card title="Деңгейлер бойынша">
                  <LevelDistribution levels={a.levels} distribution={st.distribution} />
                </Card>
                {a.insight.length > 0 && (
                  <Card title="Қорытынды">
                    <div className="insight">{a.insight.join(' ')}</div>
                  </Card>
                )}
              </div>
            </div>
            {a.criteriaAnalysis.length > 0 && (
              <div className="grid-2">
                <Card title="Критерийлер бойынша талдау" sub="Әлсіз/күшті критерийлер мектептің деңгей шкаласы бойынша анықталады">
                  <Bars
                    height={Math.max(160, a.criteriaAnalysis.length * 42)}
                    horizontal
                    labels
                    suffix="%"
                    domain={[0, 100]}
                    data={a.criteriaAnalysis.map((c) => ({ name: `${c.code} ${c.topic}`, v: c.avgPct }))}
                    x="name"
                    series={[{ key: 'v', name: 'Орташа %', color: 'acc' }]}
                  />
                </Card>
                <Card title="Критерий бойынша қиналған оқушылар">
                  <div className="stack" style={{ gap: 10 }}>
                    {a.criteriaAnalysis.map((c) => (
                      <div key={c.code}>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span>
                            <b>{c.code}</b> <span className="muted">{c.topic}</span>
                          </span>
                          <span className="row" style={{ gap: 6 }}>
                            {c.verdict === 'weak' && <Badge tone="bad">Әлсіз</Badge>}
                            {c.verdict === 'strong' && <Badge tone="ok">Күшті</Badge>}
                            <span className="mono">{c.avgPct}%</span>
                          </span>
                        </div>
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                          {c.struggling.length ? `50%-дан төмен (${c.below50}): ${c.struggling.join(', ')}` : 'Барлық оқушы 50%-дан жоғары алды'}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        )
      ) : null}

      {byClass.length > 0 && (
        <Card title="Барлық ТЖБ · тоқсан бойынша" sub="Төменнен жоғарыға сұрыпталған; басқанда сол ТЖБ ашылады" className="mt">
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            {byClass.map((x) => {
              const li = ref.levels.length ? ref.levels.findIndex((l) => Math.round(x.avgPct) >= l.fromPct && Math.round(x.avgPct) <= l.toPct) : -1;
              return (
                <button
                  key={x.id}
                  className="bar-row"
                  style={{ background: x.classId === classId && x.subjectId === subjectId ? 'var(--accs)' : 'none', border: 0, borderRadius: 6, padding: '4px 6px', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => set({ classId: x.classId, subjectId: x.subjectId, id: x.id })}
                >
                  <span>
                    {x.className} · {x.subject}
                  </span>
                  <div className="bar">
                    <span style={{ width: `${x.avgPct}%`, background: `var(--${levelColor(li < 0 ? null : li, ref.levels.length) || 'acc'})` }} />
                  </div>
                  <span className="v">{pct(x.avgPct)}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
