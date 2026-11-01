import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, download } from '../api/client';
import type { Level } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { levelColor, pct } from '../lib/format';
import { AssessmentDetail, AssessmentListItem, levelIndexOf, liveStats, round1, ScoreStats, TYPE_KK, usesInterim } from '../lib/assess';
import type { AssessmentType } from '../lib/assess';
import { useIsMobile, useUrlState } from '../hooks';
import { Badge, Card, ConfirmDialog, Empty, ErrorState, ExportMenu, Field, LevelBadge, Modal, Segmented, Spinner } from '../components/ui';

type Draft = { absent: boolean; score: string; criteria: string[] };

const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export default function Assessments({ type }: { type: AssessmentType }) {
  const { ref, quarterId, setQuarterId, year, subjectsOf, groupsOf } = useReference();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [s, set] = useUrlState({ classId: 0, subjectId: 0, groupId: 0, id: 0 });
  const classId = s.classId || ref.classes.find((c) => c.isHomeroom)?.id || ref.classes[0]?.id || 0;
  const subjects = subjectsOf(classId);
  const primary = usesInterim(ref.classes.find((c) => c.id === classId)?.grade);
  const subjectId = subjects.some((x) => x.id === s.subjectId) ? s.subjectId : (subjects[0]?.id ?? 0);
  const canWrite = can(PERM.ASSESS) && ref.classSubjects.some((x) => x.classId === classId && x.subjectId === subjectId);

  const groups = groupsOf(classId, subjectId);
  const groupId = groups.length ? (groups.some((g) => g.id === s.groupId) ? s.groupId : groups[0].id) : undefined;
  const listKey = { type, classId, subjectId, quarterId, groupId };
  const list = useQuery({ queryKey: ['assessments', listKey], queryFn: () => api.get<AssessmentListItem[]>('/assessments', listKey), enabled: !!classId && !!subjectId });
  const id = list.data?.some((a) => a.id === s.id) ? s.id : (list.data?.[list.data.length - 1]?.id ?? 0);
  const detail = useQuery({ queryKey: ['assessment', id], queryFn: () => api.get<AssessmentDetail>(`/assessments/${id}`), enabled: !!id });

  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const [del, setDel] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.del(`/assessments/${id}`),
    onSuccess: () => {
      toast(`${TYPE_KK[type]} жойылды`);
      setDel(false);
      set({ id: 0 });
      qc.invalidateQueries({ queryKey: ['assessments'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const exportFile = async (format: string) => {
    try {
      await download(`/assessments/${id}/export`, { format });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // 2–4 сынып таңдалса — аралық бағалау бетіне, 5+ сынып таңдалса — БЖБ бетіне ауысу.
  const mismatch = !!classId && primary !== (type === 'ARALYK');
  useEffect(() => {
    if (mismatch) nav(`/${primary ? 'aralyk' : 'bjb'}?classId=${classId}&subjectId=${subjectId}`, { replace: true });
  }, [mismatch, primary, classId, subjectId, nav]);

  const a = detail.data;
  const tjbTaken = type === 'TJB' && !!list.data?.some((x) => (x.groupId ?? undefined) === groupId);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Бағалау</h1>
        <Segmented
          value={type}
          label="Бағалау түрі"
          onChange={(v) => nav(`/${v.toLowerCase()}?classId=${classId}&subjectId=${subjectId}`)}
          options={
            primary
              ? [{ value: 'ARALYK', label: 'Аралық бағалау' }]
              : [
                  { value: 'BJB', label: 'БЖБ' },
                  { value: 'TJB', label: 'ТЖБ' },
                ]
          }
        />
        <span className="grow" />
        {a && type === 'TJB' && (
          <Link className="btn" to={`/tjb-analysis?classId=${classId}&subjectId=${subjectId}`}>
            ТЖБ талдауы
          </Link>
        )}
        {a && can(PERM.EXPORT) && <ExportMenu onExport={exportFile} />}
        {canWrite && (
          <button className="btn" onClick={() => setForm('new')} disabled={tjbTaken} title={tjbTaken ? 'Бір тоқсанға (топқа) бір ТЖБ' : undefined}>
            + {TYPE_KK[type]} құру
          </button>
        )}
      </div>

      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <Field label="Сынып">
          <select className="select" value={classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0, groupId: 0, id: 0 })}>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value), groupId: 0, id: 0 })}>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        {!!groups.length && (
          <Field label="Топ">
            <select className="select" value={groupId} onChange={(e) => set({ groupId: Number(e.target.value), id: 0 })}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Тоқсан">
          <select className="select" value={quarterId} onChange={(e) => (setQuarterId(Number(e.target.value)), set({ id: 0 }))}>
            {year.quarters.map((q) => (
              <option key={q.id} value={q.id}>
                {q.number}-тоқсан
              </option>
            ))}
          </select>
        </Field>
        {!!list.data?.length && (
          <Field label="Атауы">
            <select className="select" value={id} onChange={(e) => set({ id: Number(e.target.value) })}>
              {list.data.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                  {groups.length && !x.groupId ? ' · бүкіл сынып' : ''} {x.results ? `· ${pct(x.avgPct)}` : '· енгізілмеген'}
                </option>
              ))}
            </select>
          </Field>
        )}
        {a && (
          <Field label="Макс. балл">
            <input className="input mono" value={a.maxScore} readOnly style={{ width: 80 }} aria-readonly />
          </Field>
        )}
        {a && canWrite && (
          <div className="row" style={{ paddingBottom: 2 }}>
            <button className="btn ghost" onClick={() => setForm('edit')}>
              Өңдеу
            </button>
            <button className="btn ghost c-bad" onClick={() => setDel(true)}>
              Жою
            </button>
          </div>
        )}
      </div>

      {!subjects.length ? (
        <Empty>Бұл сыныпта сізге бекітілген пән жоқ.</Empty>
      ) : list.isLoading || (id && detail.isLoading) ? (
        <Spinner block />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <Card>
          <Empty>
            <div style={{ marginBottom: 10 }}>Бұл тоқсанда {TYPE_KK[type]} әлі құрылмаған.</div>
            {canWrite && (
              <button className="btn primary" onClick={() => setForm('new')}>
                + {TYPE_KK[type]} құру
              </button>
            )}
          </Empty>
        </Card>
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      ) : a ? (
        <Editor key={`${a.id}`} a={a} canWrite={canWrite} isMobile={isMobile} />
      ) : null}

      {form && (
        <AssessmentForm
          type={type}
          initial={form === 'edit' ? a ?? null : null}
          classId={classId}
          subjectId={subjectId}
          quarterId={quarterId}
          groupId={groupId}
          locked={form === 'edit' && !!a?.entered}
          onClose={() => setForm(null)}
          onSaved={(x) => {
            setForm(null);
            set({ id: x.id });
            qc.invalidateQueries({ queryKey: ['assessments'] });
            qc.setQueryData(['assessment', x.id], x);
          }}
        />
      )}
      <ConfirmDialog
        open={del}
        danger
        title={`${TYPE_KK[type]} жою`}
        text={
          <>
            «{a?.title}» және оған енгізілген <b>{a?.entered ?? 0}</b> оқушы нәтижесі жойылады. Бұл әрекет аудит журналына жазылады.
          </>
        }
        confirmLabel="Жою"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDel(false)}
      />
    </div>
  );
}

