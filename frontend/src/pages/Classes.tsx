import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { pct } from '../lib/format';
import { Badge, Card, Empty, ErrorState, Field, Modal, Spinner } from '../components/ui';

export interface ClassRow {
  id: number;
  name: string;
  grade: number;
  letter: string;
  homeroomTeacherId: number | null;
  homeroomTeacher: string | null;
  students: number;
  boys: number;
  girls: number;
  attendancePct: number | null;
  subjects: { id: number; subjectId: number; subject: string; teacherId: number; teacher: string }[];
}
interface Teacher {
  id: number;
  fullName: string;
  title: string | null;
  active: boolean;
}

export default function Classes() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Сыныптар</h1>
      </div>
      <ClassesManager />
    </div>
  );
}

/** Сыныптар тізімі; басқару рұқсаты болса — сынып жетекшісі, пән мұғалімдері және жаңа сынып. */
export function ClassesManager() {
  const { year, ref } = useReference();
  const { can } = useAuth();
  const nav = useNavigate();
  const manage = can(PERM.CLASSES);
  const q = useQuery({ queryKey: ['classes', year.id], queryFn: () => api.get<ClassRow[]>('/classes', { schoolYearId: year.id }) });
  const teachers = useQuery({ queryKey: ['teachers'], queryFn: () => api.get<Teacher[]>('/classes/teachers'), enabled: manage });
  const [edit, setEdit] = useState<ClassRow | null>(null);
  const [creating, setCreating] = useState(false);

  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {year.name} оқу жылы · {rows.length} сынып · {rows.reduce((s, c) => s + c.students, 0)} оқушы
        </span>
        {manage && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Сынып қосу
          </button>
        )}
      </div>
      {!rows.length ? (
        <Empty>Бұл оқу жылында сынып жоқ</Empty>
      ) : (
        <div className="grid-auto">
          {rows.map((c) => (
            <Card
              key={c.id}
              title={
                <span className="row">
                  {c.name} {ref.classes.find((x) => x.id === c.id)?.isHomeroom && <Badge tone="acc">менің сыныбым</Badge>}
                </span>
              }
              sub={c.homeroomTeacher ? `Сынып жетекшісі: ${c.homeroomTeacher}` : 'Сынып жетекшісі тағайындалмаған'}
              action={
                manage ? (
                  <button className="btn sm" onClick={() => setEdit(c)}>
                    Баптау
                  </button>
                ) : undefined
              }
            >
              <div className="mini-kpis" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <div className="mini-kpi">
                  <div className="l">Оқушы</div>
                  <div className="v">{c.students}</div>
                </div>
                <div className="mini-kpi">
                  <div className="l">Ұл / қыз</div>
                  <div className="v">
                    {c.boys} / {c.girls}
                  </div>
                </div>
                <div className="mini-kpi">
                  <div className="l">Қатысу</div>
                  <div className={`v ${c.attendancePct != null && c.attendancePct < ref.attendanceThreshold ? 'c-bad' : ''}`}>{pct(c.attendancePct)}</div>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 12, margin: '10px 0 4px' }}>
                Пәндер ({c.subjects.length})
              </div>
              <div className="row" style={{ gap: 4 }}>
                {c.subjects.length ? c.subjects.map((s) => <Badge key={s.id}>{s.subject}</Badge>) : <span className="muted">—</span>}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => nav(`/students?classId=${c.id}`)}>
                  Оқушылар
                </button>
                <button className="btn sm" onClick={() => nav(`/attendance?classId=${c.id}`)}>
                  Қатысу
                </button>
                <button className="btn sm" onClick={() => nav(`/analytics?classId=${c.id}`)}>
                  Аналитика
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <ClassEditor c={rows.find((x) => x.id === edit.id) ?? edit} teachers={teachers.data ?? []} onClose={() => setEdit(null)} />}
      {creating && <ClassCreate teachers={teachers.data ?? []} existing={rows.map((r) => r.name)} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ClassEditor({ c, teachers, onClose }: { c: ClassRow; teachers: Teacher[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { ref } = useReference();
  const subjects = useQuery({ queryKey: ['admin-subjects'], queryFn: () => api.get<{ id: number; name: string }[]>('/admin/subjects') });
  const inv = () => ['classes', 'reference', 'teachers'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const homeroom = useMutation({
    mutationFn: (teacherId: number | null) => api.put(`/classes/${c.id}/homeroom`, { teacherId }),
    onSuccess: () => (inv(), toast('Сынып жетекшісі сақталды')),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const [subj, setSubj] = useState('');
  const [teacher, setTeacher] = useState('');
  const assign = useMutation({
    mutationFn: (b: { subjectId: number; teacherId: number }) => api.post(`/classes/${c.id}/assignments`, b),
    onSuccess: () => {
      inv();
      setSubj('');
      setTeacher('');
      toast('Пән мұғалімі тағайындалды');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });
  const active = teachers.filter((t) => t.active);
  const subjList = subjects.data ?? ref.subjects;
  return (
    <Modal open size="lg" title={`${c.name} сыныбы`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Жабу</button>}>
      <div className="stack">
        <Field label="Сынып жетекшісі">
          <select className="select" value={c.homeroomTeacherId ?? ''} disabled={homeroom.isPending} onChange={(e) => homeroom.mutate(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— тағайындалмаған —</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
                {t.title ? ` · ${t.title}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <b style={{ fontWeight: 600 }}>Пәндер мен мұғалімдер</b>
          <table className="tbl" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Пән</th>
                <th>Мұғалім</th>
              </tr>
            </thead>
            <tbody>
              {c.subjects.map((s) => (
                <tr key={s.id}>
                  <td>{s.subject}</td>
                  <td>
                    <select className="select" value={s.teacherId} disabled={assign.isPending} onChange={(e) => assign.mutate({ subjectId: s.subjectId, teacherId: Number(e.target.value) })} aria-label={`${s.subject} мұғалімі`}>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id} disabled={!t.active}>
                          {t.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {!c.subjects.length && (
                <tr>
                  <td colSpan={2} className="muted">
                    Пән тағайындалмаған
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Жаңа пән">
            <select className="select" value={subj} onChange={(e) => setSubj(e.target.value)}>
              <option value="">Таңдаңыз</option>
              {subjList
                .filter((s) => !c.subjects.some((x) => x.subjectId === s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Мұғалім">
            <select className="select" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
              <option value="">Таңдаңыз</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn primary" disabled={!subj || !teacher || assign.isPending} onClick={() => assign.mutate({ subjectId: Number(subj), teacherId: Number(teacher) })}>
            Қосу
          </button>
        </div>
      </div>
    </Modal>
  );
}

const LETTERS = ['А', 'Ә', 'Б', 'В', 'Г', 'Д', 'Е'];

function ClassCreate({ teachers, existing, onClose }: { teachers: Teacher[]; existing: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { year } = useReference();
  const [grade, setGrade] = useState('1');
  const [letter, setLetter] = useState('А');
  const [tid, setTid] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const name = `${grade}${letter}`;
  const dup = existing.includes(name);
  const save = useMutation({
    mutationFn: () => api.post('/classes', { grade: Number(grade), letter, homeroomTeacherId: tid ? Number(tid) : null, schoolYearId: year.id }),
    onSuccess: () => {
      ['classes', 'reference'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast(`${name} сыныбы қосылды`);
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? (e.status === 409 ? 'Мұндай сынып бар' : e.message) : 'Қате'),
  });
  return (
    <Modal
      open
      title="Сынып қосу"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Бас тарту
          </button>
          <button className="btn primary" disabled={dup || save.isPending} onClick={() => save.mutate()}>
            Қосу
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Параллель">
          <select className="select" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => i).map((g) => (
              <option key={g} value={g}>
                {g === 0 ? '0 (даярлық)' : g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Литер">
          <select className="select" value={letter} onChange={(e) => setLetter(e.target.value)}>
            {LETTERS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Сынып жетекшісі" className="full">
          <select className="select" value={tid} onChange={(e) => setTid(e.target.value)}>
            <option value="">— кейін тағайындау —</option>
            {teachers
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        Сынып: <b>{name}</b> · {year.name}
      </div>
      {(dup || err) && (
        <div className="err-box" style={{ marginTop: 8 }}>
          {dup ? 'Мұндай сынып бар' : err}
        </div>
      )}
    </Modal>
  );
}
