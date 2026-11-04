import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, download } from '../api/client';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot, pct } from '../lib/format';
import { computeQuarter, Journal, JournalRow, JournalYear, MARK_COLOR, PART_KK, SumCol } from '../lib/journal';
import { useUrlState } from '../hooks';
import { Plan, topicOn } from '../lib/plan';
import { Badge, Card, ConfirmDialog, Empty, ErrorState, ExportMenu, Field, Modal, Segmented, Spinner } from '../components/ui';

const key = (sid: number, cid: number) => `${sid}:${cid}`;
const MARKS = [2, 3, 4, 5];
const ABSENT = 'ж';
/** Қатысу белгісі журнал ұяшығында: «н» — келмеді. */
const ABS_KK: Record<string, string> = { N: 'себепсіз', S: 'себепті', A: 'ауырған', O: 'басқа себеп' };

type SumKind = 'BJB' | 'TJB' | 'ARALYK';
type ScoreCell = JournalRow['tjb'];
/** Журналдағы жиынтық бағалау бағаны (БЖБ / аралық / ТЖБ). */
type SumEntry = { a: SumCol; kind: SumKind; label: string; cell: (r: JournalRow) => ScoreCell };
const KIND_PATH: Record<SumKind, string> = { BJB: '/bjb', TJB: '/tjb', ARALYK: '/aralyk' };
const KIND_KK: Record<SumKind, string> = { BJB: 'БЖБ', TJB: 'ТЖБ', ARALYK: 'Аралық бағалау' };

function sumsOf(j: Journal): SumEntry[] {
  return [
    ...j.bjb.map((a, i): SumEntry => ({ a, kind: 'BJB', label: `БЖБ ${i + 1}`, cell: (r) => r.bjb[i] })),
    ...j.interim.map((a, i): SumEntry => ({ a, kind: 'ARALYK', label: `Аралық${j.interim.length > 1 ? ` ${i + 1}` : ''}`, cell: (r) => r.interim[i] })),
    ...(j.tjb ? [{ a: j.tjb, kind: 'TJB' as const, label: 'ТЖБ', cell: (r: JournalRow) => r.tjb }] : []),
  ];
}
const skey = (aid: number, sid: number) => `${aid}:${sid}`;
/** Ұяшық мәні: '' — енгізілмеген, 'ж' — қатыспады, әйтпесе балл. */
const parseScore = (v: string): { empty: true } | { absent: true } | { score: number } | null => {
  if (v === '') return { empty: true };
  if (v === ABSENT) return { absent: true };
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? { score: n } : null;
};

