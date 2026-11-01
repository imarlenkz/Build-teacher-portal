import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebounced } from '../hooks';
import { levelColor } from '../lib/format';
import type { AttendanceStatus, Level } from '../api/types';

export function Card({ title, sub, action, children, className = '', flush }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`}>
      {(title || action) && (
        <div className="card-head" style={flush ? { padding: '14px 16px 0' } : undefined}>
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** DashboardCard — KPI карточкасы. */
export function DashboardCard({ label, value, sub, tone, onClick }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void }) {
  const inner = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone ? `c-${tone}` : ''}`}>{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
    </>
  );
  return onClick ? (
    <button type="button" className="kpi" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="kpi">{inner}</div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, error, hint, children, className = '' }: { label: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ title, open, onClose, children, footer, size }: { title: ReactNode; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'lg' }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, select, textarea, button.primary')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-head">
          <h2 className="modal-title" id={id}>
            {title}
          </h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Жабу">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, text, confirmLabel, danger, busy, onConfirm, onClose }: { open: boolean; title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className={`btn primary ${danger ? 'danger solid' : ''}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.5 }}>{text}</div>
    </Modal>
  );
}

export function Spinner({ block }: { block?: boolean }) {
  return block ? (
    <div className="loading-block">
      <span className="spinner" aria-label="Жүктелуде" />
    </div>
  ) : (
    <span className="spinner" aria-label="Жүктелуде" />
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="empty">
      <div className="err-box" style={{ display: 'inline-block', marginBottom: 8 }}>
        {(error as Error)?.message ?? 'Қате'}
      </div>
      {onRetry && (
        <div>
          <button className="btn" onClick={onRetry}>
            Қайталау
          </button>
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Badge({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function LevelBadge({ name, index, levels }: { name: string | null; index: number | null; levels?: Level[] }) {
  if (!name || index == null) return <span className="muted">—</span>;
  return <Badge tone={levelColor(index, levels?.length ?? 4)}>{name}</Badge>;
}

export function SearchInput({ value, onChange, placeholder, delay = 300 }: { value: string; onChange: (v: string) => void; placeholder?: string; delay?: number }) {
  const [v, setV] = useState(value);
  const d = useDebounced(v, delay);
  useEffect(() => {
    if (d !== value) onChange(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  useEffect(() => setV(value), [value]);
  return <input className="input search" type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;
}

export function DateRangePicker({ from, to, onChange, min, max }: { from?: string; to?: string; onChange: (r: { from?: string; to?: string }) => void; min?: string; max?: string }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <input className="input" type="date" value={from ?? ''} min={min} max={to || max} onChange={(e) => onChange({ from: e.target.value || undefined, to })} aria-label="Басы" />
      <span className="muted">–</span>
      <input className="input" type="date" value={to ?? ''} min={from || min} max={max} onChange={(e) => onChange({ from, to: e.target.value || undefined })} aria-label="Соңы" />
    </div>
  );
}

/** FilterPanel — сүзгілер жолағы (мобильде бағанға жиналады). */
export function FilterPanel({ children, onClear, active }: { children: ReactNode; onClear?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="filters">
      {children}
      {onClear && active && (
        <button className="btn ghost" onClick={onClear}>
          {t('common.clear')}
        </button>
      )}
    </div>
  );
}

export function ExportMenu({ onExport, formats = ['xlsx', 'csv'], label }: { onExport: (f: string) => Promise<void> | void; formats?: string[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  const names: Record<string, string> = { pdf: 'PDF', xlsx: 'Excel (.xlsx)', csv: 'CSV' };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={busy}>
        {busy ? <Spinner /> : '⤓'} {label ?? 'Экспорт'}
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 170, padding: 4 }}>
          {formats.map((f) => (
            <button
              key={f}
              className="menu-item"
              onClick={async () => {
                setOpen(false);
                setBusy(true);
                try {
                  await onExport(f);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {names[f] ?? f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ST_ORDER: AttendanceStatus[] = ['P', 'N', 'S', 'A', 'K'];
const ST_SHORT: Record<string, string> = { P: '✓', N: 'Н', S: 'С', A: 'А', K: 'К', O: 'Б' };

export function StatusButtons({ value, onChange, name, withOther }: { value: AttendanceStatus | null; onChange: (s: AttendanceStatus) => void; name: string; withOther?: boolean }) {
  const { t } = useTranslation();
  const list = withOther ? [...ST_ORDER, 'O' as const] : ST_ORDER;
  return (
    <div className="st-group" role="radiogroup" aria-label={name}>
      {list.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-pressed={value === s}
          title={t(`status.${s}`)}
          aria-label={`${name}: ${t(`status.${s}`)}`}
          className={`st-btn st-${s}`}
          onClick={() => onChange(s)}
        >
          {ST_SHORT[s]}
        </button>
      ))}
    </div>
  );
}

export function BarRow({ label, value, max = 100, color = 'acc', display }: { label: ReactNode; value: number; max?: number; color?: string; display?: ReactNode }) {
  return (
    <div className="bar-row">
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div className="bar">
        <span style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, background: `var(--${color})` }} />
      </div>
      <span className="v">{display ?? value}</span>
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, className = '', ariaLabel, disabled }: { value: string | number | undefined | null; onChange: (v: string) => void; options: { value: string | number; label: string }[]; placeholder?: string; className?: string; ariaLabel?: string; disabled?: boolean }) {
  return (
    <select className={`select ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel ?? placeholder} disabled={disabled}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
