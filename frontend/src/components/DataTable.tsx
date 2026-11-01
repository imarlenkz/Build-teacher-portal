import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Spinner } from './ui';

export type Col<T> = ColumnDef<T, unknown> & { meta?: { align?: 'num' | 'center'; className?: string; label?: string } };

interface Props<T> {
  id: string;
  columns: Col<T>[];
  data: T[];
  loading?: boolean;
  /** Server-side режим: total + page/pageSize/sort сыртта басқарылады. */
  server?: {
    total: number;
    page: number;
    pageSize: number;
    sort?: string;
    dir?: 'asc' | 'desc';
    onChange: (s: { page?: number; pageSize?: number; sort?: string; dir?: 'asc' | 'desc' }) => void;
  };
  pageSize?: number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  empty?: ReactNode;
  toolbar?: ReactNode;
  pageSizes?: number[];
  hideFooter?: boolean;
}

/**
 * DataTable — сұрыптау, пагинация, баған көрінісі (localStorage-та сақталады), server-side режим.
 */
export function DataTable<T>({ id, columns, data, loading, server, pageSize = 25, onRowClick, rowClassName, empty, toolbar, pageSizes = [25, 50, 100], hideFooter }: Props<T>) {
  const { t } = useTranslation();
  const storeKey = `ustaz.cols.${id}`;
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => localStorage.setItem(storeKey, JSON.stringify(visibility)), [visibility, storeKey]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const serverSorting = useMemo<SortingState>(() => (server?.sort ? [{ id: server.sort, desc: server.dir === 'desc' }] : []), [server?.sort, server?.dir]);

  const table = useReactTable({
    data,
    columns,
    state: {
      columnVisibility: visibility,
      sorting: server ? serverSorting : sorting,
      ...(server ? { pagination: { pageIndex: server.page - 1, pageSize: server.pageSize } } : { pagination }),
    },
    onColumnVisibilityChange: setVisibility,
    onSortingChange: (up) => {
      const next = typeof up === 'function' ? up(server ? serverSorting : sorting) : up;
      if (server) server.onChange({ sort: next[0]?.id, dir: next[0]?.desc ? 'desc' : 'asc', page: 1 });
      else setSorting(next);
    },
    onPaginationChange: (up) => {
      if (server) {
        const next = typeof up === 'function' ? up({ pageIndex: server.page - 1, pageSize: server.pageSize }) : up;
        server.onChange({ page: next.pageIndex + 1, pageSize: next.pageSize });
      } else setPagination(up);
    },
    manualSorting: !!server,
    manualPagination: !!server,
    pageCount: server ? Math.max(1, Math.ceil(server.total / server.pageSize)) : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getPaginationRowModel: server || hideFooter ? undefined : getPaginationRowModel(),
    sortDescFirst: false,
  });

  const total = server ? server.total : data.length;
  const ps = server ? server.pageSize : pagination.pageSize;
  const page = server ? server.page : pagination.pageIndex + 1;
  const from = total ? (page - 1) * ps + 1 : 0;
  const to = Math.min(total, page * ps);
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const rows = table.getRowModel().rows;

  return (
    <div className="card flush">
      {(toolbar || hideable.length > 0) && (
        <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', justifyContent: 'space-between' }}>
          <div className="row">{toolbar}</div>
          {hideable.length > 0 && (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button className="btn sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="true">
                ☰ {t('common.columns')}
              </button>
              {menu && (
                <div className="col-menu" role="menu">
                  {hideable.map((c) => (
                    <label key={c.id}>
                      <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                      {(c.columnDef.meta as Col<T>['meta'])?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const meta = h.column.columnDef.meta as Col<T>['meta'];
                  const can = h.column.getCanSort();
                  const s = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={`${can ? 'sortable' : ''} ${meta?.align ?? ''}`}
                      onClick={can ? h.column.getToggleSortingHandler() : undefined}
                      onKeyDown={can ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), h.column.toggleSorting()) : undefined}
                      tabIndex={can ? 0 : undefined}
                      aria-sort={s === 'asc' ? 'ascending' : s === 'desc' ? 'descending' : undefined}
                      style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {s === 'asc' ? ' ↑' : s === 'desc' ? ' ↓' : ''}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={columns.length} style={{ border: 0 }}>
                  <Spinner block />
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={columns.length} style={{ border: 0 }}>
                  <div className="empty">{empty ?? t('common.empty')}</div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className={`${onRowClick ? 'clickable' : ''} ${rowClassName?.(r.original) ?? ''}`}
                  onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r.original) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  style={loading ? { opacity: 0.6 } : undefined}
                >
                  {r.getVisibleCells().map((c) => {
                    const meta = c.column.columnDef.meta as Col<T>['meta'];
                    return (
                      <td key={c.id} className={`${meta?.align ?? ''} ${meta?.className ?? ''}`}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!hideFooter && (
        <div className="table-foot">
          <span className="mono">
            {from}–{to} / {total} · {page}-{t('common.page')}
          </span>
          <div className="row">
            <select
              className="select"
              style={{ height: 28 }}
              value={ps}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              aria-label="Беттегі жол саны"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n} / бет
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              ← {t('common.prev')}
            </button>
            <button className="btn sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              {t('common.next')} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