export default function JournalPage() {
  const { ref, quarterId, setQuarterId, year, subjectsOf, groupsOf } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const [s, set] = useUrlState({ classId: 0, subjectId: 0, groupId: 0, view: 'quarter' });
  const classId = s.classId || ref.classes.find((c) => c.isHomeroom)?.id || ref.classes[0]?.id || 0;
  const subjects = subjectsOf(classId);
  const subjectId = subjects.some((x) => x.id === s.subjectId) ? s.subjectId : (subjects[0]?.id ?? 0);
  const view = s.view === 'year' ? 'year' : 'quarter';
  const groups = groupsOf(classId, subjectId);
  const groupId = groups.length ? (groups.some((g) => g.id === s.groupId) ? s.groupId : groups[0].id) : undefined;

  const params = { classId, subjectId, quarterId, groupId };
  const q = useQuery({ queryKey: ['journal', params], queryFn: () => api.get<Journal>('/journal', params), enabled: view === 'quarter' && !!classId && !!subjectId });
  const y = useQuery({ queryKey: ['journal-year', classId, subjectId, groupId], queryFn: () => api.get<JournalYear>('/journal/year', { classId, subjectId, groupId }), enabled: view === 'year' && !!classId && !!subjectId });

  const exportFile = async (format: string) => {
    try {
      await download('/journal/export', { ...params, format });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Журнал</h1>
        <Segmented
          value={view}
          label="Көрініс"
          onChange={(v) => set({ view: v })}
          options={[
            { value: 'quarter', label: 'Тоқсан' },
            { value: 'year', label: 'Жылдық' },
          ]}
        />
        <span className="grow" />
        {view === 'quarter' && q.data && can(PERM.EXPORT) && <ExportMenu onExport={exportFile} />}
      </div>

      <div className="filters" style={{ alignItems: 'flex-end' }}>
        <Field label="Сынып">
          <select className="select" value={classId} onChange={(e) => set({ classId: Number(e.target.value), subjectId: 0, groupId: 0 })}>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Пән">
          <select className="select" value={subjectId} onChange={(e) => set({ subjectId: Number(e.target.value), groupId: 0 })}>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        {!!groups.length && (
          <Field label="Топ">
            <select className="select" value={groupId} onChange={(e) => set({ groupId: Number(e.target.value) })}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {view === 'quarter' && (
          <Field label="Тоқсан">
            <select className="select" value={quarterId} onChange={(e) => setQuarterId(Number(e.target.value))}>
              {year.quarters.map((qq) => (
                <option key={qq.id} value={qq.id}>
                  {qq.number}-тоқсан
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {!subjects.length ? (
        <Empty>Бұл сыныпта сізге бекітілген пән жоқ.</Empty>
      ) : view === 'year' ? (
        y.isLoading ? <Spinner block /> : y.isError ? <ErrorState error={y.error} onRetry={() => y.refetch()} /> : y.data ? <YearView y={y.data} /> : null
      ) : q.isLoading ? (
        <Spinner block />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <QuarterView key={`${q.data.classId}:${q.data.subjectId}:${q.data.quarterId}:${q.data.groupId ?? 0}`} j={q.data} canWrite={can(PERM.ASSESS) && q.data.canWrite} />
      ) : null}
    </div>
  );
}

function MarkBadge({ mark, title }: { mark: number | null | undefined; title?: string }) {
  if (mark == null) return <span className="muted">—</span>;
  return (
    <span className={`badge ${MARK_COLOR[mark] ?? ''}`} title={title} style={{ fontFamily: 'var(--mono)', minWidth: 26, justifyContent: 'center' }}>
      {mark}
    </span>
  );
}

/** Тоқсан журналы: ағымдағы бағалар (1–10), БЖБ/ТЖБ нәтижелері, есептелген және қойылған тоқсандық баға. */
function QuarterView({ j, canWrite }: { j: Journal; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initMarks = () => {
    const m: Record<string, string> = {};
    j.rows.forEach((r) => j.columns.forEach((c, ci) => (m[key(r.studentId, c.id)] = r.marks[ci] != null ? String(r.marks[ci]) : '')));
    return m;
  };
  const initFinals = () => Object.fromEntries(j.rows.map((r) => [r.studentId, r.final ? String(r.final.mark) : ''])) as Record<number, string>;
  const initHw = () => {
    const m: Record<string, boolean> = {};
    j.rows.forEach((r) => j.columns.forEach((c, ci) => (m[key(r.studentId, c.id)] = !!r.homework?.[ci])));
    return m;
  };
  const [marks, setMarks] = useState(initMarks);
  const [hw, setHw] = useState(initHw);
  const [finals, setFinals] = useState(initFinals);
  const [col, setCol] = useState<Journal['columns'][number] | 'new' | null>(null);
  const [sumForm, setSumForm] = useState<{ kind: SumKind; initial: SumCol | null } | null>(null);
  const sums = useMemo(() => sumsOf(j), [j]);
  const initScores = () => {
    const m: Record<string, string> = {};
    j.rows.forEach((r) =>
      sums.forEach((sc) => {
        const c = sc.cell(r);
        m[skey(sc.a.id, r.studentId)] = c == null ? '' : c.absent ? ABSENT : String(c.score);
      }),
    );
    return m;
  };
  const [scores, setScores] = useState(initScores);
  const origScores = useMemo(initScores, [j]); // eslint-disable-line react-hooks/exhaustive-deps
  // Сервердегі деректер жаңарса (сақтаудан кейін), жаңа баған қосылса — бос ұяшықтарды толтырамыз.
  useEffect(() => setScores((cur) => ({ ...origScores, ...Object.fromEntries(Object.entries(cur).filter(([k]) => k in origScores)) })), [origScores]);

  const origMarks = useMemo(initMarks, [j]); // eslint-disable-line react-hooks/exhaustive-deps
  const origFinals = useMemo(initFinals, [j]); // eslint-disable-line react-hooks/exhaustive-deps
  const origHw = useMemo(initHw, [j]); // eslint-disable-line react-hooks/exhaustive-deps
  const markChanges = Object.keys(marks).filter((k) => marks[k] !== origMarks[k]);
  const hwChanges = Object.keys(hw).filter((k) => hw[k] !== origHw[k]);
  // Жаңа баған қосылса/өшірілсе — енгізілген өзгерістерді сақтап, жаңа ұяшықтарды толтырамыз.
  const keepCur = <T,>(orig: Record<string, T>, cur: Record<string, T>) => ({ ...orig, ...Object.fromEntries(Object.entries(cur).filter(([k]) => k in orig)) });
  useEffect(() => setMarks((cur) => keepCur(origMarks, cur)), [origMarks]);
  useEffect(() => setHw((cur) => keepCur(origHw, cur)), [origHw]);
  const finalChanges = j.rows.filter((r) => finals[r.studentId] !== origFinals[r.studentId]);
  const scoreChanges = Object.keys(scores).filter((k) => scores[k] !== (origScores[k] ?? ''));
  const dirty = markChanges.length > 0 || hwChanges.length > 0 || finalChanges.length > 0 || scoreChanges.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  // Енгізу кезінде тоқсандық пайыз бен баға жедел қайта есептеледі (сервердегі формуламен бірдей).
  const computed = useMemo(
    () =>
      j.rows.map((r) => {
        const fo = j.columns.map((c) => Number(marks[key(r.studentId, c.id)])).filter((v) => v >= 1);
        // БЖБ/аралық: балдар қосындысы / максимумдар қосындысы (сервердегідей); қатыспаған жұмыс есепке кірмейді.
        const agg = (kind: SumKind) => {
          let got = 0;
          let max = 0;
          for (const sc of sums) {
            if (sc.kind !== kind) continue;
            const p = parseScore(scores[skey(sc.a.id, r.studentId)] ?? '');
            if (p && 'score' in p) {
              got += Math.min(p.score, sc.a.maxScore);
              max += sc.a.maxScore;
            }
          }
          return max > 0 ? (got / max) * 100 : null;
        };
        return computeQuarter(fo, agg('BJB'), agg('TJB'), j.weights, j.levels, agg('ARALYK'));
      }),
    [j, marks, scores, sums],
  );

  const save = useMutation({
    mutationFn: async () => {
      let res: Journal | null = null;
      // БЖБ/ТЖБ балдары — «Бағалау» беттеріндегі деректермен бірдей (assessment results).
      const byAssessment = new Map<number, unknown[]>();
      for (const k of scoreChanges) {
        const [aid, studentId] = k.split(':').map(Number);
        const sc = sums.find((x) => x.a.id === aid)!;
        const p = parseScore(scores[k]);
        if (!p) throw new ApiError(400, `${sc.label}: балл дұрыс емес`);
        if ('score' in p && p.score > sc.a.maxScore) throw new ApiError(400, `${sc.label}: балл ${sc.a.maxScore}-дан аспауы керек`);
        const item = 'empty' in p ? { studentId, clear: true } : 'absent' in p ? { studentId, absent: true } : { studentId, score: p.score };
        byAssessment.set(aid, [...(byAssessment.get(aid) ?? []), item]);
      }
      for (const [aid, results] of byAssessment) await api.put(`/assessments/${aid}/results`, { results });
      if (markChanges.length || hwChanges.length) {
        res = await api.put<Journal>('/journal/marks', {
          ...base(j),
          marks: markChanges.map((k) => {
            const [studentId, columnId] = k.split(':').map(Number);
            return { studentId, columnId, value: marks[k] ? Number(marks[k]) : null };
          }),
          homework: hwChanges.map((k) => {
            const [studentId, columnId] = k.split(':').map(Number);
            return { studentId, columnId, done: hw[k] };
          }),
        });
      }
      if (finalChanges.length) {
        res = await api.put<Journal>('/journal/finals', { ...base(j), grades: finalChanges.map((r) => ({ studentId: r.studentId, mark: finals[r.studentId] ? Number(finals[r.studentId]) : null })) });
      }
      return res;
    },
    onSuccess: (x) => {
      if (scoreChanges.length) qc.invalidateQueries({ queryKey: ['journal', base(j)] });
      else if (x) qc.setQueryData(['journal', base(j)], x);
      if (scoreChanges.length) qc.invalidateQueries({ queryKey: ['assessments'] });
      qc.invalidateQueries({ queryKey: ['journal-year'] });
      toast('Журнал сақталды');
    },
    onError: (e) => {
      toast(e instanceof ApiError ? e.message : 'Қате', 'error');
      qc.invalidateQueries({ queryKey: ['journal', base(j)] });
    },
  });

  const toggleHw = (sid: number, cid: number) => setHw((m) => ({ ...m, [key(sid, cid)]: !m[key(sid, cid)] }));

  const setMark = (sid: number, cid: number, v: string) => {
    // «+» — үй тапсырмасы белгісін ауыстыру (пернетақтадан тез қою үшін).
    if (v.includes('+')) {
      toggleHw(sid, cid);
      v = v.replace(/\+/g, '');
    }
    const clean = v.replace(/[^0-9]/g, '').slice(0, 2);
    const n = Number(clean);
    setMarks((m) => ({ ...m, [key(sid, cid)]: clean === '' ? '' : n > 10 ? '10' : n < 1 ? '' : String(n) }));
  };

  const setScore = (aid: number, sid: number, v: string, max: number) => {
    let clean: string;
    if (/^[жЖ-]/.test(v.trim())) clean = ABSENT;
    else {
      clean = v.replace(',', '.').replace(/[^0-9.]/g, '');
      const [a, ...b] = clean.split('.');
      clean = b.length ? `${a}.${b.join('').slice(0, 2)}` : a;
      if (Number(clean) > max) clean = String(max);
    }
    setScores((m) => ({ ...m, [skey(aid, sid)]: clean }));
  };

  const fillComputed = () => {
    let n = 0;
    const next = { ...finals };
    j.rows.forEach((r, i) => {
      if (!next[r.studentId] && computed[i].mark != null && !r.left) {
        next[r.studentId] = String(computed[i].mark);
        n++;
      }
    });
    setFinals(next);
    toast(n ? `${n} оқушыға есептелген баға қойылды. Тексеріп, сақтаңыз` : 'Бос қорытынды баға жоқ');
  };

  // Enter/↓/↑/←/→ — кесте бойынша жылжу.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    let row = Number(el.dataset.row);
    let c = Number(el.dataset.col);
    if (e.key === 'Enter' || e.key === 'ArrowDown') row++;
    else if (e.key === 'ArrowUp') row--;
    else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) c++;
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) c--;
    else return;
    e.preventDefault();
    const t = document.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-col="${c}"]`);
    if (t) {
      t.focus();
      t.select();
    }
  };

  const lv = j.levels;
  const finalSet = j.rows.filter((r) => finals[r.studentId]).length;
  const dist = MARKS.map((m) => j.rows.filter((r) => Number(finals[r.studentId]) === m).length);
  const w = j.weights;

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="chip">
          {j.primary ? `Формула: ФО ${w.fo}% · Аралық бағалау ${w.interim ?? 0}%` : `Формула: ФО ${w.fo}% · БЖБ ${w.bjb}% · ТЖБ ${w.tjb}%`}
        </span>
        <span className="chip">
          {dot(j.startDate)} – {dot(j.endDate)}
        </span>
        <span className="chip">
          Қорытынды баға қойылды: <b className="mono">{finalSet}</b> / {j.rows.filter((r) => !r.left).length}
        </span>
        {finalSet > 0 && (
          <span className="row" style={{ gap: 4 }}>
            {MARKS.map((m, i) => (
              <span key={m} className={`badge ${MARK_COLOR[m]}`} title={`«${m}» — ${dist[i]} оқушы`}>
                {m}: {dist[i]}
              </span>
            ))}
          </span>
        )}
        <span className="grow" />
        {canWrite && (
          <>
            <button className="btn" onClick={() => setCol('new')}>
              + Баған (сабақ)
            </button>
            <Link className="btn" to={`/plan?classId=${j.classId}&subjectId=${j.subjectId}${j.groupId ? `&groupId=${j.groupId}` : ''}`} title="Күнтізбелік-тақырыптық жоспар">
              КТЖ
            </Link>
            {j.primary ? (
              <button className="btn" onClick={() => setSumForm({ kind: 'ARALYK', initial: null })}>
                + Аралық бағалау
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setSumForm({ kind: 'BJB', initial: null })}>
                  + БЖБ
                </button>
                {!j.tjb && (
                  <button className="btn" onClick={() => setSumForm({ kind: 'TJB', initial: null })}>
                    + ТЖБ
                  </button>
                )}
              </>
            )}
            <button className="btn" onClick={fillComputed} title="Бос қорытынды бағаларды есептелген бағамен толтыру">
              Есептелген бағаны қою
            </button>
          </>
        )}
      </div>

      <div className="card flush">
        <div className="table-wrap journal-wrap">
          <table className="tbl journal">
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 36 }}>
                  №
                </th>
                <th className="sticky-col name-col">Оқушы</th>
                {j.columns.map((c) => (
                  <th key={c.id} className="center mark-col" title={c.topic ?? undefined}>
                    {canWrite ? (
                      <button className="linklike" onClick={() => setCol(c)} aria-label={`${dot(c.date)} бағанын өзгерту`}>
                        {dot(c.date).slice(0, 5)}
                      </button>
                    ) : (
                      dot(c.date).slice(0, 5)
                    )}
                    {c.topic && <div className="col-topic">{c.topic}</div>}
                  </th>
                ))}
                {!j.columns.length && <th className="center muted">Ағымдағы бағалар</th>}
                <th className="num sep" title="Ағымдағы бағалардың орташасы (10 балдық)">
                  ФО
                </th>
                {sums.map((sc, si) => (
                  <th key={sc.a.id} className={`center score-col ${si === 0 ? 'sep' : ''}`} title={`${sc.a.title} · макс. ${sc.a.maxScore} балл${sc.a.criteria ? ' · критерий бойынша' : ''}`}>
                    {sc.a.criteria ? (
                      <Link className="linklike" to={`${KIND_PATH[sc.kind]}?classId=${j.classId}&subjectId=${j.subjectId}${j.groupId ? `&groupId=${j.groupId}` : ''}&id=${sc.a.id}`}>
                        {sc.label}
                      </Link>
                    ) : canWrite ? (
                      <button className="linklike" onClick={() => setSumForm({ kind: sc.kind, initial: sc.a })} aria-label={`${sc.label} баптауын өзгерту`}>
                        {sc.label}
                      </button>
                    ) : (
                      sc.label
                    )}
                    <div className="col-topic">/{sc.a.maxScore}</div>
                  </th>
                ))}
                <th className="num sep" title="Салмақталған тоқсандық пайыз">
                  Тоқсан %
                </th>
                <th className="center" title="Формула бойынша есептелген баға">
                  Есеп
                </th>
                <th className="center" style={{ width: 90 }}>
                  Қорытынды
                </th>
              </tr>
            </thead>
            <tbody>
              {j.rows.map((r, i) => {
                const c = computed[i];
                const f = finals[r.studentId];
                const manual = f && c.mark != null && Number(f) !== c.mark;
                return (
                  <tr key={r.studentId} className={r.left ? 'muted' : undefined}>
                    <td className="sticky-col mono muted">{i + 1}</td>
                    <td className="sticky-col name-col">
                      <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        {r.fullName}
                      </Link>
                      {r.left && (
                        <Badge tone="muted">
                          кетті
                        </Badge>
                      )}
                    </td>
                    {j.columns.map((col, ci) => {
                      const k = key(r.studentId, col.id);
                      const abs = r.absent?.[ci] ?? null;
                      const done = !!hw[k];
                      return (
                        <td
                          key={col.id}
                          className={`center mark-col ${marks[k] !== origMarks[k] || done !== origHw[k] ? 'changed' : ''}`}
                          title={abs ? `Сабаққа келмеді (${ABS_KK[abs] ?? abs})` : undefined}
                        >
                          <div className="mark-cell">
                          <input
                            className={`input mono mark-input ${abs ? `abs abs-${abs}` : ''}`}
                            placeholder={abs ? 'н' : undefined}
                            inputMode="numeric"
                            value={marks[k]}
                            disabled={!canWrite}
                            data-row={i}
                            data-col={ci}
                            onKeyDown={onKey}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setMark(r.studentId, col.id, e.target.value)}
                            aria-label={`${r.fullName}, ${dot(col.date)}`}
                          />
                          {(canWrite || done) && (
                            <button
                              type="button"
                              className={`hw-toggle ${done ? 'on' : ''}`}
                              disabled={!canWrite}
                              tabIndex={-1}
                              onClick={() => toggleHw(r.studentId, col.id)}
                              title={done ? 'Үй тапсырмасын орындады (алып тастау үшін басыңыз)' : 'Үй тапсырмасын орындады деп белгілеу (немесе ұяшықта «+»)'}
                              aria-label={`${r.fullName}, ${dot(col.date)}: үй тапсырмасы`}
                              aria-pressed={done}
                            >
                              ✓
                            </button>
                          )}
                          </div>
                        </td>
                      );
                    })}
                    {!j.columns.length && <td />}
                    <td className="num sep" title={c.foPct != null ? pct(c.foPct) : undefined}>
                      {c.foPct != null ? (c.foPct / 10).toFixed(1) : '—'}
                    </td>
                    {sums.map((sc, si) => {
                      const k = skey(sc.a.id, r.studentId);
                      const v = scores[k] ?? '';
                      const p = parseScore(v);
                      const title = p && 'score' in p ? `${pct((Math.min(p.score, sc.a.maxScore) / sc.a.maxScore) * 100)} · ${sc.a.title}` : sc.a.title;
                      if (sc.a.criteria) {
                        return (
                          <td key={sc.a.id} className={`center score-col ${si === 0 ? 'sep' : ''}`} title={`${title} · критерий бойынша «${KIND_KK[sc.kind]}» бетінде енгізіледі`}>
                            {v === '' ? <span className="muted">—</span> : v === ABSENT ? <span className="muted">жоқ</span> : <span className="mono">{v}</span>}
                          </td>
                        );
                      }
                      return (
                        <td key={sc.a.id} className={`center score-col ${si === 0 ? 'sep' : ''} ${v !== (origScores[k] ?? '') ? 'changed' : ''}`} title={title}>
                          <input
                            className={`input mono score-input ${v === ABSENT ? 'absent' : ''}`}
                            inputMode="decimal"
                            value={v}
                            disabled={!canWrite}
                            data-row={i}
                            data-col={j.columns.length + si}
                            onKeyDown={onKey}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setScore(sc.a.id, r.studentId, e.target.value, sc.a.maxScore)}
                            onBlur={() => v !== '' && v !== ABSENT && setScores((m) => ({ ...m, [k]: String(Number(v)) }))}
                            aria-label={`${r.fullName}, ${sc.label} (макс. ${sc.a.maxScore})`}
                          />
                        </td>
                      );
                    })}
                    <td className="num sep" title={c.missing.length ? `Есепке кірмеді: ${c.missing.map((m) => PART_KK[m]).join(', ')}` : undefined}>
                      {pct(c.pct)}
                      {c.pct != null && c.missing.length > 0 && <span className="c-warn"> *</span>}
                    </td>
                    <td className="center">
                      <MarkBadge mark={c.mark} />
                    </td>
                    <td className={`center ${f !== origFinals[r.studentId] ? 'changed' : ''}`}>
                      <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
                        <select
                          className="select mono"
                          style={{ width: 56, height: 30, padding: '0 6px' }}
                          value={f}
                          disabled={!canWrite}
                          onChange={(e) => setFinals((x) => ({ ...x, [r.studentId]: e.target.value }))}
                          aria-label={`${r.fullName}: тоқсандық баға`}
                        >
                          <option value="">—</option>
                          {MARKS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        {manual && (
                          <span className="c-warn" title={`Формула бойынша: ${c.mark}. Баға қолмен өзгертілген`} aria-label="қолмен өзгертілген">
                            ✎
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!j.rows.length && (
                <tr>
                  <td colSpan={6 + Math.max(1, j.columns.length) + sums.length}>
                    <Empty>Сыныпта белсенді оқушы жоқ</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span className="muted">
            {j.columns.length} сабақ · {j.primary ? `аралық бағалау ${j.interim.length}` : `БЖБ ${j.bjb.length} · ТЖБ ${j.tjb ? 1 : 0}`}
            {dirty && <span className="c-warn"> · сақталмаған өзгерістер бар</span>}
          </span>
          {canWrite && (
            <div className="row">
              {dirty && (
                <button
                  className="btn"
                  onClick={() => {
                    setMarks(origMarks);
                    setHw(origHw);
                    setFinals(origFinals);
                    setScores(origScores);
                  }}
                >
                  Болдырмау
                </button>
              )}
              <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                {save.isPending && <Spinner />} Сақтау
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Ағымдағы баға 1–10 балл. Тоқсан % = {j.primary ? `ФО% × ${w.fo}% + аралық бағалау% × ${w.interim ?? 0}%` : `ФО% × ${w.fo}% + БЖБ% × ${w.bjb}% + ТЖБ% × ${w.tjb}%`}; деректері жоқ бөлік (*) есептен шығып, қалғандарының салмағы пропорционалды артады. Баға: {lv.length === 4 ? lv.map((l, i) => `${l.fromPct}–${l.toPct}% → ${i + 2}`).join(', ') : '85%+ → 5, 65% → 4, 40% → 3, одан төмен → 2'}. {j.primary ? 'Аралық бағалау' : 'БЖБ/ТЖБ'} балын осы кестеде тікелей енгізуге болады (жұмысқа қатыспаса — «ж»); критерий бойынша құрылған жұмыстар «Бағалау» бетінде толтырылады. Бағаның қасындағы ✓ — үй тапсырмасын орындады (ұяшықта «+» басса да болады). Enter / ↑↓←→ — жылжу.
      </div>

      {sumForm && (
        <SumForm
          j={j}
          kind={sumForm.kind}
          initial={sumForm.initial}
          dirty={dirty}
          onClose={() => setSumForm(null)}
          onSaved={() => {
            setSumForm(null);
            qc.invalidateQueries({ queryKey: ['journal', base(j)] });
            qc.invalidateQueries({ queryKey: ['assessments'] });
          }}
        />
      )}

      {col && (
        <ColumnForm
          j={j}
          initial={col === 'new' ? null : col}
          onClose={() => setCol(null)}
          dirty={dirty}
          onSaved={() => {
            setCol(null);
            qc.invalidateQueries({ queryKey: ['journal', base(j)] });
          }}
        />
      )}
    </div>
  );
}

const base = (j: Journal) => ({ classId: j.classId, subjectId: j.subjectId, quarterId: j.quarterId, groupId: j.groupId ?? undefined });

function ColumnForm({ j, initial, onClose, onSaved, dirty }: { j: Journal; initial: Journal['columns'][number] | null; onClose: () => void; onSaved: () => void; dirty: boolean }) {
  const { ref } = useReference();
  const toast = useToast();
  const today = ref.today;
  const defDate = today < j.startDate ? j.startDate : today > j.endDate ? j.endDate : today;
  const [date, setDate] = useState(initial?.date ?? defDate);
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [del, setDel] = useState(false);
  const bad = !date || date < j.startDate || date > j.endDate;
  // Күнтізбелік жоспар: таңдалған күнгі тақырып автоматты түрде қойылады, қалғандары тізімнен таңдалады.
  const plan = useQuery({ queryKey: ['plan', base(j)], queryFn: () => api.get<Plan>('/plan', base(j)), staleTime: 60_000 });
  const planned = plan.data?.lessons ?? [];
  const [auto, setAuto] = useState<string | null>(null);
  useEffect(() => {
    if (!plan.data || !date) return;
    const t = topicOn(plan.data.lessons, date);
    if (t && (!topic || topic === auto)) {
      setTopic(t);
      setAuto(t);
    }
  }, [plan.data, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => (initial ? api.put(`/journal/columns/${initial.id}`, { date, topic }) : api.post('/journal/columns', { ...base(j), date, topic })),
    onSuccess: () => (toast(initial ? 'Баған өзгертілді' : 'Баған қосылды'), onSaved()),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/journal/columns/${initial!.id}`),
    onSuccess: () => (toast('Баған жойылды'), onSaved()),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const filled = initial ? j.rows.filter((r) => r.marks[j.columns.findIndex((c) => c.id === initial.id)] != null).length : 0;
  return (
    <>
      <Modal
        open={!del}
        title={initial ? 'Бағанды өзгерту' : 'Жаңа баған (сабақ)'}
        onClose={onClose}
        size="sm"
        footer={
          <>
            {initial && (
              <button className="btn ghost c-bad" onClick={() => setDel(true)} style={{ marginRight: 'auto' }}>
                Жою
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Болдырмау
            </button>
            <button className="btn primary" disabled={bad || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />} Сақтау
            </button>
          </>
        }
      >
        <div className="stack">
          {dirty && <div className="c-warn" style={{ fontSize: 13 }}>Сақталмаған бағалар бар: алдымен «Сақтау» басыңыз, әйтпесе олар жоғалады.</div>}
          <Field label="Күні" error={date && bad ? `${dot(j.startDate)} – ${dot(j.endDate)} аралығында` : null}>
            <input type="date" className="input" value={date} min={j.startDate} max={j.endDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Тақырып (міндетті емес)">
            <input className="input" value={topic} maxLength={160} onChange={(e) => setTopic(e.target.value)} placeholder="Мысалы: Квадрат теңдеулер" list={planned.length ? 'plan-topics' : undefined} />
            {planned.length > 0 && (
              <datalist id="plan-topics">
                {[...new Set(planned.map((l) => l.topic.slice(0, 160)))].map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            )}
          </Field>
          {plan.data && !planned.length && (
            <div className="muted" style={{ fontSize: 12 }}>
              Тақырыптар <Link to={`/plan?classId=${j.classId}&subjectId=${j.subjectId}${j.groupId ? `&groupId=${j.groupId}` : ''}`}>күнтізбелік жоспардан</Link> автоматты түрде алынады.
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={del}
        danger
        title="Бағанды жою"
        text={
          <>
            {initial && dot(initial.date)} бағаны және оған қойылған <b>{filled}</b> баға жойылады. Бұл әрекет аудит журналына жазылады.
          </>
        }
        confirmLabel="Жою"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDel(false)}
      />
    </>
  );
}

/** Журналдан БЖБ / ТЖБ / аралық бағалау құру және өзгерту (критерийсіз, тек жалпы балл). */
function SumForm({ j, kind, initial, onClose, onSaved, dirty }: { j: Journal; kind: SumKind; initial: SumCol | null; onClose: () => void; onSaved: () => void; dirty: boolean }) {
  const toast = useToast();
  const defTitle = kind === 'TJB' ? `${j.quarter}-тоқсан ТЖБ` : kind === 'BJB' ? `БЖБ ${j.bjb.length + 1}` : `Аралық бағалау ${j.interim.length + 1}`;
  const [title, setTitle] = useState(initial?.title ?? defTitle);
  const [max, setMax] = useState(initial ? String(initial.maxScore) : '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [del, setDel] = useState(false);
  const maxN = Number(max);
  const badMax = !max || !Number.isFinite(maxN) || maxN < 1 || maxN > 200;
  const badDate = !!date && (date < j.startDate || date > j.endDate);
  const filled = initial ? j.rows.filter((r) => sumsOf(j).find((x) => x.a.id === initial.id)?.cell(r) != null).length : 0;
  const body = { type: kind, classId: j.classId, subjectId: j.subjectId, quarterId: j.quarterId, groupId: initial ? initial.groupId : j.groupId, title: title.trim(), maxScore: maxN, date: date || null };
  const save = useMutation({
    mutationFn: () => (initial ? api.put(`/assessments/${initial.id}`, { ...body, criteria: [] }) : api.post('/assessments', body)),
    onSuccess: () => (toast(initial ? `${KIND_KK[kind]} өзгертілді` : `${KIND_KK[kind]} қосылды`), onSaved()),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/assessments/${initial!.id}`),
    onSuccess: () => (toast(`${KIND_KK[kind]} жойылды`), onSaved()),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <>
      <Modal
        open={!del}
        title={initial ? `${KIND_KK[kind]}: баптау` : `Жаңа ${KIND_KK[kind]}`}
        onClose={onClose}
        size="sm"
        footer={
          <>
            {initial && (
              <button className="btn ghost c-bad" onClick={() => setDel(true)} style={{ marginRight: 'auto' }}>
                Жою
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Болдырмау
            </button>
            <button className="btn primary" disabled={badMax || badDate || title.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />} Сақтау
            </button>
          </>
        }
      >
        <div className="stack">
          {dirty && <div className="c-warn" style={{ fontSize: 13 }}>Сақталмаған бағалар бар: алдымен «Сақтау» басыңыз, әйтпесе олар жоғалады.</div>}
          <Field label="Атауы">
            <input className="input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Максималды балл" error={max && badMax ? '1–200 аралығында' : initial && filled ? 'Нәтижелер енгізілген: максималды балды өзгертуге болмайды' : null}>
            <input className="input mono" inputMode="decimal" value={max} disabled={!!initial && filled > 0} onChange={(e) => setMax(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))} placeholder="Мысалы: 20" autoFocus={!initial} />
          </Field>
          <Field label="Күні (міндетті емес)" error={badDate ? `${dot(j.startDate)} – ${dot(j.endDate)} аралығында` : null}>
            <input type="date" className="input" value={date} min={j.startDate} max={j.endDate} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {!initial && kind !== 'BJB' && (
            <div className="muted" style={{ fontSize: 12 }}>
              Критерий бойынша талдау керек болса, жұмысты «{KIND_KK[kind]}» бетінде критерийлерімен құрыңыз.
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={del}
        danger
        title={`${KIND_KK[kind]} жою`}
        text={
          <>
            «{initial?.title}» және оған енгізілген <b>{filled}</b> нәтиже жойылады. Бұл әрекет аудит журналына жазылады.
          </>
        }
        confirmLabel="Жою"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDel(false)}
      />
    </>
  );
}

/** Жылдық көрініс: тоқсандық қорытынды бағалар және жылдық баға (орташасы, 0.5 жоғары дөңгелектенеді). */
function YearView({ y }: { y: JournalYear }) {
  const withYear = y.rows.filter((r) => r.year != null).length;
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="chip">
          Жылдық баға: <b className="mono">{withYear}</b> / {y.rows.filter((r) => !r.left).length}
        </span>
        {withYear > 0 &&
          MARKS.map((m, i) => (
            <span key={m} className={`badge ${MARK_COLOR[m]}`}>
              {m}: {y.distribution[i]}
            </span>
          ))}
      </div>
      <Card flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>№</th>
                <th>Оқушы</th>
                {y.quarters.map((q) => (
                  <th key={q.id} className="center" style={{ width: 90 }}>
                    {q.number}-тоқсан
                  </th>
                ))}
                <th className="center" style={{ width: 100 }}>
                  Жылдық
                </th>
              </tr>
            </thead>
            <tbody>
              {y.rows.map((r, i) => (
                <tr key={r.studentId} className={r.left ? 'muted' : undefined}>
                  <td className="mono muted">{i + 1}</td>
                  <td>
                    <Link to={`/students/${r.studentId}`} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                      {r.fullName}
                    </Link>
                    {r.left && <Badge tone="muted">кетті</Badge>}
                  </td>
                  {r.marks.map((m, qi) => (
                    <td key={qi} className="center">
                      <MarkBadge mark={m} />
                    </td>
                  ))}
                  <td className="center">
                    <MarkBadge mark={r.year} title={r.complete ? undefined : 'Барлық тоқсан бағасы қойылмаған — алдын ала'} />
                    {r.year != null && !r.complete && <span className="muted"> *</span>}
                  </td>
                </tr>
              ))}
              {!y.rows.length && (
                <tr>
                  <td colSpan={3 + y.quarters.length}>
                    <Empty>Сыныпта оқушы жоқ</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="muted" style={{ fontSize: 12 }}>
        Жылдық баға — қойылған тоқсандық бағалардың орташасы (0.5 жоғары дөңгелектенеді). * — барлық тоқсан бағасы әлі қойылмаған.
      </div>
    </div>
  );
}