/** Нәтиже енгізу: критерийлер бойынша (немесе жалпы балл), жедел %/деңгей/статистика. */
function Editor({ a, canWrite, isMobile }: { a: AssessmentDetail; canWrite: boolean; isMobile: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const hasCrit = a.criteria.length > 0;
  const init = () =>
    Object.fromEntries(
      a.rows.map((r) => [
        r.studentId,
        {
          absent: r.absent,
          score: r.entered && !r.absent && r.score != null ? String(r.score) : '',
          criteria: a.criteria.map((_, j) => (r.entered && !r.absent && r.criteria[j] != null ? String(r.criteria[j]) : '')),
        } as Draft,
      ]),
    );
  const [draft, setDraft] = useState<Record<number, Draft>>(init);
  const [dirty, setDirty] = useState(false);
  const [bad, setBad] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  const levels = a.levels;
  const computed = useMemo(
    () =>
      a.rows.map((r) => {
        const d = draft[r.studentId];
        if (!d || d.absent) return { score: null as number | null, pct: null as number | null, li: null as number | null, complete: !!d?.absent, empty: !d };
        let score: number | null;
        let filled: number;
        if (hasCrit) {
          const vals = d.criteria.map(toNum);
          filled = vals.filter((v) => v != null).length;
          score = filled === a.criteria.length ? round1(vals.reduce<number>((s, v) => s + (v ?? 0), 0)) : null;
        } else {
          score = toNum(d.score);
          filled = score == null ? 0 : 1;
        }
        const p = score != null ? round1((score / a.maxScore) * 100) : null;
        return { score, pct: p, li: p != null ? levelIndexOf(p, levels) : null, complete: score != null, empty: filled === 0 };
      }),
    [draft, a, hasCrit, levels],
  );
  const stats: ScoreStats = useMemo(() => (dirty ? liveStats(computed.filter((c) => c.score != null).map((c) => ({ score: c.score!, pct: c.pct! })), levels) : a.stats), [dirty, computed, levels, a.stats]);
  const critLive = useMemo(
    () =>
      a.criteria.map((c, j) => {
        const vals = a.rows.map((r) => draft[r.studentId]).filter((d) => d && !d.absent).map((d) => toNum(d.criteria[j])).filter((v): v is number => v != null);
        const p = vals.length ? Math.round(vals.reduce((s, v) => s + (v / c.maxScore) * 100, 0) / vals.length) : 0;
        const srv = a.criteriaAnalysis.find((x) => x.code === c.code);
        return { ...c, avgPct: dirty ? p : (srv?.avgPct ?? p), below50: srv?.below50 ?? 0, verdict: dirty ? null : (srv?.verdict ?? null) };
      }),
    [a, draft, dirty],
  );

  const setVal = (sid: number, patch: Partial<Draft>) => {
    setDraft((x) => ({ ...x, [sid]: { ...x[sid], ...patch } }));
    setDirty(true);
    setBad((b) => {
      if (!b.has(sid)) return b;
      const n = new Set(b);
      n.delete(sid);
      return n;
    });
  };
  const clampStr = (v: string, max: number) => {
    const clean = v.replace(',', '.').replace(/[^0-9.]/g, '');
    if (clean === '') return '';
    const n = Number(clean);
    if (Number.isNaN(n)) return '';
    return n > max ? String(max) : clean;
  };

  const save = useMutation({
    mutationFn: (results: unknown[]) => api.put<AssessmentDetail>(`/assessments/${a.id}/results`, { results }),
    onSuccess: (x) => {
      qc.setQueryData(['assessment', a.id], x);
      qc.invalidateQueries({ queryKey: ['assessments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setDirty(false);
      toast(`Нәтиже сақталды · ${x.entered} оқушы`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });

  const submit = () => {
    const wrong = new Set<number>();
    const results: unknown[] = [];
    a.rows.forEach((r, i) => {
      const d = draft[r.studentId];
      const c = computed[i];
      if (d.absent) results.push({ studentId: r.studentId, absent: true });
      else if (c.complete) {
        results.push(hasCrit ? { studentId: r.studentId, criteria: a.criteria.map((cr, j) => ({ criterionId: cr.id, score: toNum(d.criteria[j]) })) } : { studentId: r.studentId, score: c.score });
      } else if (!c.empty || r.entered) wrong.add(r.studentId);
    });
    setBad(wrong);
    if (wrong.size) {
      toast(`${wrong.size} оқушының балы толық емес: барлық критерийді толтырыңыз немесе «жоқ» белгілеңіз`, 'error');
      return;
    }
    if (!results.length) {
      toast('Енгізілген нәтиже жоқ', 'error');
      return;
    }
    save.mutate(results);
  };

  // Enter/↓ — келесі оқушының сол бағанына, ↑ — алдыңғысына.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const row = Number(el.dataset.row);
    const col = el.dataset.col;
    let next: number | null = null;
    if (e.key === 'Enter' || e.key === 'ArrowDown') next = row + 1;
    if (e.key === 'ArrowUp') next = row - 1;
    if (next == null) return;
    e.preventDefault();
    const t = document.querySelector<HTMLInputElement>(`input[data-row="${next}"][data-col="${col}"]`);
    if (t) {
      t.focus();
      t.select();
    }
  };

  const enteredCount = computed.filter((c) => c.complete).length;
  const panel = <StatsPanel a={a} stats={stats} levels={levels} crit={critLive} dirty={dirty} />;

  if (isMobile) {
    const r = a.rows[cursor];
    const d = r ? draft[r.studentId] : null;
    const c = computed[cursor];
    const step = (j: number | null, delta: number) => {
      if (!d) return;
      if (j == null) {
        const v = Math.min(a.maxScore, Math.max(0, (toNum(d.score) ?? 0) + delta));
        setVal(r.studentId, { score: String(v), absent: false });
      } else {
        const max = a.criteria[j].maxScore;
        const v = Math.min(max, Math.max(0, (toNum(d.criteria[j]) ?? 0) + delta));
        const arr = [...d.criteria];
        arr[j] = String(v);
        setVal(r.studentId, { criteria: arr, absent: false });
      }
    };
    return (
      <div className="m-pad">
        {r && d ? (
          <Card>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted mono">
                {cursor + 1} / {a.rows.length}
              </span>
              <span className="muted">
                енгізілді: <b className="mono">{enteredCount}</b>
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{r.fullName}</div>
            <div className="row" style={{ margin: '6px 0 12px' }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                {d.absent ? 'жоқ' : c.score != null ? `${c.score} / ${a.maxScore}` : '—'}
              </span>
              {c.pct != null && <span className="mono muted">{pct(c.pct)}</span>}
              {c.li != null && <LevelBadge name={levels[c.li].name} index={c.li} levels={levels} />}
              {bad.has(r.studentId) && <Badge tone="bad">толық емес</Badge>}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {hasCrit ? (
                a.criteria.map((cr, j) => (
                  <div key={cr.id}>
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
                      <b>{cr.code}</b> {cr.topic} · макс {cr.maxScore}
                    </div>
                    <div className="stepper">
                      <button type="button" onClick={() => step(j, -1)} disabled={!canWrite || d.absent} aria-label={`${cr.code} азайту`}>
                        −
                      </button>
                      <span className="v">{d.criteria[j] || '—'}</span>
                      <button type="button" onClick={() => step(j, 1)} disabled={!canWrite || d.absent} aria-label={`${cr.code} көбейту`}>
                        +
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="stepper">
                  <button type="button" onClick={() => step(null, -1)} disabled={!canWrite || d.absent} aria-label="Азайту">
                    −
                  </button>
                  <input className="input mono" inputMode="decimal" style={{ textAlign: 'center', height: 44, fontSize: 18 }} value={d.score} disabled={!canWrite || d.absent} onChange={(e) => setVal(r.studentId, { score: clampStr(e.target.value, a.maxScore) })} aria-label="Балл" />
                  <button type="button" onClick={() => step(null, 1)} disabled={!canWrite || d.absent} aria-label="Көбейту">
                    +
                  </button>
                </div>
              )}
              <label className="row">
                <input type="checkbox" checked={d.absent} disabled={!canWrite} onChange={(e) => setVal(r.studentId, { absent: e.target.checked })} /> Жұмысқа қатыспады
              </label>
            </div>
          </Card>
        ) : (
          <Empty>Сыныпта оқушы жоқ</Empty>
        )}
        <div style={{ marginTop: 14 }}>{panel}</div>
        <div className="sticky-actions" style={{ gridTemplateColumns: '1fr 1.3fr 1fr' }}>
          <button className="btn" style={{ height: 44 }} onClick={() => setCursor((x) => Math.max(0, x - 1))} disabled={cursor === 0}>
            ← Алдыңғы
          </button>
          <button className="btn primary" style={{ height: 44 }} onClick={submit} disabled={!canWrite || save.isPending || !dirty}>
            {save.isPending ? <Spinner /> : 'Сақтау'}
          </button>
          <button className="btn" style={{ height: 44 }} onClick={() => setCursor((x) => Math.min(a.rows.length - 1, x + 1))} disabled={cursor >= a.rows.length - 1}>
            Келесі →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="side-layout">
      <div className="stack">
        <div className="card flush">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>№</th>
                  <th>Оқушы</th>
                  {a.criteria.map((c) => (
                    <th key={c.id} className="center" title={c.topic} style={{ width: 70 }}>
                      {c.code}
                      <div className="muted mono" style={{ fontWeight: 400, fontSize: 11 }}>
                        /{c.maxScore}
                      </div>
                    </th>
                  ))}
                  <th className="num" style={{ width: hasCrit ? 70 : 100 }}>
                    Балл
                  </th>
                  <th className="num" style={{ width: 70 }}>
                    %
                  </th>
                  <th style={{ width: 100 }}>Деңгей</th>
                  <th className="center" style={{ width: 56 }} title="Жұмысқа қатыспады">
                    Жоқ
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r, i) => {
                  const d = draft[r.studentId];
                  const c = computed[i];
                  return (
                    <tr key={r.studentId} style={bad.has(r.studentId) ? { background: 'var(--bads)' } : undefined}>
                      <td className="mono muted">{i + 1}</td>
                      <td>
                        <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                          {r.fullName}
                        </Link>
                      </td>
                      {hasCrit ? (
                        a.criteria.map((cr, j) => (
                          <td key={cr.id} className="center">
                            <input
                              className="input mono"
                              style={{ width: 54, height: 30, textAlign: 'center', padding: '0 4px' }}
                              inputMode="decimal"
                              value={d.criteria[j]}
                              disabled={!canWrite || d.absent}
                              data-row={i}
                              data-col={j}
                              onKeyDown={onKey}
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) => {
                                const arr = [...d.criteria];
                                arr[j] = clampStr(e.target.value, cr.maxScore);
                                setVal(r.studentId, { criteria: arr });
                              }}
                              aria-label={`${r.fullName}, ${cr.code}`}
                            />
                          </td>
                        ))
                      ) : null}
                      <td className="num">
                        {hasCrit ? (
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {d.absent ? '—' : (c.score ?? '—')}
                          </span>
                        ) : (
                          <input
                            className="input mono"
                            style={{ width: 70, height: 30, textAlign: 'right' }}
                            inputMode="decimal"
                            value={d.score}
                            disabled={!canWrite || d.absent}
                            data-row={i}
                            data-col="s"
                            onKeyDown={onKey}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setVal(r.studentId, { score: clampStr(e.target.value, a.maxScore) })}
                            aria-label={`${r.fullName}, балл`}
                          />
                        )}
                      </td>
                      <td className="num mono">{d.absent ? '—' : pct(c.pct)}</td>
                      <td>{d.absent ? <span className="muted">қатыспады</span> : <LevelBadge name={c.li != null ? levels[c.li].name : null} index={c.li} levels={levels} />}</td>
                      <td className="center">
                        <input type="checkbox" checked={d.absent} disabled={!canWrite} onChange={(e) => setVal(r.studentId, { absent: e.target.checked })} aria-label={`${r.fullName}: қатыспады`} />
                      </td>
                    </tr>
                  );
                })}
                {!a.rows.length && (
                  <tr>
                    <td colSpan={6 + a.criteria.length}>
                      <Empty>Сыныпта белсенді оқушы жоқ</Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="muted">
              Енгізілді: <b className="mono">{enteredCount}</b> / {a.rows.length}
              {dirty && <span className="c-warn"> · сақталмаған өзгерістер бар</span>}
            </span>
            {canWrite && (
              <div className="row">
                {dirty && (
                  <button
                    className="btn"
                    onClick={() => {
                      setDraft(init());
                      setDirty(false);
                      setBad(new Set());
                    }}
                  >
                    Болдырмау
                  </button>
                )}
                <button className="btn primary" onClick={submit} disabled={save.isPending || !dirty}>
                  {save.isPending && <Spinner />} Нәтижені сақтау
                </button>
              </div>
            )}
          </div>
        </div>
        {hasCrit && (
          <div className="muted" style={{ fontSize: 12 }}>
            {a.criteria.map((c) => `${c.code} — ${c.topic}`).join(' · ')} · Enter / ↓ — келесі оқушы
          </div>
        )}
      </div>
      {panel}
    </div>
  );
}

export function LevelDistribution({ levels, distribution }: { levels: Level[]; distribution: number[] }) {
  const total = distribution.reduce((s, x) => s + x, 0);
  return (
    <div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--soft)', margin: '12px 0 8px' }}>
        {total > 0 &&
          levels.map((l, i) =>
            distribution[i] ? <span key={l.name} title={`${l.name}: ${distribution[i]}`} style={{ flex: distribution[i], background: `var(--${levelColor(i, levels.length)})` }} /> : null,
          )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', fontSize: 12.5 }}>
        {levels.map((l, i) => (
          <div key={l.name} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <span className="sq" style={{ background: `var(--${levelColor(i, levels.length)})` }} />
              {l.name}{' '}
              <span className="muted">
                {l.fromPct}–{l.toPct}%
              </span>
            </span>
            <b className="mono">{distribution[i] ?? 0}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsPanel({ a, stats, levels, crit, dirty }: { a: AssessmentDetail; stats: ScoreStats; levels: Level[]; crit: { code: string; topic: string; avgPct: number; verdict: string | null }[]; dirty: boolean }) {
  return (
    <div className="stack">
      <Card title="Автоматты есеп" sub={dirty ? 'Сақталмаған мәндер бойынша' : undefined}>
        <div className="mini-kpis">
          <div className="mini-kpi">
            <div className="l">Орташа балл</div>
            <div className="v">
              {stats.count ? stats.avgScore : '—'} / {a.maxScore}
            </div>
          </div>
          <div className="mini-kpi">
            <div className="l">Орташа пайыз</div>
            <div className="v">{stats.count ? pct(stats.avgPct) : '—'}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">Сапа</div>
            <div className="v">{stats.count ? `${stats.quality}%` : '—'}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">Үлгерім</div>
            <div className="v">{stats.count ? `${stats.progress}%` : '—'}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">Жоғары нәтиже</div>
            <div className="v">{stats.count ? pct(stats.maxPct) : '—'}</div>
          </div>
          <div className="mini-kpi">
            <div className="l">Төмен нәтиже</div>
            <div className="v">{stats.count ? pct(stats.minPct) : '—'}</div>
          </div>
        </div>
        <LevelDistribution levels={levels} distribution={stats.distribution} />
      </Card>
      {crit.length > 0 && (
        <Card title="Критерийлер бойынша талдау">
          <div className="stack" style={{ gap: 10 }}>
            {crit.map((c) => (
              <div key={c.code}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', fontSize: 12.5, marginBottom: 4 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{c.code}</b> <span className="muted">{c.topic}</span>
                  </span>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    {c.verdict === 'weak' && <Badge tone="bad">Әлсіз</Badge>}
                    {c.verdict === 'strong' && <Badge tone="ok">Күшті</Badge>}
                    <b className="mono">{c.avgPct}%</b>
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${c.avgPct}%`, background: `var(--${c.verdict === 'weak' ? 'bad' : c.verdict === 'strong' ? 'ok' : 'acc'})` }} />
                </div>
              </div>
            ))}
            {!dirty && a.insight.length > 0 && <div className="insight">{a.insight.join(' ')}</div>}
          </div>
        </Card>
      )}
      {!crit.length && !dirty && a.insight.length > 0 && <div className="insight">{a.insight.join(' ')}</div>}
    </div>
  );
}

/** БЖБ/ТЖБ құру және өңдеу. Критерийлер болса, максималды балл олардың қосындысы ретінде автоматты есептеледі. */
function AssessmentForm({
  type,
  initial,
  classId,
  subjectId,
  quarterId,
  groupId,
  locked,
  onClose,
  onSaved,
}: {
  type: AssessmentType;
  initial: AssessmentDetail | null;
  classId: number;
  subjectId: number;
  quarterId: number;
  groupId?: number;
  locked: boolean;
  onClose: () => void;
  onSaved: (a: AssessmentDetail) => void;
}) {
  const { quarter, subjectName, ref } = useReference();
  const toast = useToast();
  const [title, setTitle] = useState(initial?.title ?? (type === 'TJB' ? `ТЖБ · ${quarter.number}-тоқсан · ${subjectName(subjectId)}` : type === 'ARALYK' ? `Аралық бағалау · ${quarter.number}-тоқсан · ${subjectName(subjectId)}` : ''));
  const [section, setSection] = useState(initial?.section ?? '');
  const [date, setDate] = useState(initial?.date ?? ref.today);
  const [max, setMax] = useState(String(initial?.maxScore ?? (type === 'TJB' ? 30 : 20)));
  const [crit, setCrit] = useState<{ code: string; topic: string; maxScore: string }[]>(
    initial ? initial.criteria.map((c) => ({ code: c.code, topic: c.topic, maxScore: String(c.maxScore) })) : type === 'TJB' ? [1, 2, 3].map((n) => ({ code: `К${n}`, topic: '', maxScore: '' })) : [],
  );
  const [err, setErr] = useState<string | null>(null);
  const critSum = crit.reduce((s, c) => s + (Number(c.maxScore) || 0), 0);
  const maxScore = crit.length ? critSum : Number(max);

  const save = useMutation({
    mutationFn: (body: unknown) => (initial ? api.put<AssessmentDetail>(`/assessments/${initial.id}`, body) : api.post<AssessmentDetail>('/assessments', body)),
    onSuccess: (x) => {
      toast(initial ? 'Өзгерістер сақталды' : `${TYPE_KK[type]} құрылды`);
      onSaved(x);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Қате'),
  });
  const submit = () => {
    setErr(null);
    if (title.trim().length < 2) return setErr('Атауын енгізіңіз');
    if (!maxScore || maxScore < 1 || maxScore > 200) return setErr('Максималды балл 1–200 аралығында болуы керек');
    for (const c of crit) {
      if (!c.code.trim() || !c.topic.trim()) return setErr('Әр критерийдің коды мен тақырыбын толтырыңыз');
      if (!(Number(c.maxScore) >= 0.5)) return setErr(`${c.code}: балл кемінде 0.5 болуы керек`);
    }
    if (new Set(crit.map((c) => c.code.trim())).size !== crit.length) return setErr('Критерий кодтары қайталанбауы керек');
    save.mutate({
      type,
      classId,
      subjectId,
      quarterId,
      groupId,
      title: title.trim(),
      section: section.trim() || null,
      date: date || null,
      maxScore,
      criteria: crit.map((c) => ({ code: c.code.trim(), topic: c.topic.trim(), maxScore: Number(c.maxScore) })),
    });
  };

  return (
    <Modal
      open
      size="lg"
      title={initial ? `${TYPE_KK[type]} өңдеу` : `${TYPE_KK[type]} құру`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Spinner />} Сақтау
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Атауы" className="full">
          <input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'BJB' ? 'мыс. БЖБ №1 · Квадрат теңдеулер' : ''} />
        </Field>
        <Field label="Бөлім / тарау">
          <input className="input" value={section} maxLength={160} onChange={(e) => setSection(e.target.value)} />
        </Field>
        <Field label="Өткізілген күні">
          <input className="input" type="date" value={date ?? ''} min={quarter.startDate} max={quarter.endDate} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Максималды балл" hint={crit.length ? 'Критерийлер қосындысынан есептеледі' : undefined}>
          <input className="input mono" inputMode="decimal" value={crit.length ? String(critSum) : max} disabled={!!crit.length || locked} onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <b style={{ fontWeight: 600 }}>Критерийлер</b>
          {!locked && crit.length < 12 && (
            <button className="btn sm" onClick={() => setCrit((x) => [...x, { code: `К${x.length + 1}`, topic: '', maxScore: '' }])}>
              + Критерий
            </button>
          )}
        </div>
        {locked && <div className="insight" style={{ marginBottom: 8 }}>Нәтижелер енгізілген: тек атаулар мен тақырыптарды өзгертуге болады.</div>}
        {!crit.length && <div className="muted">Критерийсіз — тек жалпы балл енгізіледі.</div>}
        <div className="stack" style={{ gap: 6 }}>
          {crit.map((c, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input mono" style={{ width: 64 }} value={c.code} maxLength={10} aria-label="Код" onChange={(e) => setCrit((x) => x.map((y, j) => (j === i ? { ...y, code: e.target.value } : y)))} />
              <input className="input" style={{ flex: 1 }} value={c.topic} maxLength={160} placeholder="Тақырып / дескриптор" aria-label="Тақырып" onChange={(e) => setCrit((x) => x.map((y, j) => (j === i ? { ...y, topic: e.target.value } : y)))} />
              <input className="input mono" style={{ width: 72 }} inputMode="decimal" value={c.maxScore} placeholder="балл" disabled={locked} aria-label="Макс. балл" onChange={(e) => setCrit((x) => x.map((y, j) => (j === i ? { ...y, maxScore: e.target.value.replace(/[^0-9.]/g, '') } : y)))} />
              {!locked && (
                <button className="btn ghost icon" aria-label="Критерийді жою" onClick={() => setCrit((x) => x.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {err && (
        <div className="err-box" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}
