import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError, download } from '../api/client';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot } from '../lib/format';
import { fillDates, Plan, PlanLesson, slotDates, totalHours, WEEKDAYS_KK } from '../lib/plan';
import { useUrlState } from '../hooks';
import { Badge, ConfirmDialog, Empty, ErrorState, ExportMenu, Field, Modal, Spinner } from '../components/ui';

const blank = (): PlanLesson => ({ section: null, topic: '', objectives: null, hours: 1, date: null, notes: null });
const strip = (l: PlanLesson) => ({ section: l.section || null, topic: l.topic.trim(), objectives: l.objectives || null, hours: l.hours || 1, date: l.date || null, notes: l.notes || null });

export default function PlanPage() {
  const { ref, quarterId, setQuarterId, year, subjectsOf, groupsOf } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const [s, set] = useUrlState({ classId: 0, subjectId: 0, groupId: 0 });
  const classId = s.classId || ref.classes.find((c) => c.isHomeroom)?.id || ref.classes[0]?.id || 0;
  const subjects = subjectsOf(classId);
  const subjectId = subjects.some((x) => x.id === s.subjectId) ? s.subjectId : (subjects[0]?.id ?? 0);
  const groups = groupsOf(classId, subjectId);
  const groupId = groups.length ? (groups.some((g) => g.id === s.groupId) ? s.groupId : groups[0].id) : undefined;
  const params = { classId, subjectId, quarterId, groupId };
  const q = useQuery({ queryKey: ['plan', params], queryFn: () => api.get<Plan>('/plan', params), enabled: !!classId && !!subjectId });

  const exportFile = async (format: string) => {
    try {
      await download('/plan/export', { ...params, format });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Күнтізбелік жоспар</h1>
        <span className="muted hide-sm" style={{ fontSize: 13 }}>
          күнтізбелік-тақырыптық жоспар (КТЖ)
        </span>
        <span className="grow" />
        {q.data && q.data.lessons.length > 0 && can(PERM.EXPORT) && <ExportMenu onExport={exportFile} />}
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
        <Field label="Тоқсан">
          <select className="select" value={quarterId} onChange={(e) => setQuarterId(Number(e.target.value))}>
            {year.quarters.map((qq) => {
              const c = q.data?.quarters.find((x) => x.id === qq.id);
              return (
                <option key={qq.id} value={qq.id}>
                  {qq.number}-тоқсан{c ? ` · ${c.lessons} сабақ` : ''}
                </option>
              );
            })}
          </select>
        </Field>
      </div>

      {!subjects.length ? (
        <Empty>Бұл сыныпта сізге бекітілген пән жоқ.</Empty>
      ) : q.isLoading ? (
        <Spinner block />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <PlanView key={`${q.data.classId}:${q.data.subjectId}:${q.data.quarterId}:${q.data.groupId ?? 0}`} p={q.data} canWrite={can(PERM.ASSESS) && q.data.canWrite} />
      ) : null}
    </div>
  );
}

const base = (p: Plan) => ({ classId: p.classId, subjectId: p.subjectId, quarterId: p.quarterId, groupId: p.groupId ?? undefined });

function PlanView({ p, canWrite }: { p: Plan; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<PlanLesson[] | null>(null);
  const [modal, setModal] = useState<'import' | 'copy' | 'dates' | 'journal' | 'paste' | null>(null);
  const editing = draft != null;
  const lessons = draft ?? p.lessons;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['plan'] });
    qc.invalidateQueries({ queryKey: ['journal'] });
  };

  const dirty = editing && JSON.stringify(draft.map(strip)) !== JSON.stringify(p.lessons.map(strip));
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.put<Plan>('/plan', { ...base(p), lessons: draft!.filter((l) => l.topic.trim()).map(strip) }),
    onSuccess: (next) => {
      qc.setQueryData(['plan', base(p)], next);
      refresh();
      setDraft(null);
      toast('Жоспар сақталды');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const slots = useMemo(() => slotDates(p.startDate, p.endDate, p.weekdays), [p]);
  const hours = totalHours(lessons);
  const past = p.lessons.filter((l) => l.past);
  const done = past.filter((l) => l.columnId).length;
  const missingDates = new Set(p.lessons.filter((l) => l.past && l.date && !l.columnId).map((l) => l.date!)).size;

  const patch = (i: number, v: Partial<PlanLesson>) => setDraft((d) => d!.map((l, k) => (k === i ? { ...l, ...v } : l)));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const n = [...d!];
      const j = i + dir;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const insert = (i: number) => setDraft((d) => [...d!.slice(0, i + 1), { ...blank(), section: d![i]?.section ?? null }, ...d!.slice(i + 1)]);
  const remove = (i: number) => setDraft((d) => d!.filter((_, k) => k !== i));
  const startEdit = () => setDraft(p.lessons.length ? p.lessons.map((l) => ({ ...l })) : [blank()]);

  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <span className="chip">
          {dot(p.startDate)} – {dot(p.endDate)}
        </span>
        <span className="chip">
          Жоспарда: <b className="mono">{lessons.length}</b> сабақ, <b className="mono">{hours}</b> сағат
        </span>
        {p.weekdays.length > 0 ? (
          <span className="chip" title={`Кесте: ${p.weekdays.map((w) => WEEKDAYS_KK[w - 1]).join(', ')}. Мерекелік күндер шегерілді.`}>
            Кесте бойынша: <b className="mono">{slots.length}</b> сабақ
            {slots.length > 0 && hours !== slots.length && <span className={hours > slots.length ? 'c-bad' : 'c-warn'}>&nbsp;({hours > slots.length ? '+' : ''}{hours - slots.length})</span>}
          </span>
        ) : (
          <span className="chip muted">Сабақ кестесі жоқ</span>
        )}
        {past.length > 0 && (
          <span className="chip" title="Жоспардағы күні өткен сабақтардың журналда бағаны бар-жоғы">
            Журналда өткізілді: <b className="mono">{done}</b> / {past.length}
          </span>
        )}
        <span className="grow" />
        {canWrite && !editing && (
          <>
            <button className="btn" onClick={() => setModal('import')}>
              Excel-ден импорт
            </button>
            {p.lessons.length > 0 && (
              <>
                <button className="btn" onClick={() => setModal('copy')}>
                  Басқа сыныпқа көшіру
                </button>
                <button className="btn" disabled={!missingDates} onClick={() => setModal('journal')} title="Жоспардағы өткен сабақтарды журналға баған ретінде қосу">
                  Журналға шығару{missingDates ? ` (${missingDates})` : ''}
                </button>
              </>
            )}
            <button className="btn primary" onClick={startEdit}>
              {p.lessons.length ? 'Өзгерту' : '+ Жоспар құру'}
            </button>
          </>
        )}
        {editing && (
          <>
            <button className="btn" onClick={() => setModal('paste')}>
              Тізім қою
            </button>
            <button className="btn" onClick={() => setModal('dates')} disabled={!draft.length}>
              Күндерді толтыру
            </button>
            <button className="btn" onClick={() => setDraft(null)} disabled={save.isPending}>
              Болдырмау
            </button>
            <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
              {save.isPending && <Spinner />} Сақтау
            </button>
          </>
        )}
      </div>

      {!lessons.length ? (
        <div className="card">
          <Empty>
            {p.className} · {p.subject} бойынша {p.quarter}-тоқсанға жоспар әлі жоқ.
            {canWrite && (
              <>
                <br />
                Excel файлынан импорттаңыз (<button className="linklike" onClick={() => download('/plan/template').catch((e) => toast((e as Error).message, 'error'))}>үлгіні жүктеу</button>) немесе «+ Жоспар құру» арқылы қолмен толтырыңыз.
              </>
            )}
          </Empty>
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="tbl plan">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>№</th>
                  {editing && <th style={{ width: 180 }}>Бөлім</th>}
                  <th>Сабақ тақырыбы</th>
                  <th className="hide-sm">Оқу мақсаттары</th>
                  <th className="center" style={{ width: 64 }}>
                    Сағат
                  </th>
                  <th style={{ width: editing ? 150 : 96 }}>Күні</th>
                  {!editing && <th className="center" style={{ width: 90 }}>Журнал</th>}
                  {editing && <th style={{ width: 120 }} />}
                </tr>
              </thead>
              <tbody>
                {lessons.map((l, i) => {
                  const newSection = !editing && l.section && l.section !== lessons[i - 1]?.section;
                  return (
                    <Fragment key={i}>
                      {newSection && (
                        <tr className="plan-section">
                          <td colSpan={6}>{l.section}</td>
                        </tr>
                      )}
                      {editing ? (
                        <EditRow l={l} i={i} n={lessons.length} patch={patch} move={move} insert={insert} remove={remove} p={p} />
                      ) : (
                        <tr>
                          <td className="id">{i + 1}</td>
                          <td style={{ whiteSpace: 'pre-wrap', padding: '8px 12px' }}>
                            {l.topic}
                            {l.notes && <div className="muted" style={{ fontSize: 12 }}>{l.notes}</div>}
                          </td>
                          <td className="hide-sm muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, padding: '8px 12px', maxWidth: 420 }}>
                            {l.objectives}
                          </td>
                          <td className="center mono">{l.hours}</td>
                          <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                            {l.date ? dot(l.date).slice(0, 5) : <span className="muted">—</span>}
                          </td>
                          <td className="center">
                            {l.columnId ? (
                              <Link to={`/journal?classId=${p.classId}&subjectId=${p.subjectId}${p.groupId ? `&groupId=${p.groupId}` : ''}`} title="Журналда осы күнге баған бар">
                                <Badge tone="ok">✓</Badge>
                              </Link>
                            ) : l.past ? (
                              <span title="Күні өтті, журналда баған жоқ">
                                <Badge tone="warn">жоқ</Badge>
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editing && (
            <div className="table-foot">
              <button className="btn" onClick={() => insert(lessons.length - 1)}>
                + Сабақ қосу
              </button>
              <span>Бос тақырыпты жолдар сақталмайды. Күн {p.quarter}-тоқсан аралығында болуы керек.</span>
            </div>
          )}
        </div>
      )}

      {modal === 'import' && <ImportModal p={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'copy' && <CopyModal p={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'dates' && draft && <DatesModal p={p} lessons={draft} onClose={() => setModal(null)} onApply={(d) => (setDraft(d), setModal(null))} />}
      {modal === 'paste' && draft && <PasteModal onClose={() => setModal(null)} onApply={(rows) => (setDraft((d) => [...d!.filter((l) => l.topic.trim()), ...rows]), setModal(null))} />}
      {modal === 'journal' && <JournalSync p={p} count={missingDates} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}

function EditRow({ l, i, n, p, patch, move, insert, remove }: { l: PlanLesson; i: number; n: number; p: Plan; patch: (i: number, v: Partial<PlanLesson>) => void; move: (i: number, d: -1 | 1) => void; insert: (i: number) => void; remove: (i: number) => void }) {
  const bad = !!l.date && (l.date < p.startDate || l.date > p.endDate);
  return (
    <tr style={{ verticalAlign: 'top' }}>
      <td className="id" style={{ paddingTop: 14 }}>
        {i + 1}
      </td>
      <td style={{ padding: '6px 4px' }}>
        <input className="input" value={l.section ?? ''} maxLength={300} onChange={(e) => patch(i, { section: e.target.value })} placeholder="Бөлім" aria-label={`${i + 1}-сабақ бөлімі`} />
      </td>
      <td style={{ padding: '6px 4px' }}>
        <textarea className="textarea" rows={2} value={l.topic} maxLength={500} onChange={(e) => patch(i, { topic: e.target.value })} placeholder="Сабақ тақырыбы" aria-label={`${i + 1}-сабақ тақырыбы`} style={{ minHeight: 0 }} />
      </td>
      <td className="hide-sm" style={{ padding: '6px 4px' }}>
        <textarea className="textarea" rows={2} value={l.objectives ?? ''} maxLength={3000} onChange={(e) => patch(i, { objectives: e.target.value })} placeholder="Оқу мақсаттары" aria-label={`${i + 1}-сабақ оқу мақсаттары`} style={{ minHeight: 0 }} />
      </td>
      <td style={{ padding: '6px 4px' }}>
        <input className="input num" type="number" min={1} max={20} value={l.hours} onChange={(e) => patch(i, { hours: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} aria-label={`${i + 1}-сабақ сағаты`} />
      </td>
      <td style={{ padding: '6px 4px' }}>
        <input className={`input${bad ? ' err' : ''}`} type="date" value={l.date ?? ''} min={p.startDate} max={p.endDate} onChange={(e) => patch(i, { date: e.target.value || null })} aria-label={`${i + 1}-сабақ күні`} title={bad ? 'Тоқсан аралығынан тыс' : undefined} />
      </td>
      <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>
        <button className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Жоғары" title="Жоғары">
          ↑
        </button>
        <button className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === n - 1} aria-label="Төмен" title="Төмен">
          ↓
        </button>
        <button className="btn ghost sm" onClick={() => insert(i)} aria-label="Астына сабақ қосу" title="Астына сабақ қосу">
          +
        </button>
        <button className="btn ghost sm c-bad" onClick={() => remove(i)} aria-label="Жою" title="Жою">
          ✕
        </button>
      </td>
    </tr>
  );
}

/** Сабақ кестесі бойынша күндерді автоматты қою. */
function DatesModal({ p, lessons, onClose, onApply }: { p: Plan; lessons: PlanLesson[]; onClose: () => void; onApply: (l: PlanLesson[]) => void }) {
  const [from, setFrom] = useState(p.startDate);
  const [days, setDays] = useState<number[]>(p.weekdays.length ? p.weekdays : []);
  const [start, setStart] = useState(1);
  const per = (w: number) => days.filter((d) => d === w).length;
  const setPer = (w: number, n: number) => setDays((d) => [...d.filter((x) => x !== w), ...Array(n).fill(w)].sort());
  const slots = slotDates(from, p.endDate, days);
  const need = totalHours(lessons.slice(start - 1));
  return (
    <Modal
      open
      size="sm"
      title="Күндерді кесте бойынша толтыру"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Болдырмау
          </button>
          <button className="btn primary" disabled={!slots.length} onClick={() => onApply(fillDates(lessons, slots, start - 1))}>
            Толтыру
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>
          {p.weekdays.length ? 'Апта күндері сабақ кестесінен алынды.' : 'Сабақ кестесі жоқ — апта күндерін таңдаңыз.'} Әр сабақ өз сағат санындай кесте сабағын алады. Мерекелік демалыс күндері (25 қазан, 16 желтоқсан, 8 наурыз, Наурыз, 1, 7, 9 мамыр т.б.) өткізіледі; айт күндерін қолмен түзетіңіз.
        </div>
        <Field label="Аптасына сабақ саны">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAYS_KK.map((w, i) => (
              <label key={w} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 12 }}>
                {w}
                <select className="select" value={per(i + 1)} onChange={(e) => setPer(i + 1, Number(e.target.value))} style={{ width: 56 }}>
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Қай сабақтан">
            <input className="input num" type="number" min={1} max={lessons.length} value={start} onChange={(e) => setStart(Math.max(1, Math.min(lessons.length, Number(e.target.value) || 1)))} style={{ width: 80 }} />
          </Field>
          <Field label="Қай күннен">
            <input className="input" type="date" value={from} min={p.startDate} max={p.endDate} onChange={(e) => setFrom(e.target.value || p.startDate)} />
          </Field>
        </div>
        <div style={{ fontSize: 13 }}>
          Кесте бойынша <b>{slots.length}</b> сабақ, жоспарда <b>{need}</b> сағат.
          {need > slots.length && <div className="c-warn">Соңғы {need - slots.length} сағатқа күн жетпейді — олар бос қалады.</div>}
        </div>
      </div>
    </Modal>
  );
}

/** Мәтіннен (Word/Excel-ден көшірілген) тақырыптар тізімін қосу: әр жол — бір сабақ. */
function PasteModal({ onClose, onApply }: { onClose: () => void; onApply: (rows: PlanLesson[]) => void }) {
  const [text, setText] = useState('');
  const rows = text
    .split('\n')
    .map((line) => line.split('\t').map((c) => c.trim()))
    .filter((c) => c.some(Boolean))
    .map((c): PlanLesson => {
      // «№ \t тақырып \t сағат» немесе жай «тақырып».
      const cells = /^\d{1,3}\.?$/.test(c[0]) && c.length > 1 ? c.slice(1) : c;
      const topic = cells[0].replace(/^\d{1,3}[.)]\s+/, '');
      const h = Number(cells[1]);
      return { ...blank(), topic: topic.slice(0, 500), hours: Number.isInteger(h) && h >= 1 && h <= 20 ? h : 1 };
    })
    .filter((r) => r.topic);
  return (
    <Modal
      open
      title="Тақырыптар тізімін қою"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Болдырмау
          </button>
          <button className="btn primary" disabled={!rows.length} onClick={() => onApply(rows)}>
            Қосу ({rows.length})
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>
          Әр жол — бір сабақ тақырыбы. Excel-ден бағандарды көшірсеңіз: «№ · Тақырып · Сағат» ретімен танылады.
        </div>
        <textarea className="textarea" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Бүтін көрсеткішті дәреже\nДәреженің қасиеттері\n…'} autoFocus />
      </div>
    </Modal>
  );
}

interface ImportResult {
  applied: boolean;
  sheet: string;
  split: boolean;
  total: number;
  hours: number;
  dated: number;
  quarters: { id: number; number: number; lessons: number; hours: number; existing: number }[];
  sample: (PlanLesson & { quarter: number })[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Файл оқылмады'));
    r.readAsDataURL(file);
  });
}

function ImportModal({ p, onClose, onDone }: { p: Plan; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [split, setSplit] = useState(true);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (v: { data: string; apply: boolean; splitQuarters: boolean }) => api.post<ImportResult>('/plan/import', { ...base(p), ...v }),
    onSuccess: (r) => {
      setErr(null);
      setRes(r);
      if (r.applied) {
        toast(`Импорт аяқталды: ${r.total} сабақ`);
        onDone();
        onClose();
      }
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });
  const pick = async (f: File | undefined) => {
    setRes(null);
    setErr(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setErr('Тек .xlsx форматындағы Excel файлы қабылданады. Word файлын Excel-ге көшіріңіз немесе «Тізім қою» арқылы қосыңыз.');
    if (f.size > 5 * 1024 * 1024) return setErr('Файл тым үлкен (5 МБ-тан аспауы керек)');
    const data = await toBase64(f);
    setFile({ name: f.name, data });
    run.mutate({ data, apply: false, splitQuarters: split });
  };
  const toggleSplit = (v: boolean) => {
    setSplit(v);
    if (file) run.mutate({ data: file.data, apply: false, splitQuarters: v });
  };
  const replaced = res?.quarters.filter((x) => x.existing > 0) ?? [];
  return (
    <Modal
      open
      size="lg"
      title="КТЖ-ны Excel-ден импорттау"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" disabled={!res || !file || run.isPending || !res.total || res.errors.length > 0} onClick={() => file && run.mutate({ data: file.data, apply: true, splitQuarters: split })}>
            {run.isPending && res ? 'Сақталуда…' : res?.total ? `Импорттау (${res.total} сабақ)` : 'Импорттау'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>
          Бағандар тақырыптан танылады: <b>№, Бөлім, Сабақ тақырыбы, Оқу мақсаттары, Сағат саны, Күні</b> (орысша да болады: Тема, Цели обучения, Кол-во часов, Дата). Міндеттісі — тек «Тақырып». Файлда «1-тоқсан», «2-тоқсан» жолдары болса, сабақтар тоқсандарға бөлінеді.{' '}
          <button className="linklike" onClick={() => download('/plan/template').catch((e) => toast((e as Error).message, 'error'))}>
            Үлгіні жүктеу
          </button>
        </div>
        <div className="row">
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn" onClick={() => input.current?.click()} disabled={run.isPending}>
            Файл таңдау
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {run.isPending && !res ? 'Тексерілуде…' : (file?.name ?? 'файл таңдалмаған')}
          </span>
        </div>
        {err && <div className="err-box">{err}</div>}
        {res && (
          <>
            <div className="mini-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              <div className="mini-kpi">
                <div className="l">Сабақ</div>
                <div className="v">{res.total}</div>
              </div>
              <div className="mini-kpi">
                <div className="l">Сағат</div>
                <div className="v">{res.hours}</div>
              </div>
              <div className="mini-kpi">
                <div className="l">Күні бар</div>
                <div className="v">{res.dated}</div>
              </div>
            </div>
            <div style={{ fontSize: 13 }}>
              {res.quarters.map((x) => (
                <span key={x.id} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                  <Badge tone={x.existing ? 'warn' : 'acc'}>
                    {x.number}-тоқсан · {x.lessons} сабақ
                  </Badge>
                </span>
              ))}
            </div>
            {(res.split || !split) && (
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={split} onChange={(e) => toggleSplit(e.target.checked)} />
                Файлдағы тоқсан белгілері бойынша бөлу (алынса — бәрі {p.quarter}-тоқсанға)
              </label>
            )}
            {replaced.length > 0 && (
              <div className="c-warn" style={{ fontSize: 13 }}>
                {replaced.map((x) => `${x.number}-тоқсанның бар ${x.existing} сабағы`).join(', ')} жаңа файлмен ауыстырылады.
              </div>
            )}
            {res.sample.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Тоқ.</th>
                      <th>Бөлім</th>
                      <th>Тақырып</th>
                      <th className="center">Сағ.</th>
                      <th>Күні</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.sample.map((l, i) => (
                      <tr key={i}>
                        <td className="mono">{l.quarter}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{l.section}</td>
                        <td>{l.topic}</td>
                        <td className="center mono">{l.hours}</td>
                        <td className="mono">{l.date ? dot(l.date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {res.errors.length > 0 && <div className="err-box">{res.errors.map((e) => e.message).join('; ')}</div>}
            {res.warnings.length > 0 && (
              <details style={{ fontSize: 12.5 }}>
                <summary style={{ cursor: 'pointer' }}>
                  <Badge tone="warn">{res.warnings.length}</Badge> ескерту
                </summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, maxHeight: 140, overflow: 'auto' }}>
                  {res.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="mono muted">{w.row}-жол:</span> {w.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Жоспарды сол пән жүретін басқа сыныптарға / топтарға көшіру. */
function CopyModal({ p, onClose, onDone }: { p: Plan; onClose: () => void; onDone: () => void }) {
  const { ref, subjectsOf, groupsOf } = useReference();
  const toast = useToast();
  const options = ref.classes
    .filter((c) => subjectsOf(c.id).some((s) => s.id === p.subjectId))
    .flatMap((c) => {
      const gs = groupsOf(c.id, p.subjectId);
      return gs.length ? gs.map((g) => ({ key: `${c.id}:${g.id}`, classId: c.id, groupId: g.id, label: `${c.name} (${g.name})`, grade: c.grade })) : [{ key: `${c.id}:0`, classId: c.id, groupId: null as number | null, label: c.name, grade: c.grade }];
    })
    .filter((o) => !(o.classId === p.classId && (o.groupId ?? null) === (p.groupId ?? null)));
  const [sel, setSel] = useState<Set<string>>(() => new Set(options.filter((o) => o.grade === p.grade && o.classId !== p.classId).map((o) => o.key)));
  const [all, setAll] = useState(false);
  const [withDates, setWithDates] = useState(false);
  const run = useMutation({
    mutationFn: () => api.post<{ copied: string[]; lessons: number }>('/plan/copy', { ...base(p), allQuarters: all, withDates, targets: options.filter((o) => sel.has(o.key)).map((o) => ({ classId: o.classId, groupId: o.groupId })) }),
    onSuccess: (r) => {
      toast(`Көшірілді: ${r.copied.join(', ')}`);
      onDone();
      onClose();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const toggle = (k: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  return (
    <Modal
      open
      size="sm"
      title="Жоспарды көшіру"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Болдырмау
          </button>
          <button className="btn primary" disabled={!sel.size || run.isPending} onClick={() => run.mutate()}>
            {run.isPending && <Spinner />} Көшіру ({sel.size})
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>
          {p.className}{p.groupName ? ` (${p.groupName})` : ''} · {p.subject} жоспары таңдалған сыныптарға көшіріледі. Олардағы сол тоқсанның бар жоспары ауыстырылады.
        </div>
        {!options.length ? (
          <Empty>Бұл пән жүретін басқа сынып жоқ.</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6, maxHeight: 240, overflow: 'auto' }}>
            {options.map((o) => (
              <label key={o.key} className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={sel.has(o.key)} onChange={() => toggle(o.key)} />
                {o.label}
              </label>
            ))}
          </div>
        )}
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Барлық тоқсанды көшіру (әйтпесе тек {p.quarter}-тоқсан)
        </label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={withDates} onChange={(e) => setWithDates(e.target.checked)} />
          Күндерін де көшіру (кестелері бірдей болса)
        </label>
      </div>
    </Modal>
  );
}

function JournalSync({ p, count, onClose, onDone }: { p: Plan; count: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const run = useMutation({
    mutationFn: () => api.post<{ created: number; updated: number }>('/plan/journal', { ...base(p), untilToday: true }),
    onSuccess: (r) => {
      toast(`Журналға ${r.created} баған қосылды${r.updated ? `, ${r.updated} бағанға тақырып жазылды` : ''}`);
      onDone();
      onClose();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <ConfirmDialog
      open
      title="Журналға шығару"
      text={
        <>
          Жоспардағы бүгінге дейінгі <b>{count}</b> күнге журналда баған (сабақ) жоқ. Сол күндерге тақырыбымен баған қосылады; тақырыбы бос бар бағандарға жоспардағы тақырып жазылады.
        </>
      }
      confirmLabel="Қосу"
      busy={run.isPending}
      onConfirm={() => run.mutate()}
      onClose={onClose}
    />
  );
}
