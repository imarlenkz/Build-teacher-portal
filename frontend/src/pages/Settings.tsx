import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, download } from '../api/client';
import type { Level } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import { bytes, dateTime, levelColor } from '../lib/format';
import { Badge, Card, ConfirmDialog, Empty, ErrorState, Field, Segmented, Spinner } from '../components/ui';

export default function Settings() {
  const { can } = useAuth();
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Баптаулар</h1>
      </div>
      <div className="grid-auto" style={{ alignItems: 'start' }}>
        <LevelsCard canEdit={can(PERM.LEVELS)} />
        <div className="stack">
          <Personal />
          {can(PERM.SETTINGS) && <SchoolCard />}
        </div>
      </div>
      {can(PERM.BACKUP) && <Backups />}
      {can(PERM.SETTINGS) && <RolesMatrix />}
    </div>
  );
}

type EditLevel = { name: string; fromPct: string; toPct: string };

/** Клиенттегі тексеру серверлік validateLevels-пен бірдей: 0–100 толық, саңылаусыз, қиылыссыз. */
function validate(levels: { name: string; fromPct: number; toPct: number }[]): string | null {
  if (levels.length < 2 || levels.length > 6) return 'Деңгей саны 2–6 аралығында болуы керек';
  const s = [...levels].sort((a, b) => a.fromPct - b.fromPct);
  if (s[0].fromPct !== 0) return 'Бірінші деңгей 0%-дан басталуы керек';
  if (s[s.length - 1].toPct !== 100) return 'Соңғы деңгей 100%-бен аяқталуы керек';
  for (let i = 0; i < s.length; i++) {
    const l = s[i];
    if (!l.name.trim()) return 'Деңгей атауы бос болмауы керек';
    if (Number.isNaN(l.fromPct) || Number.isNaN(l.toPct)) return 'Пайыз сан болуы керек';
    if (l.fromPct > l.toPct) return `«${l.name}»: басы соңынан үлкен`;
    if (i > 0) {
      const p = s[i - 1];
      if (l.fromPct <= p.toPct) return `«${p.name}» мен «${l.name}» қиылысады`;
      if (l.fromPct !== p.toPct + 1) return `«${p.name}» мен «${l.name}» арасында саңылау бар`;
    }
  }
  if (new Set(s.map((l) => l.name.trim())).size !== s.length) return 'Деңгей атаулары қайталанбауы керек';
  return null;
}

function LevelsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ levels: Level[]; settings: { attendanceThreshold: number } }>('/settings') });
  const [rows, setRows] = useState<EditLevel[]>([]);
  useEffect(() => {
    if (q.data) setRows(q.data.levels.map((l) => ({ name: l.name, fromPct: String(l.fromPct), toPct: String(l.toPct) })));
  }, [q.data]);
  const parsed = rows.map((r) => ({ name: r.name, fromPct: Number(r.fromPct), toPct: Number(r.toPct) }));
  const err = rows.length ? validate(parsed) : null;
  const dirty = q.data ? JSON.stringify(parsed) !== JSON.stringify(q.data.levels.map((l) => ({ name: l.name, fromPct: l.fromPct, toPct: l.toPct }))) : false;
  const save = useMutation({
    mutationFn: () => api.put('/settings/levels', { levels: parsed }),
    onSuccess: () => {
      toast('Деңгейлер сақталды · барлық көрсеткіш қайта есептеледі');
      ['settings', 'reference', 'dashboard', 'assessment', 'report', 'an-yearly'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });
  const up = (i: number, k: keyof EditLevel, v: string) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: k === 'name' ? v : v.replace(/[^0-9]/g, '').slice(0, 3) } : r)));

  return (
    <Card title="Білім деңгейлерінің диапазоны" sub="ТЖБ/БЖБ деңгейі, сапа және үлгерім осы шкала бойынша есептеледі">
      {q.isLoading ? (
        <Spinner block />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
            {parsed.map((l, i) => (
              <span key={i} title={`${l.name}: ${l.fromPct}–${l.toPct}%`} style={{ flex: Math.max(1, (l.toPct || 0) - (l.fromPct || 0) + 1), background: `var(--${levelColor(i, parsed.length)})` }} />
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="sq" style={{ background: `var(--${levelColor(i, rows.length)})`, flex: 'none' }} />
              <input className="input" style={{ flex: 1, minWidth: 0 }} value={r.name} maxLength={30} disabled={!canEdit} onChange={(e) => up(i, 'name', e.target.value)} aria-label="Деңгей атауы" />
              <input className="input mono" style={{ width: 60, textAlign: 'right' }} inputMode="numeric" value={r.fromPct} disabled={!canEdit} onChange={(e) => up(i, 'fromPct', e.target.value)} aria-label={`${r.name}: басы`} />
              <span className="muted">–</span>
              <input className="input mono" style={{ width: 60, textAlign: 'right' }} inputMode="numeric" value={r.toPct} disabled={!canEdit} onChange={(e) => up(i, 'toPct', e.target.value)} aria-label={`${r.name}: соңы`} />
              <span className="muted">%</span>
              {canEdit && rows.length > 2 && (
                <button className="btn ghost icon" aria-label="Деңгейді жою" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {err && <div className="err-box">{err}</div>}
          {canEdit ? (
            <div className="row">
              {rows.length < 6 && (
                <button className="btn sm" onClick={() => setRows((x) => [...x, { name: '', fromPct: '', toPct: '' }])}>
                  + Деңгей
                </button>
              )}
              <span className="grow" style={{ flex: 1 }} />
              {dirty && (
                <button className="btn" onClick={() => q.data && setRows(q.data.levels.map((l) => ({ name: l.name, fromPct: String(l.fromPct), toPct: String(l.toPct) })))}>
                  Болдырмау
                </button>
              )}
              <button className="btn primary" disabled={!dirty || !!err || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Spinner />} Сақтау
              </button>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              Деңгейлерді мектеп әкімшілігі өзгертеді.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Personal() {
  const { theme, setTheme } = useTheme();
  const { i18n } = useTranslation();
  const { me, refetch } = useAuth();
  const toast = useToast();
  const setLocale = useMutation({
    mutationFn: (locale: string) => api.put('/settings/me', { locale }),
    onSuccess: (_, locale) => {
      void i18n.changeLanguage(locale);
      refetch();
      toast('Сақталды');
    },
  });
  const langs = Object.keys(i18n.options.resources ?? { kk: {} });
  const names: Record<string, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
  return (
    <Card title="Интерфейс">
      <div className="stack">
        <Field label="Тақырып">
          <Segmented
            value={theme}
            onChange={setTheme}
            label="Тақырып"
            options={[
              { value: 'light', label: 'Жарық' },
              { value: 'dark', label: 'Қараңғы' },
            ]}
          />
        </Field>
        <Field label="Тіл" hint={langs.length < 2 ? 'Интерфейс тілі: қазақша. Орыс және ағылшын аудармалары i18n файлдары қосылғанда осында пайда болады.' : undefined}>
          <select className="select" value={me?.locale ?? 'kk'} onChange={(e) => setLocale.mutate(e.target.value)} disabled={langs.length < 2}>
            {langs.map((l) => (
              <option key={l} value={l}>
                {names[l] ?? l}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Card>
  );
}

function SchoolCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ levels: Level[]; settings: { attendanceThreshold: number } }>('/settings') });
  const [thr, setThr] = useState('');
  useEffect(() => {
    if (q.data) setThr(String(q.data.settings.attendanceThreshold));
  }, [q.data]);
  const n = Number(thr);
  const bad = !(n >= 50 && n <= 100);
  const save = useMutation({
    mutationFn: () => api.put('/settings/school', { attendanceThreshold: n }),
    onSuccess: () => {
      toast('Қатысу шегі сақталды');
      ['settings', 'reference', 'dashboard', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <Card title="Ескерту ережелері">
      <Field label="Қатысу шегі (%)" error={thr && bad ? '50–100 аралығында' : null} hint="Осы мәннен төмен қатысатын оқушылар туралы ескерту жасалады">
        <div className="row">
          <input className="input mono" style={{ width: 90 }} inputMode="numeric" value={thr} onChange={(e) => setThr(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
          <button className="btn primary" disabled={bad || save.isPending || n === q.data?.settings.attendanceThreshold} onClick={() => save.mutate()}>
            Сақтау
          </button>
        </div>
      </Field>
    </Card>
  );
}

interface BackupRow {
  id: number;
  fileName: string;
  sizeBytes: number;
  kind: 'MANUAL' | 'AUTO';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string;
}

function Backups() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ items: BackupRow[]; settings: { autoEnabled: boolean; retentionDays: number } }>('/backups'),
    refetchInterval: (x) => (x.state.data?.items.some((b) => b.status === 'RUNNING') ? 3000 : false),
  });
  const [ret, setRet] = useState('');
  useEffect(() => {
    if (q.data) setRet(String(q.data.settings.retentionDays));
  }, [q.data]);
  const [del, setDel] = useState<BackupRow | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['backups'] });
  const create = useMutation({ mutationFn: () => api.post<BackupRow>('/backups'), onSuccess: (b) => (inv(), toast(b.status === 'FAILED' ? `Қате: ${b.error}` : 'Көшірме жасалды', b.status === 'FAILED' ? 'error' : 'info')), onError: (e) => toast((e as Error).message, 'error') });
  const setS = useMutation({ mutationFn: (b: { autoEnabled: boolean; retentionDays: number }) => api.put('/backups/settings', b), onSuccess: () => (inv(), toast('Сақталды')), onError: (e) => toast((e as Error).message, 'error') });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/backups/${id}`), onSuccess: () => (inv(), setDel(null), toast('Көшірме жойылды')), onError: (e) => toast((e as Error).message, 'error') });
  const s = q.data?.settings;
  const retN = Number(ret);
  return (
    <Card
      className="mt"
      title="Резервтік көшірмелер"
      sub="PostgreSQL дерекқорының толық көшірмесі (pg_dump). Автоматты көшірме күн сайын 02:00-де (Алматы уақыты)."
      action={
        <button className="btn primary" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending && <Spinner />} Қазір көшірме жасау
        </button>
      }
    >
      {q.isLoading ? (
        <Spinner block />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="stack">
          <div className="row">
            <label className="row">
              <input type="checkbox" checked={!!s?.autoEnabled} onChange={(e) => setS.mutate({ autoEnabled: e.target.checked, retentionDays: s!.retentionDays })} /> Автоматты күнделікті көшірме
            </label>
            <span className="muted">· сақтау мерзімі</span>
            <input className="input mono" style={{ width: 70 }} inputMode="numeric" value={ret} onChange={(e) => setRet(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} aria-label="Сақтау мерзімі (күн)" />
            <span className="muted">күн</span>
            <button className="btn sm" disabled={!(retN >= 1 && retN <= 365) || retN === s?.retentionDays} onClick={() => setS.mutate({ autoEnabled: s!.autoEnabled, retentionDays: retN })}>
              Сақтау
            </button>
          </div>
          {q.data!.items.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Уақыты</th>
                    <th>Файл</th>
                    <th>Түрі</th>
                    <th className="num">Көлемі</th>
                    <th>Күйі</th>
                    <th>Кім</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data!.items.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{dateTime(b.createdAt)}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {b.fileName}
                      </td>
                      <td>{b.kind === 'AUTO' ? 'Автоматты' : 'Қолмен'}</td>
                      <td className="num">{b.status === 'SUCCESS' ? bytes(b.sizeBytes) : '—'}</td>
                      <td>
                        {b.status === 'SUCCESS' ? <Badge tone="ok">Дайын</Badge> : b.status === 'RUNNING' ? <Badge tone="acc">Жасалуда…</Badge> : <span title={b.error ?? ''}><Badge tone="bad">Қате</Badge></span>}
                      </td>
                      <td>{b.createdBy}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {b.status === 'SUCCESS' && (
                          <button className="btn sm" onClick={() => download(`/backups/${b.id}/download`).catch((e) => toast((e as Error).message, 'error'))}>
                            Жүктеу
                          </button>
                        )}{' '}
                        {b.status !== 'RUNNING' && (
                          <button className="btn sm ghost c-bad" onClick={() => setDel(b)}>
                            Жою
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Көшірме әлі жоқ</Empty>
          )}
          <div className="muted" style={{ fontSize: 12 }}>
            Қалпына келтіру серверде <span className="mono">deploy/scripts/restore.sh &lt;файл&gt;</span> арқылы орындалады (README-де нұсқаулық бар).
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        danger
        title="Көшірмені жою"
        text={<>«{del?.fileName}» файлы серверден біржола жойылады.</>}
        confirmLabel="Жою"
        busy={remove.isPending}
        onConfirm={() => del && remove.mutate(del.id)}
        onClose={() => setDel(null)}
      />
    </Card>
  );
}

const PERM_LABELS: Record<string, string> = {
  'students.read': 'Оқушыларды көру',
  'students.write': 'Оқушыларды өңдеу',
  'students.iin.view': 'ЖСН көру',
  'nationality.view': 'Ұлт статистикасы',
  'attendance.write': 'Қатысу белгілеу',
  'movements.write': 'Қозғалыс енгізу',
  'assessments.write': 'БЖБ/ТЖБ енгізу',
  'reports.read': 'Есептерді көру',
  'reports.export': 'Экспорт',
  'analytics.read': 'Аналитика',
  'school.wide': 'Бүкіл мектеп деректері',
  'levels.manage': 'Деңгейлерді баптау',
  'settings.manage': 'Мектеп баптаулары',
  'audit.read': 'Аудит журналы',
  'classes.manage': 'Сыныптар мен пәндер',
  'users.manage': 'Пайдаланушылар',
  'schools.manage': 'Мектептер',
  'backup.manage': 'Резервтік көшірме',
  'platform.wide': 'Барлық мектепке қолжетімділік',
};

function RolesMatrix() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ code: string; label: string; permissions: string[] }[]>('/admin/roles') });
  if (q.isError) return null;
  return (
    <Card className="mt" flush title="Рөлдер мен рұқсаттар" sub="Рұқсаттар API деңгейінде тексеріледі">
      {q.isLoading ? (
        <Spinner block />
      ) : (
        <div className="table-wrap">
          <table className="tbl matrix">
            <thead>
              <tr>
                <th>Рұқсат</th>
                {q.data!.map((r) => (
                  <th key={r.code}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(PERM_LABELS).map(([p, label]) => (
                <tr key={p}>
                  <td>
                    {label} <span className="muted mono" style={{ fontSize: 11 }}>{p}</span>
                  </td>
                  {q.data!.map((r) => (
                    <td key={r.code}>{r.permissions.includes(p) ? <span className="c-ok">✓</span> : <span className="muted">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
