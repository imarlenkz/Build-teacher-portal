import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Paged, Role } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { dateTime, dot, ROMAN } from '../lib/format';
import { useUrlState } from '../hooks';
import { DataTable, Col } from '../components/DataTable';
import { Badge, Card, ConfirmDialog, DashboardCard, Empty, ErrorState, Field, Modal, SearchInput, Spinner } from '../components/ui';
import { ClassesManager } from './Classes';

type Tab = 'users' | 'classes' | 'subjects' | 'years' | 'schools';

export default function Admin() {
  const { can, me } = useAuth();
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'users', label: 'Пайдаланушылар', show: can(PERM.USERS) },
    { id: 'classes', label: 'Сыныптар', show: can(PERM.CLASSES) },
    { id: 'subjects', label: 'Пәндер', show: can(PERM.CLASSES) },
    { id: 'years', label: 'Оқу жылдары', show: can(PERM.SETTINGS) },
    { id: 'schools', label: 'Мектептер', show: can(PERM.SCHOOLS) },
  ];
  const visible = tabs.filter((t) => t.show);
  const [s, set] = useUrlState({ tab: visible[0]?.id ?? 'classes' });
  const tab = (visible.some((t) => t.id === s.tab) ? s.tab : visible[0]?.id) as Tab;
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Жүйені басқару</h1>
        <div className="seg" role="tablist">
          {visible.map((t) => (
            <button key={t.id} role="tab" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => set({ tab: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        {tab === 'users' && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Пайдаланушы қосу
          </button>
        )}
      </div>
      {tab === 'users' && <Users adding={adding} setAdding={setAdding} schoolName={me?.school?.shortName ?? ''} />}
      {tab === 'classes' && <ClassesManager />}
      {tab === 'subjects' && <Subjects />}
      {tab === 'years' && <Years />}
      {tab === 'schools' && <Schools />}
    </div>
  );
}

interface UserRow {
  id: number;
  fullName: string;
  login: string;
  title: string | null;
  role: Role;
  roleLabel: string;
  status: 'ACTIVE' | 'BLOCKED';
  lastLoginAt: string | null;
  homeroom: string[];
  lessons: number;
  isSelf: boolean;
}
const ROLES: { value: Role; label: string }[] = [
  { value: 'TEACHER', label: 'Мұғалім' },
  { value: 'SCHOOL_ADMIN', label: 'Мектеп әкімшілігі' },
  { value: 'ADMIN', label: 'Жүйе әкімшісі' },
];
const PASSWORD = /^(?=.*[A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүҺһІі])(?=.*\d).{8,128}$/;

function Users({ adding, setAdding, schoolName }: { adding: boolean; setAdding: (v: boolean) => void; schoolName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, set] = useUrlState({ tab: 'users', search: '', role: '', status: '', page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
  const query = { search: s.search, role: s.role || undefined, status: s.status || undefined, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir };
  const q = useQuery({ queryKey: ['admin-users', query], queryFn: () => api.get<Paged<UserRow>>('/admin/users', query), placeholderData: keepPreviousData });
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get<{ schools: number; users: number; students: number; activeLast7d: number; byRole: { role: string; label: string; count: number }[] }>('/admin/stats') });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
    qc.invalidateQueries({ queryKey: ['teachers'] });
  };
  const update = useMutation({
    mutationFn: ({ id, ...b }: { id: number; role?: Role; status?: string }) => api.put(`/admin/users/${id}`, b),
    onSuccess: () => (inv(), toast('Сақталды')),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const [del, setDel] = useState<UserRow | null>(null);
  const [pw, setPw] = useState<UserRow | null>(null);
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/users/${id}`),
    onSuccess: () => (inv(), setDel(null), toast('Пайдаланушы жойылды')),
    onError: (e) => toast((e as Error).message, 'error'),
  });

  const columns = useMemo<Col<UserRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Пайдаланушы',
        enableHiding: false,
        cell: ({ row: { original: u } }) => (
          <div>
            <div style={{ fontWeight: 500 }}>
              {u.fullName} {u.isSelf && <Badge tone="acc">сіз</Badge>}
            </div>
            <div className="id">
              {u.login}
              {u.title ? ` · ${u.title}` : ''}
            </div>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Рөл',
        enableSorting: false,
        meta: { label: 'Рөл' },
        cell: ({ row: { original: u } }) => (
          <select className="select" value={u.role} disabled={u.isSelf || update.isPending} onClick={(e) => e.stopPropagation()} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as Role })} aria-label={`${u.fullName} рөлі`}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        ),
      },
      {
        id: 'load',
        header: 'Жүктеме',
        enableSorting: false,
        meta: { label: 'Жүктеме' },
        cell: ({ row: { original: u } }) => (
          <span className="muted">
            {u.lessons ? `${u.lessons} пән-сынып` : '—'}
            {u.homeroom.length ? ` · жетекші ${u.homeroom.join(', ')}` : ''}
          </span>
        ),
      },
      { id: 'lastLogin', header: 'Соңғы кіру', meta: { label: 'Соңғы кіру' }, cell: ({ row: { original: u } }) => <span className="mono muted">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'кірмеген'}</span> },
      {
        id: 'status',
        header: 'Күйі',
        enableSorting: false,
        meta: { label: 'Күйі' },
        cell: ({ row: { original: u } }) => (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <button
              className="switch"
              role="switch"
              aria-checked={u.status === 'ACTIVE'}
              aria-label={`${u.fullName}: ${u.status === 'ACTIVE' ? 'белсенді' : 'бұғатталған'}`}
              disabled={u.isSelf || update.isPending}
              onClick={() => update.mutate({ id: u.id, status: u.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' })}
            />
            <span className={u.status === 'ACTIVE' ? 'c-ok' : 'c-bad'} style={{ fontSize: 12 }}>
              {u.status === 'ACTIVE' ? 'белсенді' : 'бұғатталған'}
            </span>
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        meta: { align: 'num' },
        cell: ({ row: { original: u } }) => (
          <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <button className="btn sm" onClick={() => setPw(u)}>
              Құпиясөз
            </button>
            {!u.isSelf && (
              <button className="btn sm c-bad" onClick={() => setDel(u)}>
                Жою
              </button>
            )}
          </span>
        ),
      },
    ],
    [update],
  );

  return (
    <div className="stack">
      {stats.data && (
        <div className="kpis">
          <DashboardCard label="Белсенді пайдаланушы" value={stats.data.users} sub={stats.data.byRole.map((r) => `${r.label} ${r.count}`).join(' · ')} />
          <DashboardCard label="Соңғы 7 күнде кірген" value={stats.data.activeLast7d} tone="acc" />
          <DashboardCard label="Белсенді оқушы" value={stats.data.students} tone="ok" />
          <DashboardCard label="Мектептер" value={stats.data.schools} tone="vio" />
        </div>
      )}
      <div className="filters">
        <SearchInput value={s.search} onChange={(v) => set({ search: v, page: 1 })} placeholder="Аты-жөні немесе логин" />
        <select className="select" value={s.role} onChange={(e) => set({ role: e.target.value, page: 1 })} aria-label="Рөл">
          <option value="">Барлық рөл</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select className="select" value={s.status} onChange={(e) => set({ status: e.target.value, page: 1 })} aria-label="Күйі">
          <option value="">Барлық күй</option>
          <option value="ACTIVE">Белсенді</option>
          <option value="BLOCKED">Бұғатталған</option>
        </select>
        <span className="muted">
          {q.data?.total ?? 0} пайдаланушы · {schoolName}
        </span>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          id="admin-users"
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isFetching}
          server={{ total: q.data?.total ?? 0, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir as 'asc' | 'desc', onChange: (c) => set({ ...c }) }}
        />
      )}
      {adding && <UserForm onClose={() => setAdding(false)} onSaved={inv} />}
      {pw && <PasswordReset u={pw} onClose={() => setPw(null)} />}
      <ConfirmDialog
        open={!!del}
        danger
        title="Пайдаланушыны жою"
        text={
          <>
            <b>{del?.fullName}</b> жүйеге кіре алмайды. Ол енгізген деректер мен аудит жазбалары сақталады.
          </>
        }
        confirmLabel="Жою"
        busy={remove.isPending}
        onConfirm={() => del && remove.mutate(del.id)}
        onClose={() => setDel(null)}
      />
    </div>
  );
}

function UserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', login: '', password: '', role: 'TEACHER' as Role, title: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const up = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErr((e) => ({ ...e, [k]: '', form: '' }));
  };
  const save = useMutation({
    mutationFn: () => api.post('/admin/users', { ...f, title: f.title || undefined }),
    onSuccess: () => {
      toast('Пайдаланушы қосылды');
      onSaved();
      onClose();
    },
    onError: (e) => setErr({ form: e instanceof ApiError ? e.message : 'Қате' }),
  });
  const genPassword = () => {
    const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    const d = '23456789';
    const buf = new Uint32Array(10);
    crypto.getRandomValues(buf);
    const p = Array.from(buf.slice(0, 8), (x) => a[x % a.length]).join('') + d[buf[8] % d.length] + d[buf[9] % d.length];
    up('password', p);
  };
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.fullName.trim().length < 5) e.fullName = 'Аты-жөні кемінде 5 таңба';
    if (!/^[a-z0-9._]{3,32}$/.test(f.login.trim().toLowerCase())) e.login = 'Латын кіші әріптері, сан, нүкте, астын сызу (3–32)';
    if (!PASSWORD.test(f.password)) e.password = 'Кемінде 8 таңба, әріп пен сан болуы керек';
    setErr(e);
    if (!Object.values(e).some(Boolean)) save.mutate();
  };
  return (
    <Modal
      open
      title="Пайдаланушы қосу"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>
            {save.isPending && <Spinner />} Қосу
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Аты-жөні" error={err.fullName} className="full">
          <input className="input" value={f.fullName} maxLength={120} onChange={(e) => up('fullName', e.target.value)} placeholder="Ахметова Гүлнар Серікқызы" />
        </Field>
        <Field label="Логин" error={err.login}>
          <input className="input mono" value={f.login} maxLength={32} autoComplete="off" onChange={(e) => up('login', e.target.value.toLowerCase())} />
        </Field>
        <Field label="Рөл">
          <select className="select" value={f.role} onChange={(e) => up('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Бастапқы құпиясөз" error={err.password} hint="Пайдаланушыға жеке беріңіз; кіргеннен кейін өзгерте алады">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input mono" value={f.password} autoComplete="new-password" onChange={(e) => up('password', e.target.value)} />
            <button className="btn" type="button" onClick={genPassword}>
              Жасау
            </button>
          </div>
        </Field>
        <Field label="Лауазымы / пәні">
          <input className="input" value={f.title} maxLength={120} onChange={(e) => up('title', e.target.value)} placeholder="Математика пәні мұғалімі" />
        </Field>
      </div>
      {err.form && (
        <div className="err-box" style={{ marginTop: 10 }}>
          {err.form}
        </div>
      )}
    </Modal>
  );
}

function PasswordReset({ u, onClose }: { u: UserRow; onClose: () => void }) {
  const toast = useToast();
  const [p, setP] = useState('');
  const ok = PASSWORD.test(p);
  const save = useMutation({
    mutationFn: () => api.post(`/admin/users/${u.id}/password`, { password: p }),
    onSuccess: () => {
      toast('Құпиясөз жаңартылды · барлық сессиялар жабылды');
      onClose();
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <Modal
      open
      size="sm"
      title="Құпиясөзді қалпына келтіру"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" disabled={!ok || save.isPending} onClick={() => save.mutate()}>
            Сақтау
          </button>
        </>
      }
    >
      <Field label={`${u.fullName} · жаңа құпиясөз`} error={p && !ok ? 'Кемінде 8 таңба, әріп пен сан болуы керек' : null}>
        <input className="input mono" value={p} autoComplete="new-password" onChange={(e) => setP(e.target.value)} />
      </Field>
    </Modal>
  );
}

function Subjects() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-subjects'], queryFn: () => api.get<{ id: number; name: string; assignments: number; assessments: number }[]>('/admin/subjects') });
  const [name, setName] = useState('');
  const [del, setDel] = useState<{ id: number; name: string } | null>(null);
  const inv = () => ['admin-subjects', 'reference'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const add = useMutation({
    mutationFn: () => api.post('/admin/subjects', { name: name.trim() }),
    onSuccess: () => (inv(), setName(''), toast('Пән қосылды')),
    onError: (e) => toast(e instanceof ApiError && e.status === 409 ? 'Мұндай пән бар' : (e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admin/subjects/${id}`),
    onSuccess: () => (inv(), setDel(null), toast('Пән жойылды')),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <Card flush>
      <div className="row" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && add.mutate()} placeholder="Жаңа пән атауы" aria-label="Жаңа пән атауы" />
        <button className="btn primary" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>
          + Қосу
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Пән</th>
            <th className="num">Сыныптар</th>
            <th className="num">БЖБ/ТЖБ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data!.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="num">{s.assignments}</td>
              <td className="num">{s.assessments}</td>
              <td className="num">
                <button className="btn sm c-bad" disabled={s.assignments > 0 || s.assessments > 0} title={s.assignments || s.assessments ? 'Пән қолданыста — алдымен сыныптардан алып тастаңыз' : undefined} onClick={() => setDel(s)}>
                  Жою
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog open={!!del} danger title="Пәнді жою" text={<>«{del?.name}» пәні жойылады.</>} confirmLabel="Жою" busy={remove.isPending} onConfirm={() => del && remove.mutate(del.id)} onClose={() => setDel(null)} />
    </Card>
  );
}

