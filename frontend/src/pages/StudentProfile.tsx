import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { StudentProfile as SP } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { dot, initials, MONTHS_CAP, MOVEMENT_COLOR, pct, STATUS_COLOR, weekdayOf } from '../lib/format';
import { Badge, Card, ConfirmDialog, DashboardCard, Empty, ErrorState, LevelBadge, Spinner } from '../components/ui';
import { StudentForm } from '../components/StudentForm';
import { Bars } from '../components/charts';

interface Hist {
  id: number;
  date: string;
  type: string;
  typeName: string;
  fromClass: string | null;
  toClass: string | null;
  fromSchool: string | null;
  toSchool: string | null;
  reason: string;
  orderNumber: string;
  orderDate: string | null;
  comment: string | null;
}
interface AttMonth {
  month: string;
  days: Record<string, { period: number; subject: string; status: string }[]>;
  byMonth: { month: string; pct: number; total: number }[];
  bySubject: { subject: string; pct: number; total: number }[];
}
interface AssessRow {
  id: number;
  assessmentId: number;
  type: 'BJB' | 'TJB';
  title: string;
  section: string | null;
  subject: string;
  quarter: number;
  schoolYear: string;
  score: number;
  maxScore: number;
  pct: number;
  absent: boolean;
  level: string | null;
  levelIndex: number | null;
}

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Оқиды', LEFT: 'Басқа мектепке кетті', EXPELLED: 'Шығарылды' };

