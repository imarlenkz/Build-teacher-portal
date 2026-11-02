import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../lib/toast';
import { useReference } from '../lib/reference';
import { ClassBatch, mergeBatches, readExport } from '../lib/bilimclass';
import { Badge, Card, ConfirmDialog, DashboardCard, Field, Spinner } from '../components/ui';

interface ClassResult {
  applied: boolean;
  className: string;
  portalClass: string | null;
  quarter: number;
  students: { file: number; matched: number; unmatched: string[] };
  subjects: string[];
  missingSubjects: string[];
  groups: { total: number; create: number; members: number };
  fo: { columns: number; create: number; marks: number };
  summative: { total: number; create: number; results: number };
  quarterMarks: number;
  skipped: number;
  warnings: string[];
}

type Row = { batch: ClassBatch; res?: ClassResult; error?: string };
/** BilimClass пәні → Ұстаз пәнінің id-і, 'new' (жаңа пән) немесе жоқ (өткізу). */
type SubjectMap = Record<string, number | 'new'>;
type Opts = { quarter: number; subjectMap: SubjectMap };

const sum = (rows: Row[], f: (r: ClassResult) => number) => rows.reduce((n, r) => n + (r.res ? f(r.res) : 0), 0);

/** BilimClass экспортынан (CSV) пән топтарын және тоқсан бағаларын импорттау. */
export function BilimClassImport() {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [quarter, setQuarter] = useState(1);
  const { ref } = useReference();
  const [subjectMap, setSubjectMap] = useState<SubjectMap>({});
  /** Осы файлдарда кездескен, Ұстазда жоқ пәндер (сәйкестендірілгеннен кейін де тізімде қалады). */
  const [unknown, setUnknown] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<{
    done: number;
    total: number;
    apply: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState(false);

  const run = async (batches: ClassBatch[], apply: boolean, opts: Opts = { quarter, subjectMap }) => {
    setBusy({ done: 0, total: batches.length, apply });
    const out: Row[] = [];
    for (const batch of batches) {
      try {
        const res = await api.post<ClassResult>('/bilimclass/import', {
          ...batch,
          quarter: opts.quarter,
          subjectMap: opts.subjectMap,
          apply,
        });
        out.push({ batch, res });
      } catch (e) {
        out.push({
          batch,
          error: e instanceof ApiError ? e.message : (e as Error).message,
        });
      }
      setBusy({ done: out.length, total: batches.length, apply });
      setRows([...out, ...batches.slice(out.length).map((b) => ({ batch: b }))]);
    }
    setBusy(null);
    return out;
  };

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setApplied(false);
    const parts: Parameters<typeof mergeBatches>[0] = [];
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      if (!/\.(csv|txt)$/i.test(f.name)) {
        errs.push(`${f.name}: тек .csv файлы қабылданады`);
        continue;
      }
      const r = readExport(await f.text());
      if ('error' in r) errs.push(`${f.name}: ${r.error}`);
      else parts.push(...r);
    }
    setFiles(Array.from(list).map((f) => f.name));
    setFileErrors(errs);
    setUnknown([]);
    setSubjectMap({});
    const batches = mergeBatches(parts);
    setRows(batches.map((batch) => ({ batch })));
    if (batches.length) await run(batches, false, { quarter, subjectMap: {} });
  };

  const preview = (opts: Opts) =>
    rows.length &&
    !busy &&
    run(
      rows.map((r) => r.batch),
      false,
      opts,
    );

  const apply = async () => {
    setConfirm(false);
    const ok = rows.filter((r) => r.res?.portalClass).map((r) => r.batch);
    const out = await run(ok, true);
    setApplied(true);
    qc.invalidateQueries();
    const failed = out.filter((r) => r.error).length;
    toast(failed ? `Импорт аяқталды, ${failed} сыныпта қате бар` : `Импорт аяқталды: ${out.length} сынып`, failed ? 'error' : undefined);
  };

  const ready = rows.filter((r) => r.res?.portalClass);
  const missingNow = rows.flatMap((r) => r.res?.missingSubjects ?? []).join('|');
  useEffect(() => {
    const names = missingNow ? missingNow.split('|') : [];
    setUnknown((u) => {
      const next = [...new Set([...u, ...names])].sort((a, b) => a.localeCompare(b, 'kk'));
      return next.length === u.length ? u : next;
    });
  }, [missingNow]);
  const setMapping = (name: string, value: string) => {
    const next = { ...subjectMap };
    if (value === '') delete next[name];
    else next[name] = value === 'new' ? 'new' : Number(value);
    setSubjectMap(next);
    preview({ quarter, subjectMap: next });
  };
  const subjects = [...ref.subjects].sort((a, b) => a.name.localeCompare(b.name, 'kk'));
  const skippedCount = unknown.filter((n) => !subjectMap[n]).length;

  return (
    <div className="stack">
      <Card title="BilimClass-тан импорттау" sub="Пән топтары мен тоқсан бағалары (ФО, БЖБ, ТЖБ, аралық бағалау, тоқсандық баға) BilimClass экспортының CSV файлдарынан алынады">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Файлдар: <b>groups</b> (class, subject, group, teacher, student) және <b>grades</b> (class, subject, group, student, date, type, mark, max, quarter_mark). Бірнеше файлды
          бірден таңдауға болады. Оқушылар сыныптағы аты-жөні бойынша, топтар нөмірі бойынша сәйкестендіріледі. Қайта импорттасаңыз, бағалар қайталанбайды, жаңартылады.
        </div>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Тоқсан">
            <select
              className="select"
              value={quarter}
              disabled={!!busy}
              onChange={(e) => {
                const q = Number(e.target.value);
                setQuarter(q);
                preview({ quarter: q, subjectMap });
              }}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  {q}-тоқсан
                </option>
              ))}
            </select>
          </Field>
          <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
          <button className="btn" onClick={() => input.current?.click()} disabled={!!busy} style={{ marginBottom: 2 }}>
            CSV файлдарын таңдау
          </button>
          <span className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
            {files.length ? `${files.length} файл` : 'файл таңдалмаған'}
          </span>
          <span className="grow" />
          <button className="btn primary" disabled={!!busy || !ready.length || applied} onClick={() => setConfirm(true)} style={{ marginBottom: 2 }}>
            {busy?.apply && <Spinner />} Импорттау ({ready.length} сынып)
          </button>
        </div>
        {busy && (
          <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
            <Spinner /> {busy.apply ? 'Сақталуда' : 'Тексерілуде'}: {busy.done} / {busy.total} сынып
          </div>
        )}
        {fileErrors.length > 0 && (
          <div className="err-box" style={{ marginTop: 10 }}>
            {fileErrors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </Card>

      {rows.some((r) => r.res) && (
        <Card title={applied ? 'Импорт нәтижесі' : 'Алдын ала қарау'} sub={applied ? 'Деректер сақталды' : 'Әзірге ештеңе сақталған жоқ'}>
          <div className="grid-auto" style={{ gap: 10, marginBottom: 12 }}>
            <DashboardCard label="Сыныптар" value={`${ready.length} / ${rows.length}`} sub="USTAZ-да табылды" />
            <DashboardCard label="Оқушылар" value={sum(rows, (r) => r.students.matched)} sub={`табылмады: ${sum(rows, (r) => r.students.unmatched.length)}`} />
            <DashboardCard label="Пән топтары" value={sum(rows, (r) => r.groups.total)} sub={`жаңа: ${sum(rows, (r) => r.groups.create)}`} />
            <DashboardCard label="ФО бағалары" value={sum(rows, (r) => r.fo.marks)} sub={`${sum(rows, (r) => r.fo.columns)} баған`} />
            <DashboardCard label="БЖБ / ТЖБ / аралық" value={sum(rows, (r) => r.summative.results)} sub={`${sum(rows, (r) => r.summative.total)} жұмыс`} />
            <DashboardCard label="Тоқсандық баға" value={sum(rows, (r) => r.quarterMarks)} sub={`өткізілген жол: ${sum(rows, (r) => r.skipped)}`} />
          </div>
          {unknown.length > 0 && (
            <div className={skippedCount ? 'err-box' : undefined} style={{ marginBottom: 12, fontSize: 13 }}>
              <div style={{ marginBottom: 8 }}>
                <b>BilimClass пәндерін USTAZ пәндерімен сәйкестендіріңіз.</b> Бұл пәндердің атауы USTAZ-да жоқ. Таңдалмаған пәннің топтары мен бағалары өткізіледі
                {skippedCount ? ` (қазір ${skippedCount} пән өткізіледі)` : ''}.
              </div>
              <table className="tbl">
                <tbody>
                  {unknown.map((name) => (
                    <tr key={name}>
                      <td style={{ width: '40%' }}>{name}</td>
                      <td>
                        <select
                          className="select"
                          value={String(subjectMap[name] ?? '')}
                          disabled={!!busy || applied}
                          onChange={(e) => setMapping(name, e.target.value)}
                          style={{ minWidth: 260 }}
                        >
                          <option value="">— өткізу —</option>
                          <option value="new">+ «{name}» деген жаңа пән жасау</option>
                          {subjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <table className="tbl">
            <thead>
              <tr>
                <th>BilimClass</th>
                <th>USTAZ</th>
                <th className="num">Оқушы</th>
                <th className="num">Топ</th>
                <th className="num">ФО</th>
                <th className="num">БЖБ/ТЖБ/аралық</th>
                <th className="num">Тоқсандық</th>
                <th>Ескерту</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ batch, res, error }) => (
                <tr key={batch.className}>
                  <td>{batch.className}</td>
                  <td>{res?.portalClass ?? (error || res ? <Badge tone="bad">жоқ</Badge> : <Spinner />)}</td>
                  <td className="num">{res ? `${res.students.matched}/${res.students.file}` : ''}</td>
                  <td className="num">{res?.groups.total ?? ''}</td>
                  <td className="num">{res?.fo.marks ?? ''}</td>
                  <td className="num">{res?.summative.results ?? ''}</td>
                  <td className="num">{res?.quarterMarks ?? ''}</td>
                  <td style={{ fontSize: 12.5, maxWidth: 420 }}>
                    {error && <div className="c-bad">{error}</div>}
                    {res && res.students.unmatched.length > 0 && (
                      <details>
                        <summary style={{ cursor: 'pointer' }}>
                          <Badge tone="warn">{res.students.unmatched.length}</Badge> оқушы табылмады
                        </summary>
                        {res.students.unmatched.join(', ')}
                      </details>
                    )}
                    {res && res.warnings.length > 0 && (
                      <details>
                        <summary style={{ cursor: 'pointer' }}>
                          <Badge tone="warn">{res.warnings.length}</Badge> ескерту
                        </summary>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                          {res.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {res?.applied && <Badge tone="ok">сақталды</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirm}
        title="BilimClass деректерін импорттау"
        text={`${ready.length} сыныптың ${quarter}-тоқсан бағалары мен пән топтары сақталады. Сол күндерге бұрын қойылған бағалар файлдағы бағамен ауыстырылады.`}
        confirmLabel="Импорттау"
        onConfirm={apply}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
