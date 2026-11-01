import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, download } from '../api/client';
import type { MovementType, Paged, StudentProfile, StudentRow } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot, MONTHS_CAP, MOVEMENT_COLOR } from '../lib/format';
import { useDebounced, useUrlState } from '../hooks';
import { DataTable, Col } from '../components/DataTable';
import { Badge, Card, DashboardCard, ErrorState, ExportMenu, Field, FilterPanel, Modal, SearchInput, Segmented, Spinner } from '../components/ui';
import { Bars, Legend, PieBlock, PALETTE } from '../components/charts';

interface MovementRow {
  id: number;
  date: string;
  type: MovementType;
  typeName: string;
  student: { id: number; fullName: string; studentCode: string; gender: 'M' | 'F' };
  fromClass: string | null;
  toClass: string | null;
  fromSchool: string | null;
  toSchool: string | null;
  reason: string;
  orderNumber: string;
  orderDate: string | null;
  comment: string | null;
  createdBy: string | null;
}

interface MovementStats {
  total: number;
  arrived: number;
  left: number;
  transferred: number;
  boys: number;
  girls: number;
  byType: { code: MovementType; name: string; dir: string; count: number }[];
  byMonth: { month: string; in: number; out: number; move: number }[];
  byNationality?: { name: string; count: number }[];
}

