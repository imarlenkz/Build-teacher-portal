import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../lib/toast';
import { dot } from '../lib/format';
import { Badge, Card, ConfirmDialog, DashboardCard, ErrorState, Field, Spinner } from '../components/ui';

interface Status {
  configured: boolean;
  apiUrl: string;
  institutionId: string | null;
  institutions: { id: string; name: string }[];
  error: string | null;
}

interface Preview {
  from: string;
  to: string;
  lessons: number;
  teachers: { total: number; new: number; list: { email: string; fullName: string; existingId: number | null }[] };
  classes: { total: number; new: string[] };
  subjects: { total: number; new: string[] };
  assignments: number;
  groups: number;
  slots: number;
  warnings: string[];
}

interface ImportResult {
  teachers: { total: number; created: number };
  subjects: number;
  classes: number;
  assignments: number;
  groups: { total: number; created: number };
  slots: number;
  warnings: string[];
}

/** Nexus (сабақ кестесі жүйесі) — мұғалімдер тізімі мен сабақ кестесін импорттау. */
export function NexusSync() {
  const qc = useQueryClient();
  const toast = useToast();
  const st = useQuery({ queryKey: ['nexus'], queryFn: () => api.get<Status>('/nexus') });
  const [inst, setInst] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Қате', 'error');

  const link = useMutation({
    mutationFn: (institutionId: string) => api.put<Status>('/nexus/institution', { institutionId }),
    onSuccess: (x) => (qc.setQueryData(['nexus'], x), setPreview(null), toast('Nexus мекемесі байланыстырылды')),
    onError: err,
  });
  const prev = useMutation({ mutationFn: () => api.post<Preview>('/nexus/preview'), onSuccess: (x) => (setPreview(x), setDone(null)), onError: err });
  const run = useMutation({
    mutationFn: () => api.post<ImportResult>('/nexus/import'),
    onSuccess: (x) => {
      setDone(x);
      setConfirm(false);
      setPreview(null);
      ['classes', 'reference', 'teachers', 'admin-subjects', 'users'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast('Nexus-тен импорт аяқталды');
    },
    onError: (e) => (setConfirm(false), err(e)),
  });

  if (st.isLoading) return <Spinner block />;
  if (st.isError) return <ErrorState error={st.error} onRetry={() => st.refetch()} />;
  const s = st.data!;
  const current = inst || s.institutionId || '';

  return (
    <div className="stack">
      <Card title="Nexus байланысы" sub={`Сабақ кестесі мен мұғалімдер тізімі Nexus жүйесінен алынады · ${s.apiUrl}`}>
        {!s.configured || s.error ? (
          <div className="err-box">
            {s.error}
            {!s.configured && (
              <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                Сервердің .env файлына <code>NEXUS_INTEGRATION_KEY</code> (Nexus-тегі <code>INTEGRATION_KEY</code>-мен бірдей) және қажет болса <code>NEXUS_API_URL</code> қосып, backend-ті қайта іске қосыңыз.
              </div>
            )}
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Nexus мекемесі">
              <select className="select" value={current} onChange={(e) => setInst(e.target.value)} style={{ minWidth: 260 }}>
                <option value="">Таңдаңыз</option>
                {s.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn" disabled={!current || current === s.institutionId || link.isPending} onClick={() => link.mutate(current)} style={{ marginBottom: 2 }}>
              Байланыстыру
            </button>
            <span className="grow" />
            <button className="btn primary" disabled={!s.institutionId || prev.isPending} onClick={() => prev.mutate()} style={{ marginBottom: 2 }}>
              {prev.isPending && <Spinner />} Алдын ала қарау
            </button>
          </div>
        )}
      </Card>

      {preview && (
        <Card
          title="Импортталатын деректер"
          sub={`Nexus-тегі жарияланған кесте · ${dot(preview.from)} – ${dot(preview.to)} · ${preview.lessons} сабақ`}
          action={
            <button className="btn primary" onClick={() => setConfirm(true)} disabled={run.isPending}>
              Импорттау
            </button>
          }
        >
          <div className="grid-auto" style={{ gap: 10, marginBottom: 12 }}>
            <DashboardCard label="Мұғалімдер" value={preview.teachers.total} sub={`жаңа: ${preview.teachers.new}`} />
            <DashboardCard label="Сыныптар" value={preview.classes.total} sub={preview.classes.new.length ? `жаңа: ${preview.classes.new.join(', ')}` : 'бәрі бар'} />
            <DashboardCard label="Пәндер" value={preview.subjects.total} sub={preview.subjects.new.length ? `жаңа: ${preview.subjects.new.join(', ')}` : 'бәрі бар'} />
            <DashboardCard label="Пән топтары" value={preview.groups} sub={`${preview.assignments} пән мұғалімі`} />
            <DashboardCard label="Апталық кесте" value={preview.slots} sub="сабақ орны" />
          </div>
          {preview.warnings.length > 0 && (
            <div className="err-box" style={{ marginBottom: 12 }}>
              {preview.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          <table className="tbl">
            <thead>
              <tr>
                <th>Мұғалім</th>
                <th>Email</th>
                <th>Ұстаз-да</th>
              </tr>
            </thead>
            <tbody>
              {preview.teachers.list.map((t) => (
                <tr key={t.email || t.fullName}>
                  <td>{t.fullName}</td>
                  <td className="muted">{t.email || '—'}</td>
                  <td>{t.existingId ? <Badge tone="ok">бар</Badge> : <Badge tone="acc">жаңа</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {done && (
        <Card title="Импорт нәтижесі">
          <div className="stack" style={{ gap: 4 }}>
            <div>
              Мұғалімдер: {done.teachers.total} (жаңа {done.teachers.created}) · сынып +{done.classes} · пән +{done.subjects} · пән мұғалімі {done.assignments}
            </div>
            <div>
              Пән топтары: {done.groups.total} (жаңа {done.groups.created}) · апталық кесте: {done.slots} сабақ орны
            </div>
            {done.groups.created > 0 && <div className="c-warn">Жаңа топтарға оқушыларды «Сыныптар → Баптау → Топтар» бөлімінде бөліңіз: Nexus топ құрамын бермейді.</div>}
            {done.teachers.created > 0 && <div className="muted">Жаңа мұғалімдер iMARLEN ID арқылы кіреді немесе «Пайдаланушылар» бөлімінде оларға құпиясөз беріңіз.</div>}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title="Nexus-тен импорттау"
        text={
          <>
            Ағымдағы оқу жылының <b>сабақ кестесі толық ауыстырылады</b> ({preview?.slots} сабақ орны). Жоқ мұғалімдер, сыныптар мен пәндер қосылады, пән мұғалімдері мен топ мұғалімдері жаңартылады. Бұрын қойылған бағалар мен қатысу өзгермейді. Әрекет аудит журналына жазылады.
          </>
        }
        confirmLabel="Импорттау"
        busy={run.isPending}
        onConfirm={() => run.mutate()}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
