import { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';

/** AnalyticsChart — Recharts-қа жұқа қабат: дизайн токендеріне сай түстер, шкала және tooltip. */
export interface Series {
  key: string;
  name: string;
  color: string; // токен атауы: acc, ok, bad, warn, vio
}

const c = (t: string) => `var(--${t})`;

function Tip({ active, payload, label, suffix = '' }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label != null && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="row" style={{ gap: 6 }}>
          <span className="sq" style={{ background: p.color }} />
          {p.name}: <b className="mono">{p.value == null ? '—' : `${p.value}${suffix}`}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.name}>
          <span className="sq" style={{ background: c(i.color) }} />
          {i.name}
          {i.value != null && <b className="mono">{i.value}</b>}
        </span>
      ))}
    </div>
  );
}

export function AreaTrend({ data, x, series, height = 200, domain, suffix = '%' }: { data: object[]; x: string; series: Series[]; height?: number; domain?: [number | string, number | string]; suffix?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={x} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis domain={domain ?? ['auto', 'auto']} tickLine={false} axisLine={false} width={50} />
        <Tooltip content={<Tip suffix={suffix} />} />
        {series.map((s) => (
          <Area key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={c(s.color)} fill={c(`${s.color}s`)} strokeWidth={2} isAnimationActive={false} dot={data.length < 16} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrend({ data, x, series, height = 240, domain = [0, 100], suffix = '%' }: { data: object[]; x: string; series: Series[]; height?: number; domain?: [number, number]; suffix?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={x} tickLine={false} axisLine={false} />
        <YAxis domain={domain} tickLine={false} axisLine={false} width={50} />
        <Tooltip content={<Tip suffix={suffix} />} />
        {series.map((s) => (
          <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={c(s.color)} strokeWidth={2} dot={{ r: 4, fill: c(s.color) }} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, series, height = 220, domain, suffix = '', horizontal, stacked, labels }: { data: object[]; x: string; series: Series[]; height?: number; domain?: [number | string, number | string]; suffix?: string; horizontal?: boolean; stacked?: boolean; labels?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: labels ? 16 : 6, right: 8, left: horizontal ? 0 : -18, bottom: 0 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} domain={domain} />
            <YAxis type="category" dataKey={x} tickLine={false} axisLine={false} width={150} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tickLine={false} axisLine={false} interval={0} />
            <YAxis tickLine={false} axisLine={false} domain={domain} width={50} />
          </>
        )}
        <Tooltip content={<Tip suffix={suffix} />} cursor={{ fill: 'var(--soft)' }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={c(s.color)} radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={28} stackId={stacked ? 'a' : undefined} isAnimationActive={false}>
            {labels && <LabelList dataKey={s.key} position={horizontal ? 'right' : 'top'} formatter={(v: number) => (v == null ? '—' : `${v}${suffix}`)} className="recharts-text" />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, size = 120, center }: { data: { name: string; value: number; color: string }[]; size?: number; center?: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={size * 0.32} outerRadius={size / 2} stroke="none" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={c(d.color)} />
            ))}
          </Pie>
          <Tooltip content={<Tip />} />
        </PieChart>
      </ResponsiveContainer>
      {center != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontWeight: 600, pointerEvents: 'none' }}>{center}</div>
      )}
    </div>
  );
}

export function PieBlock({ data, size = 180 }: { data: { name: string; value: number; color: string }[]; size?: number }) {
  return (
    <ResponsiveContainer width="100%" height={size}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={size / 2 - 8} stroke="var(--panel)" strokeWidth={2} isAnimationActive={false} label={({ value }) => value} labelLine={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={c(d.color)} />
          ))}
        </Pie>
        <Tooltip content={<Tip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export const PALETTE = ['acc', 'ok', 'warn', 'vio', 'bad', 'muted'];