export default function Movements() {
  const { ref, quarterId: curQuarter, year } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [s, set] = useUrlState({ search: '', classId: 0, type: '', gender: '', quarterId: 0, page: 1, pageSize: 25, sort: 'date', dir: 'desc' });
  const newFor = Number(sp.get('new')) || null;
  const [open, setOpen] = useState<boolean>(!!newFor);
  useEffect(() => {
    if (newFor) setOpen(true);
  }, [newFor]);

  // quarterId=0 → бүкіл оқу жылы; URL-да жоқ болса ағымдағы тоқсан емес, жыл көрсетіледі.
  const filter = {
    search: s.search,
    classId: s.classId || undefined,
    type: s.type || undefined,
    gender: s.gender || undefined,
    quarterId: s.quarterId || undefined,
    schoolYearId: year.id,
  };
  const listQ = { ...filter, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir };
  const list = useQuery({ queryKey: ['movements', listQ], queryFn: () => api.get<Paged<MovementRow>>('/movements', listQ), placeholderData: keepPreviousData });
  const stats = useQuery({ queryKey: ['movements-stats', filter], queryFn: () => api.get<MovementStats>('/movements/stats', filter), placeholderData: keepPreviousData });

  const columns = useMemo<Col<MovementRow>[]>(
    () => [
      { id: 'date', header: 'Күні', meta: { align: 'num', label: 'Күні' }, cell: ({ row: { original: m } }) => <span className="mono">{dot(m.date)}</span> },
      {
        id: 'student',
        header: 'Оқушы',
        enableHiding: false,
        cell: ({ row: { original: m } }) => (
          <Link to={`/students/${m.student.id}`} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{m.student.fullName}</div>
            <div className="id">{m.student.studentCode}</div>
          </Link>
        ),
      },
      { id: 'type', header: 'Түрі', meta: { label: 'Түрі' }, cell: ({ row: { original: m } }) => <Badge tone={MOVEMENT_COLOR[m.type]}>{m.typeName}</Badge> },
      {
        id: 'route',
        header: 'Қайдан → қайда',
        enableSorting: false,
        meta: { label: 'Қайдан → қайда' },
        cell: ({ row: { original: m } }) => (
          <span>
            {m.fromClass ?? m.fromSchool ?? '—'} <span className="muted">→</span> {m.toClass ?? m.toSchool ?? '—'}
          </span>
        ),
      },
      { id: 'reason', header: 'Себебі', enableSorting: false, meta: { label: 'Себебі' }, cell: ({ row: { original: m } }) => <span title={m.comment ?? undefined}>{m.reason}</span> },
      {
        id: 'order',
        header: 'Бұйрық',
        enableSorting: false,
        meta: { label: 'Бұйрық' },
        cell: ({ row: { original: m } }) => (
          <span className="mono">
            {m.orderNumber}
            {m.orderDate && <span className="muted"> · {dot(m.orderDate)}</span>}
          </span>
        ),
      },
      { id: 'comment', header: 'Түсініктеме', enableSorting: false, meta: { label: 'Түсініктеме' }, cell: ({ row: { original: m } }) => <span className="muted">{m.comment ?? '—'}</span> },
      { id: 'createdBy', header: 'Енгізген', enableSorting: false, meta: { label: 'Енгізген' }, cell: ({ row: { original: m } }) => <span className="muted">{m.createdBy ?? '—'}</span> },
    ],
    [],
  );

  const exportFile = async (format: string) => {
    try {
      await download('/movements/export', { ...filter, format, sort: s.sort, dir: s.dir });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const closeModal = () => {
    setOpen(false);
    if (newFor) {
      const n = new URLSearchParams(sp);
      n.delete('new');
      setSp(n, { replace: true });
    }
  };

  const st = stats.data;
  const active = !!(s.search || s.classId || s.type || s.gender || s.quarterId);
  const periodLabel = s.quarterId ? `${year.quarters.find((q) => q.id === s.quarterId)?.number ?? ''}-тоқсан` : `${year.name} оқу жылы`;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Оқушы қозғалысы</h1>
        <span className="page-sub">{periodLabel}</span>
        <span className="grow" />
        {can(PERM.EXPORT) && <ExportMenu onExport={exportFile} />}
        {can(PERM.MOVEMENTS) && (
          <button className="btn primary" onClick={() => setOpen(true)}>
            + Қозғалыс енгізу
          </button>
        )}
      </div>

      <div className="kpis k4" style={{ marginBottom: 14 }}>
        <DashboardCard label="Барлық қозғалыс" value={st?.total ?? '—'} sub={`ұл ${st?.boys ?? 0} · қыз ${st?.girls ?? 0}`} />
        <DashboardCard label="Келді / қабылданды" value={st?.arrived ?? '—'} tone="ok" />
        <DashboardCard label="Кетті / шығарылды" value={st?.left ?? '—'} tone="bad" />
        <DashboardCard label="Сынып ауыстырды" value={st?.transferred ?? '—'} tone="acc" />
      </div>

      {st && (
        <div className="grid-auto" style={{ marginBottom: 14 }}>
          <Card title="Түрі бойынша">
            <div className="stack" style={{ gap: 6 }}>
              {st.byType.map((t) => (
                <button key={t.code} className="bar-row" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={() => set({ type: s.type === t.code ? '' : t.code, page: 1 })} aria-pressed={s.type === t.code}>
                  <span style={{ fontWeight: s.type === t.code ? 600 : 400 }}>{t.name}</span>
                  <div className="bar">
                    <span style={{ width: `${st.total ? (t.count / Math.max(...st.byType.map((x) => x.count), 1)) * 100 : 0}%`, background: `var(--${MOVEMENT_COLOR[t.code]})` }} />
                  </div>
                  <span className="v">{t.count}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Айлар бойынша">
            {st.byMonth.length ? (
              <>
                <Bars
                  height={180}
                  data={st.byMonth.map((m) => ({ ...m, label: MONTHS_CAP[Number(m.month.slice(5)) - 1].slice(0, 3) }))}
                  x="label"
                  stacked
                  series={[
                    { key: 'in', name: 'Келді', color: 'ok' },
                    { key: 'out', name: 'Кетті', color: 'bad' },
                    { key: 'move', name: 'Ауысты', color: 'acc' },
                  ]}
                />
                <Legend items={[{ name: 'Келді', color: 'ok' }, { name: 'Кетті', color: 'bad' }, { name: 'Ауысты', color: 'acc' }]} />
              </>
            ) : (
              <div className="empty">Қозғалыс жоқ</div>
            )}
          </Card>
          <Card title="Жынысы бойынша">
            {st.total ? (
              <>
                <PieBlock size={160} data={[{ name: 'Ұл', value: st.boys, color: 'acc' }, { name: 'Қыз', value: st.girls, color: 'vio' }]} />
                <Legend items={[{ name: 'Ұл', color: 'acc', value: st.boys }, { name: 'Қыз', color: 'vio', value: st.girls }]} />
              </>
            ) : (
              <div className="empty">Қозғалыс жоқ</div>
            )}
          </Card>
          {st.byNationality && (
            <Card title="Ұлты бойынша" sub="Тек әкімшілікке көрінеді">
              {st.byNationality.length ? (
                <>
                  <PieBlock size={160} data={st.byNationality.map((n, i) => ({ name: n.name, value: n.count, color: PALETTE[i % PALETTE.length] }))} />
                  <Legend items={st.byNationality.map((n, i) => ({ name: n.name, color: PALETTE[i % PALETTE.length], value: n.count }))} />
                </>
              ) : (
                <div className="empty">Қозғалыс жоқ</div>
              )}
            </Card>
          )}
        </div>
      )}

      <FilterPanel active={active} onClear={() => set({ search: '', classId: 0, type: '', gender: '', quarterId: 0, page: 1 })}>
        <SearchInput value={s.search} onChange={(v) => set({ search: v, page: 1 })} placeholder="Оқушы аты немесе ID" />
        <select className="select" value={s.quarterId} onChange={(e) => set({ quarterId: Number(e.target.value), page: 1 })} aria-label="Кезең">
          <option value={0}>Бүкіл оқу жылы</option>
          {year.quarters.map((q) => (
            <option key={q.id} value={q.id}>
              {q.number}-тоқсан{q.id === curQuarter ? ' (ағымдағы)' : ''}
            </option>
          ))}
        </select>
        <select className="select" value={s.classId} onChange={(e) => set({ classId: Number(e.target.value), page: 1 })} aria-label="Сынып">
          <option value={0}>Барлық сынып</option>
          {ref.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" value={s.type} onChange={(e) => set({ type: e.target.value, page: 1 })} aria-label="Түрі">
          <option value="">Барлық түр</option>
          {ref.movementTypes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
        <Segmented
          value={s.gender}
          onChange={(v) => set({ gender: v, page: 1 })}
          label="Жынысы"
          options={[
            { value: '', label: 'Барлығы' },
            { value: 'M', label: 'Ұл' },
            { value: 'F', label: 'Қыз' },
          ]}
        />
      </FilterPanel>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          id="movements"
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isFetching}
          empty="Таңдалған кезеңде қозғалыс жоқ"
          server={{ total: list.data?.total ?? 0, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir as 'asc' | 'desc', onChange: (c) => set({ ...c }) }}
        />
      )}

      {open && <MovementForm studentId={newFor} onClose={closeModal} />}
    </div>
  );
}

const IN_TYPES: MovementType[] = ['ADMITTED', 'ARRIVED_FROM_SCHOOL', 'READMITTED'];
const OUT_TYPES: MovementType[] = ['LEFT_TO_SCHOOL', 'EXPELLED'];

function allowedTypes(status: string | undefined): MovementType[] {
  if (!status) return [];
  if (status === 'ACTIVE') return ['TRANSFERRED_CLASS', 'LEFT_TO_SCHOOL', 'EXPELLED'];
  return ['READMITTED'];
}

/** Қозғалыс енгізу формасы: оқушыны іздеу → түрі → мәліметтер. Түрлер оқушы мәртебесіне қарай шектеледі. */
function MovementForm({ studentId, onClose }: { studentId: number | null; onClose: () => void }) {
  const { ref } = useReference();
  const qc = useQueryClient();
  const toast = useToast();
  const [sid, setSid] = useState<number | null>(studentId);
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 250);
  const found = useQuery({
    queryKey: ['student-pick', dq],
    queryFn: () => api.get<Paged<StudentRow>>('/students', { search: dq, status: 'ALL', pageSize: 8, page: 1, sort: 'name', dir: 'asc' }),
    enabled: !sid && dq.trim().length >= 2,
  });
  const student = useQuery({ queryKey: ['student', sid], queryFn: () => api.get<StudentProfile>(`/students/${sid}`), enabled: !!sid });
  const types = allowedTypes(student.data?.status);
  const [f, setF] = useState({ type: '' as MovementType | '', date: ref.today, toClassId: '', fromSchool: '', toSchool: '', reason: '', orderNumber: '', orderDate: ref.today, comment: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (student.data && (!f.type || !types.includes(f.type))) setF((x) => ({ ...x, type: types[0] ?? '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.data?.status]);
  const up = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const needsClass = f.type === 'TRANSFERRED_CLASS' || (f.type !== '' && IN_TYPES.includes(f.type));
  const save = useMutation({
    mutationFn: () =>
      api.post('/movements', {
        studentId: sid,
        type: f.type,
        date: f.date,
        toClassId: needsClass ? Number(f.toClassId) : undefined,
        fromSchool: f.type === 'ARRIVED_FROM_SCHOOL' ? f.fromSchool : undefined,
        toSchool: f.type === 'LEFT_TO_SCHOOL' ? f.toSchool : undefined,
        reason: f.reason,
        orderNumber: f.orderNumber,
        orderDate: f.orderDate || undefined,
        comment: f.comment || undefined,
      }),
    onSuccess: () => {
      toast('Қозғалыс сақталды');
      ['movements', 'movements-stats', 'students', 'student', 'dashboard', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!sid) e.student = 'Оқушыны таңдаңыз';
    if (!f.type) e.type = 'Түрін таңдаңыз';
    if (!f.date) e.date = 'Күнін көрсетіңіз';
    else if (f.date > ref.today) e.date = 'Болашақ күн болмайды';
    if (needsClass && !f.toClassId) e.toClassId = 'Сыныпты таңдаңыз';
    if (needsClass && Number(f.toClassId) === student.data?.classId && f.type === 'TRANSFERRED_CLASS') e.toClassId = 'Жаңа сынып бұрынғысымен бірдей';
    if (f.type === 'ARRIVED_FROM_SCHOOL' && !f.fromSchool.trim()) e.fromSchool = 'Бұрынғы мектепті көрсетіңіз';
    if (f.type === 'LEFT_TO_SCHOOL' && !f.toSchool.trim()) e.toSchool = 'Жаңа мектепті көрсетіңіз';
    if (f.reason.trim().length < 2) e.reason = 'Себебі міндетті';
    if (!f.orderNumber.trim()) e.orderNumber = 'Бұйрық нөмірі міндетті';
    if (f.orderDate && f.orderDate > ref.today) e.orderDate = 'Болашақ күн болмайды';
    setErrors(e);
    if (!Object.values(e).some(Boolean)) save.mutate();
  };

  return (
    <Modal
      open
      title="Қозғалыс енгізу"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending || !sid}>
            {save.isPending ? <Spinner /> : null} Сақтау
          </button>
        </>
      }
    >
      {!sid ? (
        <Field label="Оқушы" error={errors.student} hint="Аты-жөні немесе ID бойынша кемінде 2 таңба">
          <input className="input" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Мысалы: Әлиев" />
          {found.isFetching && <Spinner />}
          {found.data && (
            <div className="stack" style={{ gap: 2, marginTop: 6, maxHeight: 260, overflowY: 'auto' }}>
              {found.data.items.length ? (
                found.data.items.map((r) => (
                  <button key={r.id} type="button" className="menu-item" onClick={() => setSid(r.id)}>
                    <b style={{ fontWeight: 500 }}>{r.fullName}</b> <span className="muted">· {r.className ?? '—'} · {r.studentCode}</span>
                    {r.status !== 'ACTIVE' && <Badge tone="bad">{r.status === 'LEFT' ? 'кеткен' : 'шығарылған'}</Badge>}
                  </button>
                ))
              ) : (
                <div className="muted">Табылмады</div>
              )}
            </div>
          )}
        </Field>
      ) : student.isLoading ? (
        <Spinner block />
      ) : student.data ? (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', background: 'var(--soft)', borderRadius: 8, padding: '8px 12px' }}>
            <div>
              <b style={{ fontWeight: 600 }}>{student.data.fullName}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {student.data.className ?? '—'} · {student.data.studentCode} · {student.data.status === 'ACTIVE' ? 'оқиды' : student.data.status === 'LEFT' ? 'мектептен кеткен' : 'шығарылған'}
              </div>
            </div>
            {!studentId && (
              <button className="btn sm ghost" onClick={() => setSid(null)}>
                Ауыстыру
              </button>
            )}
          </div>
          <div className="form-grid">
            <Field label="Қозғалыс түрі" error={errors.type} className="full">
              <div className="row">
                {ref.movementTypes
                  .filter((t) => types.includes(t.code))
                  .map((t) => (
                    <button key={t.code} type="button" className={`btn ${f.type === t.code ? 'primary' : ''}`} onClick={() => up('type', t.code)} aria-pressed={f.type === t.code}>
                      {t.name}
                    </button>
                  ))}
              </div>
            </Field>
            <Field label="Күні" error={errors.date}>
              <input className="input" type="date" max={ref.today} value={f.date} onChange={(e) => up('date', e.target.value)} />
            </Field>
            {needsClass && (
              <Field label="Жаңа сынып" error={errors.toClassId}>
                <select className="select" value={f.toClassId} onChange={(e) => up('toClassId', e.target.value)}>
                  <option value="">Таңдаңыз</option>
                  {ref.classes
                    .filter((c) => c.id !== (f.type === 'TRANSFERRED_CLASS' ? student.data!.classId : -1))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {f.type === 'ARRIVED_FROM_SCHOOL' && (
              <Field label="Бұрынғы мектеп" error={errors.fromSchool}>
                <input className="input" value={f.fromSchool} maxLength={160} onChange={(e) => up('fromSchool', e.target.value)} />
              </Field>
            )}
            {f.type === 'LEFT_TO_SCHOOL' && (
              <Field label="Жаңа мектеп" error={errors.toSchool}>
                <input className="input" value={f.toSchool} maxLength={160} onChange={(e) => up('toSchool', e.target.value)} />
              </Field>
            )}
            <Field label="Бұйрық нөмірі" error={errors.orderNumber}>
              <input className="input" value={f.orderNumber} maxLength={40} onChange={(e) => up('orderNumber', e.target.value)} placeholder="мыс. 145-ө" />
            </Field>
            <Field label="Бұйрық күні" error={errors.orderDate}>
              <input className="input" type="date" max={ref.today} value={f.orderDate} onChange={(e) => up('orderDate', e.target.value)} />
            </Field>
            <Field label="Себебі" error={errors.reason} className="full">
              <input className="input" value={f.reason} maxLength={300} onChange={(e) => up('reason', e.target.value)} placeholder="мыс. Ата-анасының өтініші бойынша" />
            </Field>
            <Field label="Түсініктеме" className="full">
              <textarea className="textarea" rows={2} value={f.comment} maxLength={1000} onChange={(e) => up('comment', e.target.value)} />
            </Field>
          </div>
          {f.type && OUT_TYPES.includes(f.type) && <div className="insight">Сақтағаннан кейін оқушы белсенді тізімнен шығады, бірақ барлық тарихы сақталады.</div>}
        </div>
      ) : (
        <ErrorState error={student.error} />
      )}
    </Modal>
  );
}