interface YearRow {
  id: number;
  name: string;
  isCurrent: boolean;
  startDate: string;
  endDate: string;
  classes: number;
  quarters: { id: number; number: number; startDate: string; endDate: string; reportDueDate: string | null }[];
}

function Years() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-years'], queryFn: () => api.get<YearRow[]>('/admin/years') });
  const [adding, setAdding] = useState(false);
  const [cur, setCur] = useState<YearRow | null>(null);
  const setCurrent = useMutation({
    mutationFn: (id: number) => api.put(`/admin/years/${id}/current`),
    onSuccess: () => {
      qc.invalidateQueries();
      setCur(null);
      toast('Ағымдағы оқу жылы өзгертілді');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Оқу жылын қосу
        </button>
      </div>
      <div className="grid-auto">
        {q.data!.map((y) => (
          <Card
            key={y.id}
            title={
              <span className="row">
                {y.name} {y.isCurrent && <Badge tone="ok">ағымдағы</Badge>}
              </span>
            }
            sub={`${dot(y.startDate)} – ${dot(y.endDate)} · ${y.classes} сынып`}
            action={
              !y.isCurrent ? (
                <button className="btn sm" onClick={() => setCur(y)}>
                  Ағымдағы ету
                </button>
              ) : undefined
            }
          >
            <table className="tbl">
              <thead>
                <tr>
                  <th>Тоқсан</th>
                  <th>Кезең</th>
                  <th>Есеп мерзімі</th>
                </tr>
              </thead>
              <tbody>
                {y.quarters.map((qq) => (
                  <tr key={qq.id}>
                    <td>{ROMAN[qq.number - 1]}</td>
                    <td className="mono">
                      {dot(qq.startDate)} – {dot(qq.endDate)}
                    </td>
                    <td className="mono">{dot(qq.reportDueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      {adding && <YearForm existing={q.data!} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={!!cur}
        title="Ағымдағы оқу жылы"
        text={<>«{cur?.name}» ағымдағы оқу жылы болады. Барлық пайдаланушыларда сыныптар, қатысу және бағалау осы жылға ауысады.</>}
        busy={setCurrent.isPending}
        onConfirm={() => cur && setCurrent.mutate(cur.id)}
        onClose={() => setCur(null)}
      />
    </div>
  );
}

function YearForm({ existing, onClose }: { existing: YearRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const last = existing[0];
  const startY = last ? Number(last.name.slice(0, 4)) + 1 : new Date().getFullYear();
  // ҚР стандартты күнтізбесі бойынша ұсыныс; әкімші өзгерте алады.
  const [name, setName] = useState(`${startY}–${startY + 1}`);
  const [qs, setQs] = useState(
    [
      [`${startY}-09-01`, `${startY}-10-30`],
      [`${startY}-11-09`, `${startY}-12-30`],
      [`${startY + 1}-01-12`, `${startY + 1}-03-20`],
      [`${startY + 1}-03-30`, `${startY + 1}-05-25`],
    ].map(([a, b]) => ({ startDate: a, endDate: b, reportDueDate: b })),
  );
  const [isCurrent, setIsCurrent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post('/admin/years', { name, quarters: qs.map((q) => ({ ...q, reportDueDate: q.reportDueDate || undefined })), isCurrent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-years'] });
      qc.invalidateQueries({ queryKey: ['reference'] });
      toast('Оқу жылы қосылды');
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Қате'),
  });
  const submit = () => {
    setErr(null);
    if (!/^\d{4}–\d{4}$/.test(name)) return setErr('Атауы: 2027–2028 форматында');
    for (let i = 0; i < 4; i++) {
      if (!qs[i].startDate || !qs[i].endDate) return setErr(`${i + 1}-тоқсан күндерін толтырыңыз`);
      if (qs[i].startDate > qs[i].endDate) return setErr(`${i + 1}-тоқсан: басы соңынан кейін`);
      if (i && qs[i].startDate <= qs[i - 1].endDate) return setErr(`${i + 1}-тоқсан алдыңғы тоқсанмен қабаттасады`);
    }
    save.mutate();
  };
  return (
    <Modal
      open
      title="Оқу жылын қосу"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>
            Қосу
          </button>
        </>
      }
    >
      <Field label="Атауы">
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value.replace('-', '–'))} />
      </Field>
      <table className="tbl" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Тоқсан</th>
            <th>Басы</th>
            <th>Соңы</th>
            <th>Есеп мерзімі</th>
          </tr>
        </thead>
        <tbody>
          {qs.map((q, i) => (
            <tr key={i}>
              <td>{ROMAN[i]}</td>
              {(['startDate', 'endDate', 'reportDueDate'] as const).map((k) => (
                <td key={k}>
                  <input className="input" type="date" value={q[k]} onChange={(e) => setQs((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} aria-label={`${ROMAN[i]} тоқсан ${k}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <label className="row" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} /> Бірден ағымдағы оқу жылы ету
      </label>
      {err && (
        <div className="err-box" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}

interface SchoolRow {
  id: number;
  name: string;
  shortName: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  students: number;
  teachers: number;
  classes: number;
}

function Schools() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['admin-schools'], queryFn: () => api.get<SchoolRow[]>('/admin/schools') });
  const [edit, setEdit] = useState<SchoolRow | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (s: SchoolRow) => api.put(`/admin/schools/${s.id}`, { name: s.name, shortName: s.shortName, city: s.city ?? undefined, address: s.address ?? undefined, isActive: !s.isActive }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-schools'] }), qc.invalidateQueries({ queryKey: ['me'] }), toast('Сақталды')),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Платформа бірнеше мектепті қолдайды: әр мектептің деректері бөлек сақталады. Мектепке ауысу — жоғарғы панельдегі мектеп таңдағышы арқылы.</span>
        <button className="btn primary" onClick={() => setEdit('new')}>
          + Мектеп қосу
        </button>
      </div>
      {!q.data!.length ? (
        <Empty>Мектеп жоқ</Empty>
      ) : (
        <div className="grid-auto">
          {q.data!.map((s) => (
            <Card
              key={s.id}
              title={
                <span className="row">
                  {s.shortName} {me?.school?.id === s.id && <Badge tone="acc">ағымдағы</Badge>} {!s.isActive && <Badge tone="bad">өшірілген</Badge>}
                </span>
              }
              sub={[s.name, s.city, s.address].filter(Boolean).join(' · ')}
              action={
                <button className="btn sm" onClick={() => setEdit(s)}>
                  Өңдеу
                </button>
              }
            >
              <div className="mini-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <div className="mini-kpi">
                  <div className="l">Оқушы</div>
                  <div className="v">{s.students}</div>
                </div>
                <div className="mini-kpi">
                  <div className="l">Мұғалім</div>
                  <div className="v">{s.teachers}</div>
                </div>
                <div className="mini-kpi">
                  <div className="l">Сынып</div>
                  <div className="v">{s.classes}</div>
                </div>
              </div>
              <label className="row" style={{ marginTop: 10 }}>
                <button className="switch" role="switch" aria-checked={s.isActive} disabled={toggle.isPending || me?.school?.id === s.id} onClick={() => toggle.mutate(s)} aria-label="Белсенді" />
                <span style={{ fontSize: 12.5 }}>Белсенді</span>
              </label>
            </Card>
          ))}
        </div>
      )}
      {edit && <SchoolForm s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SchoolForm({ s, onClose }: { s: SchoolRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: s?.name ?? '', shortName: s?.shortName ?? '', city: s?.city ?? '', address: s?.address ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), shortName: f.shortName.trim(), city: f.city.trim() || undefined, address: f.address.trim() || undefined, ...(s ? { isActive: s.isActive } : {}) };
      return s ? api.put(`/admin/schools/${s.id}`, body) : api.post('/admin/schools', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-schools'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast(s ? 'Сақталды' : 'Мектеп қосылды');
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Қате'),
  });
  const submit = () => {
    if (f.name.trim().length < 3) return setErr('Толық атауы кемінде 3 таңба');
    if (f.shortName.trim().length < 2) return setErr('Қысқа атауы кемінде 2 таңба');
    save.mutate();
  };
  return (
    <Modal
      open
      title={s ? 'Мектепті өңдеу' : 'Мектеп қосу'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>
            Сақтау
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Толық атауы" className="full">
          <input className="input" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="№7 жалпы білім беретін мектеп" />
        </Field>
        <Field label="Қысқа атауы">
          <input className="input" value={f.shortName} maxLength={60} onChange={(e) => setF({ ...f, shortName: e.target.value })} placeholder="№7 мектеп" />
        </Field>
        <Field label="Қала / аудан">
          <input className="input" value={f.city} maxLength={80} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </Field>
        <Field label="Мекенжайы" className="full">
          <input className="input" value={f.address} maxLength={200} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
      {!s && <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>Жаңа мектепке стандартты деңгейлер мен баптаулар автоматты түрде жасалады.</div>}
      {err && (
        <div className="err-box" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}