export default function StudentProfile() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const { ref } = useReference();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'history' | 'att' | 'assess'>('history');
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState(false);
  const [iin, setIin] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api.get<SP>(`/students/${id}`) });
  const reveal = useMutation({
    mutationFn: () => api.post<{ iin: string }>(`/students/${id}/iin/reveal`),
    onSuccess: (r) => {
      setIin(r.iin);
      setTimeout(() => setIin(null), 30_000);
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/students/${id}`),
    onSuccess: () => {
      toast('Оқушы жойылды');
      void qc.invalidateQueries({ queryKey: ['students'] });
      nav('/students');
    },
    onError: (e: Error) => toast(e.message, 'error'),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner block />;
  const s = q.data;
  const a = s.attendance;

  return (
    <div>
      <div className="page-head">
        <Link to="/students" className="btn">
          ← Оқушылар
        </Link>
        <h1 className="page-title">{s.fullName}</h1>
        {s.status !== 'ACTIVE' && <Badge tone="bad">{STATUS_LABEL[s.status]}</Badge>}
        <span className="grow" />
        {can(PERM.MOVEMENTS) && (
          <Link className="btn" to={`/movements?new=${s.id}`}>
            + Қозғалыс
          </Link>
        )}
        {can(PERM.STUDENTS_WRITE) && (
          <button className="btn" onClick={() => setEditing(true)}>
            Өзгерту
          </button>
        )}
        {can(PERM.CLASSES) && (
          <button className="btn danger" onClick={() => setDel(true)}>
            Жою
          </button>
        )}
      </div>
      <div className="profile-layout">
        <Card>
          <div className="row" style={{ gap: 12, marginBottom: 16 }}>
            <div className="avatar" style={{ width: 52, height: 52, fontSize: 17, borderRadius: 12 }}>
              {initials(s.fullName)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{s.fullName}</div>
              <div className="muted">
                {s.className ?? '—'} сынып · <span className="mono">{s.studentCode}</span>
              </div>
            </div>
          </div>
          <dl className="info-grid">
            <dt>Жынысы</dt>
            <dd>{s.gender === 'M' ? 'Ұл' : 'Қыз'}</dd>
            <dt>Туған күні</dt>
            <dd className="mono">{dot(s.birthDate)}</dd>
            {s.nationality !== undefined && (
              <>
                <dt>Ұлты</dt>
                <dd>{s.nationality ?? '—'}</dd>
              </>
            )}
            <dt>Сыныбы</dt>
            <dd>{s.className ?? '—'}</dd>
            <dt>Оқу жылы</dt>
            <dd>{s.schoolYear}</dd>
            <dt>Оқушы ID</dt>
            <dd className="mono">{s.studentCode}</dd>
            <dt>ЖСН</dt>
            <dd className="row" style={{ gap: 6 }}>
              <span className="mono">{iin ?? s.iinMasked ?? '—'}</span>
              {s.canRevealIin && !iin && (
                <button className="btn sm" onClick={() => reveal.mutate()} disabled={reveal.isPending} title="Әр ашу аудит журналына жазылады">
                  Көрсету
                </button>
              )}
              {iin && (
                <button className="btn sm" onClick={() => setIin(null)}>
                  Жасыру
                </button>
              )}
            </dd>
            <dt>Телефон</dt>
            <dd>{s.phone ? <a href={`tel:${s.phone.replace(/\s/g, '')}`}>{s.phone}</a> : '—'}</dd>
            <dt>Ата-анасы</dt>
            <dd>{s.parentName ?? '—'}</dd>
            <dt>Байланыс</dt>
            <dd>{s.parentPhone ? <a href={`tel:${s.parentPhone.replace(/\s/g, '')}`}>{s.parentPhone}</a> : '—'}</dd>
            <dt>Келген күні</dt>
            <dd className="mono">{dot(s.enrolledAt)}</dd>
            <dt>Бұрынғы мектебі</dt>
            <dd>{s.previousSchool ?? '—'}</dd>
            {s.notes && (
              <>
                <dt>Қосымша</dt>
                <dd>{s.notes}</dd>
              </>
            )}
          </dl>
          {s.parentPhone && (
            <a className="btn primary mobile-only" style={{ marginTop: 14, width: '100%' }} href={`tel:${s.parentPhone.replace(/\s/g, '')}`}>
              Ата-анасына қоңырау шалу
            </a>
          )}
        </Card>
        <div className="stack">
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <DashboardCard label="Қатысу" value={pct(a.pct)} tone={a.pct != null && a.pct < ref.attendanceThreshold ? 'bad' : 'ok'} sub={`${a.total} сабақ`} />
            <DashboardCard label="Себепті" value={a.excused} tone="warn" sub={`оның ішінде ауру ${a.sick}`} />
            <DashboardCard label="Себепсіз" value={a.unexcused} tone="bad" />
            <DashboardCard label="Кешігу" value={a.late} tone="acc" />
          </div>
          <Card>
            <div className="tabs" role="tablist">
              {(
                [
                  ['history', 'Қозғалыс тарихы'],
                  ['att', 'Қатысу тарихы'],
                  ['assess', 'БЖБ / ТЖБ'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {l}
                </button>
              ))}
            </div>
            {tab === 'history' && <History id={id} enrolled={s.enrolledAt} />}
            {tab === 'att' && <AttendanceHistory id={id} />}
            {tab === 'assess' && <AssessHistory id={id} />}
          </Card>
        </div>
      </div>
      <StudentForm open={editing} onClose={() => setEditing(false)} student={s} />
      <ConfirmDialog
        open={del}
        danger
        title="Оқушыны жою"
        text={
          <>
            <b>{s.fullName}</b> жүйеден жойылады. Мектептен кетуді тіркеу үшін «Оқушы қозғалысы» бөлімін қолданған дұрыс. Жоюды растайсыз ба?
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

function History({ id, enrolled }: { id: number; enrolled: string | null }) {
  const q = useQuery({ queryKey: ['student', id, 'history'], queryFn: () => api.get<Hist[]>(`/students/${id}/history`) });
  if (!q.data) return <Spinner block />;
  if (!q.data.length)
    return (
      <Empty>
        Қозғалыс тіркелмеген. Мектепке келген күні: <span className="mono">{dot(enrolled)}</span>
      </Empty>
    );
  return (
    <div className="timeline">
      {q.data.map((m) => (
        <div className="tl-item" key={m.id}>
          <span className="tl-dot" style={{ background: `var(--${MOVEMENT_COLOR[m.type]})` }} />
          <div>
            <div className="row" style={{ gap: 8 }}>
              <b>{m.typeName}</b>
              <span className="mono muted">{dot(m.date)}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {[m.fromClass || m.fromSchool, m.toClass || m.toSchool].some(Boolean) && `${m.fromClass ?? m.fromSchool ?? '—'} → ${m.toClass ?? m.toSchool ?? '—'} · `}
              {m.reason} · бұйрық {m.orderNumber}
              {m.orderDate && ` (${dot(m.orderDate)})`}
              {m.comment && ` · ${m.comment}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AttendanceHistory({ id }: { id: number }) {
  const { ref } = useReference();
  const [month, setMonth] = useState(ref.today.slice(0, 7));
  const q = useQuery({ queryKey: ['student', id, 'att', month], queryFn: () => api.get<AttMonth>(`/students/${id}/attendance`, { month }), placeholderData: (p) => p });
  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = weekdayOf(`${month}-01`);
  const cells: (string | null)[] = [...Array(first - 1).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <div className="stack">
      <div className="row">
        <button className="btn sm" onClick={() => shift(-1)} aria-label="Алдыңғы ай">
          ←
        </button>
        <b style={{ minWidth: 120, textAlign: 'center' }}>
          {MONTHS_CAP[m - 1]} {y}
        </b>
        <button className="btn sm" onClick={() => shift(1)} disabled={month >= ref.today.slice(0, 7)} aria-label="Келесі ай">
          →
        </button>
        <span className="grow" />
        <span className="legend">
          {['P', 'N', 'S', 'A', 'K'].map((s) => (
            <span key={s}>
              <span className="sq" style={{ background: `var(--${STATUS_COLOR[s]})` }} />
              {{ P: 'Қатысты', N: 'Себепсіз', S: 'Себепті', A: 'Ауру', K: 'Кешікті' }[s]}
            </span>
          ))}
        </span>
      </div>
      <div className="att-grid" role="grid" aria-label="Ай бойынша қатысу">
        {['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс'].map((d) => (
          <div key={d} className="cal-h">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const list = q.data?.days[d] ?? [];
          const wd = weekdayOf(d);
          const bad = list.filter((x) => x.status !== 'P');
          return (
            <div key={d} className={`att-cell ${!list.length ? 'off' : ''}`} title={list.map((x) => `${x.period}. ${x.subject}: ${{ P: 'қатысты', N: 'себепсіз', S: 'себепті', A: 'ауру', K: 'кешікті', O: 'басқа' }[x.status]}`).join('\n')} style={wd === 7 ? { opacity: 0.5 } : undefined}>
              <span className="d">{Number(d.slice(8))}</span>
              {list.length > 0 && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {(bad.length ? bad : list.slice(0, 1)).slice(0, 3).map((x, j) => (
                    <span key={j} className="dot" style={{ background: `var(--${STATUS_COLOR[x.status]})`, width: 6, height: 6 }} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Ай бойынша
          </div>
          <Bars data={(q.data?.byMonth ?? []).map((b) => ({ label: MONTHS_CAP[Number(b.month.slice(5)) - 1].slice(0, 3), pct: b.pct }))} x="label" series={[{ key: 'pct', name: 'Қатысу', color: 'acc' }]} domain={[0, 100]} suffix="%" height={160} labels />
        </div>
        <div>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Пән бойынша
          </div>
          <table className="tbl">
            <tbody>
              {(q.data?.bySubject ?? []).map((b) => (
                <tr key={b.subject}>
                  <td>{b.subject}</td>
                  <td className="num">{b.total}</td>
                  <td className={`num ${b.pct < ref.attendanceThreshold ? 'c-bad' : ''}`}>{pct(b.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AssessHistory({ id }: { id: number }) {
  const { ref } = useReference();
  const q = useQuery({ queryKey: ['student', id, 'assess'], queryFn: () => api.get<AssessRow[]>(`/students/${id}/assessments`) });
  if (!q.data) return <Spinner block />;
  if (!q.data.length) return <Empty>Бағалау нәтижесі жоқ</Empty>;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Оқу жылы</th>
            <th>Тоқсан</th>
            <th>Түрі</th>
            <th>Пән</th>
            <th>Атауы</th>
            <th className="num">Балл</th>
            <th className="num">%</th>
            <th>Деңгей</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((r) => (
            <tr key={r.id}>
              <td className="mono muted">{r.schoolYear}</td>
              <td>{['I', 'II', 'III', 'IV'][r.quarter - 1]}</td>
              <td>
                <Badge tone={r.type === 'TJB' ? 'vio' : 'acc'}>{r.type === 'TJB' ? 'ТЖБ' : 'БЖБ'}</Badge>
              </td>
              <td>{r.subject}</td>
              <td>
                {r.title}
                {r.section && <span className="muted"> · {r.section}</span>}
              </td>
              <td className="num">{r.absent ? 'жоқ' : `${r.score}/${r.maxScore}`}</td>
              <td className="num">{r.absent ? '—' : pct(r.pct)}</td>
              <td>
                <LevelBadge name={r.level} index={r.levelIndex} levels={ref.levels} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
