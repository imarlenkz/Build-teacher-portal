import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../lib/toast';
import { Badge, Modal } from './ui';

interface Issue {
  row: number;
  message: string;
}
interface ImportResult {
  applied: boolean;
  schoolYear: string;
  total: number;
  create: number;
  update: number;
  unchanged: number;
  newClasses: string[];
  classes: { name: string; count: number; isNew: boolean }[];
  updates: { row: number; name: string; changes: string[] }[];
  errors: Issue[];
  warnings: Issue[];
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Файл оқылмады'));
    r.readAsDataURL(file);
  });
}

function IssueList({ title, items, tone }: { title: string; items: Issue[]; tone: 'bad' | 'warn' }) {
  if (!items.length) return null;
  return (
    <details open={tone === 'bad'} style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13 }}>
        <Badge tone={tone}>{items.length}</Badge> {title}
      </summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, maxHeight: 160, overflow: 'auto' }}>
        {items.map((e, i) => (
          <li key={i}>
            <span className="mono muted">{e.row}-жол:</span> {e.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Контингент Excel файлынан оқушыларды импорттау: файл → алдын ала қарау → сақтау. */
export function StudentImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (v: { data: string; apply: boolean }) => api.post<ImportResult>('/students/import', v),
    onSuccess: (r) => {
      setErr(null);
      setRes(r);
      if (r.applied) {
        qc.invalidateQueries();
        toast(`Импорт аяқталды: ${r.create} жаңа, ${r.update} жаңартылды`);
        onClose();
      }
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  const pick = async (f: File | undefined) => {
    setRes(null);
    setErr(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setErr('Тек .xlsx форматындағы Excel файлы қабылданады');
    if (f.size > 4 * 1024 * 1024) return setErr('Файл тым үлкен (4 МБ-тан аспауы керек)');
    const data = await toBase64(f);
    setFile({ name: f.name, data });
    run.mutate({ data, apply: false });
  };

  const changes = res ? res.create + res.update : 0;
  return (
    <Modal
      open
      size="lg"
      title="Оқушыларды Excel-ден импорттау"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" disabled={!res || !file || run.isPending || !changes} onClick={() => file && run.mutate({ data: file.data, apply: true })}>
            {run.isPending && res ? 'Сақталуда…' : changes ? `Импорттау (${changes} оқушы)` : 'Импорттау'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: 12.5 }}>
          Бағандар: <b>Тегі, Аты, Әкесінің аты, ЖСН, Сынып, Туған күні</b> (қажет болса «Жынысы»). Жынысы ЖСН бойынша анықталады. Жоқ сыныптар ағымдағы оқу жылында автоматты жасалады. Бар оқушылар ЖСН бойынша табылып жаңартылады, қайталанбайды.
        </div>
        <div className="row">
          <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn" onClick={() => input.current?.click()} disabled={run.isPending}>
            Файл таңдау
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {run.isPending && !res ? 'Тексерілуде…' : (file?.name ?? 'файл таңдалмаған')}
          </span>
        </div>
        {err && <div className="err-box">{err}</div>}
        {res && (
          <>
            <div className="mini-kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
              <div className="mini-kpi">
                <div className="l">Файлда</div>
                <div className="v">{res.total}</div>
              </div>
              <div className="mini-kpi">
                <div className="l">Жаңа</div>
                <div className="v">{res.create}</div>
              </div>
              <div className="mini-kpi">
                <div className="l">Жаңартылады</div>
                <div className="v">{res.update}</div>
              </div>
              <div className="mini-kpi">
                <div className="l">Өзгеріссіз</div>
                <div className="v">{res.unchanged}</div>
              </div>
            </div>
            <div style={{ fontSize: 12.5 }}>
              <span className="muted">Оқу жылы {res.schoolYear}. Сыныптар:</span>{' '}
              {res.classes.map((c) => (
                <span key={c.name} style={{ marginRight: 6, whiteSpace: 'nowrap' }}>
                  {c.isNew ? <Badge tone="acc">{c.name} · {c.count} · жаңа</Badge> : <Badge>{c.name} · {c.count}</Badge>}
                </span>
              ))}
            </div>
            {res.updates.length > 0 && (
              <IssueList title="оқушының деректері өзгереді" tone="warn" items={res.updates.map((u) => ({ row: u.row, message: `${u.name}: ${u.changes.join(', ')}` }))} />
            )}
            <IssueList title="жол өткізіліп жіберіледі (қатені түзетіп, қайта жүктеңіз немесе қолмен қосыңыз)" tone="bad" items={res.errors} />
            <IssueList title="ескерту" tone="warn" items={res.warnings} />
          </>
        )}
      </div>
    </Modal>
  );
}
