import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Paged } from '../api/types';
import { useReference } from '../lib/reference';
import { dateTime } from '../lib/format';
import { useUrlState } from '../hooks';
import { DataTable, Col } from '../components/DataTable';
import { Badge, DateRangePicker, ErrorState, FilterPanel, SearchInput } from '../components/ui';

interface AuditRow {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  ip: string | null;
}

const ENTITIES: Record<string, string> = {
  attendance: 'Қатысу',
  student: 'Оқушы',
  movement: 'Қозғалыс',
  assessment: 'БЖБ / ТЖБ',
  quarter_report: 'Тоқсандық есеп',
  level_ranges: 'Деңгейлер',
  school_settings: 'Мектеп баптауы',
  class: 'Сынып',
  subject: 'Пән',
  user: 'Пайдаланушы',
  school: 'Мектеп',
  school_year: 'Оқу жылы',
  backup: 'Резервтік көшірме',
  external_result: 'Тестілеу',
};

const show = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${x == null ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
      .join('; ');
  return '';
};

/** Аудит журналы: кім, қашан, не істеді, ескі және жаңа мән. Тек оқу үшін — жазбаларды өзгерту мүмкін емес. */
export default function Audit() {
  const { ref } = useReference();
  const [s, set] = useUrlState({ search: '', entity: '', from: '', to: '', page: 1, pageSize: 50 });
  const query = { search: s.search, entity: s.entity || undefined, from: s.from || undefined, to: s.to || undefined, page: s.page, pageSize: s.pageSize };
  const q = useQuery({ queryKey: ['audit', query], queryFn: () => api.get<Paged<AuditRow>>('/audit', query), placeholderData: keepPreviousData });
  const columns = useMemo<Col<AuditRow>[]>(
    () => [
      { id: 'at', header: 'Уақыты', enableSorting: false, meta: { label: 'Уақыты' }, cell: ({ row: { original: r } }) => <span className="mono" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.at)}</span> },
      {
        id: 'actor',
        header: 'Кім',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row: { original: r } }) => (
          <div>
            <div style={{ fontWeight: 500 }}>{r.actorName}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{r.actorRole}</div>
          </div>
        ),
      },
      {
        id: 'action',
        header: 'Әрекет',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row: { original: r } }) => (
          <div>
            <div>{r.action}</div>
            <div className="muted" style={{ fontSize: 12 }}>{r.summary}</div>
          </div>
        ),
      },
      { id: 'entity', header: 'Нысан', enableSorting: false, meta: { label: 'Нысан' }, cell: ({ row: { original: r } }) => <Badge>{ENTITIES[r.entity] ?? r.entity}</Badge> },
      {
        id: 'change',
        header: 'Ескі → жаңа мән',
        enableSorting: false,
        meta: { label: 'Ескі → жаңа мән' },
        cell: ({ row: { original: r } }) => {
          const b = show(r.before);
          const a = show(r.after);
          if (!b && !a) return <span className="muted">—</span>;
          return (
            <div style={{ maxWidth: 360, fontSize: 12.5 }}>
              {b && <span className="diff-old">{b}</span>}
              {b && a && <span className="muted"> → </span>}
              {a && <span className="diff-new">{a}</span>}
            </div>
          );
        },
      },
      { id: 'ip', header: 'IP', enableSorting: false, meta: { label: 'IP' }, cell: ({ row: { original: r } }) => <span className="mono muted">{r.ip ?? '—'}</span> },
    ],
    [],
  );
  const active = !!(s.search || s.entity || s.from || s.to);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Аудит журналы</h1>
        <span className="page-sub">{q.data ? `${q.data.total} жазба` : ''}</span>
      </div>
      <FilterPanel active={active} onClear={() => set({ search: '', entity: '', from: '', to: '', page: 1 })}>
        <SearchInput value={s.search} onChange={(v) => set({ search: v, page: 1 })} placeholder="Пайдаланушы, әрекет немесе мазмұн" />
        <select className="select" value={s.entity} onChange={(e) => set({ entity: e.target.value, page: 1 })} aria-label="Нысан">
          <option value="">Барлық нысан</option>
          {Object.entries(ENTITIES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <DateRangePicker from={s.from || undefined} to={s.to || undefined} max={ref.today} onChange={(r) => set({ from: r.from ?? '', to: r.to ?? '', page: 1 })} />
      </FilterPanel>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          id="audit"
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isFetching}
          pageSizes={[50, 100]}
          server={{ total: q.data?.total ?? 0, page: s.page, pageSize: s.pageSize, onChange: (c) => set({ page: c.page ?? s.page, pageSize: c.pageSize ?? s.pageSize }) }}
        />
      )}
    </div>
  );
}
