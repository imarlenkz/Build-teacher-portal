import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, download } from '../api/client';
import type { Paged, StudentRow } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot, pct } from '../lib/format';
import { useIsMobile, useUrlState } from '../hooks';
import { DataTable, Col } from '../components/DataTable';
import { ErrorState, ExportMenu, FilterPanel, LevelBadge, SearchInput, Segmented, Spinner } from '../components/ui';
import { StudentForm } from '../components/StudentForm';
import { StudentImport } from '../components/StudentImport';

export default function Students() {
  const { ref, quarterId } = useReference();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [s, set] = useUrlState({ search: '', classId: 0, gender: '', nationalityId: 0, status: 'ACTIVE', page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
  const query = {
    search: s.search,
    classId: s.classId || undefined,
    gender: s.gender || undefined,
    nationalityId: s.nationalityId || undefined,
    status: s.status,
    page: s.page,
    pageSize: s.pageSize,
    sort: s.sort,
    dir: s.dir,
    quarterId,
  };
  const q = useQuery({ queryKey: ['students', query], queryFn: () => api.get<Paged<StudentRow>>('/students', query), placeholderData: keepPreviousData });
  const canNat = can(PERM.NATIONALITY);
  const thr = ref.attendanceThreshold;

  const columns = useMemo<Col<StudentRow>[]>(
    () => [
      { id: 'no', header: '№', enableSorting: false, enableHiding: false, size: 44, cell: (c) => <span className="mono muted">{(s.page - 1) * s.pageSize + c.row.index + 1}</span> },
      {
        id: 'name',
        header: 'Аты-жөні',
        enableHiding: false,
        cell: ({ row: { original: r } }) => (
          <div>
            <div style={{ fontWeight: 500 }}>{r.fullName}</div>
            <div className="id">{r.studentCode}</div>
          </div>
        ),
      },
      { id: 'class', header: 'Сынып', accessorKey: 'className', meta: { label: 'Сынып' } },
      { id: 'gender', header: 'Жынысы', accessorFn: (r) => (r.gender === 'M' ? 'Ұл' : 'Қыз'), meta: { label: 'Жынысы' } },
      { id: 'birth', header: 'Туған күні', accessorFn: (r) => dot(r.birthDate), meta: { align: 'num', label: 'Туған күні' } },
      ...(canNat ? [{ id: 'nationality', header: 'Ұлты', accessorKey: 'nationality', meta: { label: 'Ұлты' } } as Col<StudentRow>] : []),
      {
        id: 'att',
        header: 'Қатысу',
        meta: { align: 'num', label: 'Қатысу' },
        cell: ({ row: { original: r } }) => <span className={r.attPct != null && r.attPct < thr ? 'c-bad' : ''} style={{ fontWeight: r.attPct != null && r.attPct < thr ? 600 : 400 }}>{pct(r.attPct)}</span>,
      },
      { id: 'tjb', header: 'ТЖБ %', meta: { align: 'num', label: 'ТЖБ %' }, cell: ({ row: { original: r } }) => pct(r.tjbPct) },
      { id: 'level', header: 'Деңгей', enableSorting: false, meta: { label: 'Деңгей' }, cell: ({ row: { original: r } }) => <LevelBadge name={r.level} index={r.levelIndex} levels={ref.levels} /> },
    ],
    [s.page, s.pageSize, canNat, thr, ref.levels],
  );

  const exportFile = async (format: string) => {
    try {
      await download('/students/export', { ...query, format, page: undefined, pageSize: undefined });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const active = !!(s.search || s.classId || s.gender || s.nationalityId || s.status !== 'ACTIVE');

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Оқушылар</h1>
        <span className="page-sub">{q.data ? `${q.data.total} оқушы` : ''}</span>
        <span className="grow" />
        {can(PERM.EXPORT) && <ExportMenu onExport={exportFile} formats={['csv', 'xlsx']} />}
        {can(PERM.STUDENTS_WRITE) && can(PERM.CLASSES) && (
          <button className="btn" onClick={() => setImporting(true)}>
            Excel-ден импорттау
          </button>
        )}
        {can(PERM.STUDENTS_WRITE) && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Оқушы қосу
          </button>
        )}
      </div>
      {isMobile && (
        <div className="row" style={{ overflowX: 'auto', flexWrap: 'nowrap', marginBottom: 10 }}>
          {[{ id: 0, name: 'Барлығы' }, ...ref.classes].map((c) => (
            <button key={c.id} className={`btn sm ${s.classId === c.id ? 'primary' : ''}`} style={{ height: 36, flex: 'none' }} onClick={() => set({ classId: c.id, page: 1 })}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <FilterPanel active={active} onClear={() => set({ search: '', classId: 0, gender: '', nationalityId: 0, status: 'ACTIVE', page: 1 })}>
        <SearchInput value={s.search} onChange={(v) => set({ search: v, page: 1 })} placeholder="Аты-жөні немесе ID бойынша іздеу" />
        {!isMobile && (
          <select className="select" value={s.classId} onChange={(e) => set({ classId: Number(e.target.value), page: 1 })} aria-label="Сынып">
            <option value={0}>Барлық сынып</option>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
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
        {canNat && ref.nationalities && (
          <select className="select" value={s.nationalityId} onChange={(e) => set({ nationalityId: Number(e.target.value), page: 1 })} aria-label="Ұлт">
            <option value={0}>Барлық ұлт</option>
            {ref.nationalities.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        )}
        <select className="select" value={s.status} onChange={(e) => set({ status: e.target.value, page: 1 })} aria-label="Күйі">
          <option value="ACTIVE">Оқып жатқандар</option>
          <option value="LEFT">Басқа мектепке кеткендер</option>
          <option value="EXPELLED">Шығарылғандар</option>
          <option value="ALL">Барлығы</option>
        </select>
      </FilterPanel>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : isMobile ? (
        !q.data ? (
          <Spinner block />
        ) : (
          <div className="m-list">
            {q.data.items.map((r) => (
              <button key={r.id} className="m-card m-row" onClick={() => nav(`/students/${r.id}`)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14.5 }}>{r.fullName}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {r.className} · қатысу <span className={r.attPct != null && r.attPct < thr ? 'c-bad' : ''}>{pct(r.attPct)}</span> · ТЖБ {pct(r.tjbPct)}
                  </div>
                </div>
                <LevelBadge name={r.level} index={r.levelIndex} />
              </button>
            ))}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" disabled={s.page <= 1} onClick={() => set({ page: s.page - 1 })}>
                ← Алдыңғы
              </button>
              <span className="mono muted">
                {s.page} / {Math.max(1, Math.ceil(q.data.total / s.pageSize))}
              </span>
              <button className="btn" disabled={s.page * s.pageSize >= q.data.total} onClick={() => set({ page: s.page + 1 })}>
                Келесі →
              </button>
            </div>
          </div>
        )
      ) : (
        <DataTable
          id="students"
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isFetching}
          onRowClick={(r) => nav(`/students/${r.id}`)}
          server={{ total: q.data?.total ?? 0, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir as 'asc' | 'desc', onChange: (x) => set(x) }}
          empty="Сүзгіге сай оқушы табылмады"
        />
      )}
      <StudentForm open={creating} onClose={() => setCreating(false)} onSaved={(id) => nav(`/students/${id}`)} />
      {importing && <StudentImport onClose={() => setImporting(false)} />}
    </div>
  );
}
