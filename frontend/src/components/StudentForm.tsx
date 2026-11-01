import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { StudentProfile } from '../api/types';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useToast } from '../lib/toast';
import { Field, Modal } from './ui';

interface Form {
  lastName: string;
  firstName: string;
  middleName: string;
  gender: 'M' | 'F' | '';
  birthDate: string;
  nationalityId: string;
  classId: string;
  iin: string;
  phone: string;
  parentName: string;
  parentPhone: string;
  enrolledAt: string;
  previousSchool: string;
  notes: string;
}

const empty: Form = { lastName: '', firstName: '', middleName: '', gender: '', birthDate: '', nationalityId: '', classId: '', iin: '', phone: '', parentName: '', parentPhone: '', enrolledAt: '', previousSchool: '', notes: '' };

/** ЖСН бақылау санын клиентте де тексеру (сервер міндетті түрде қайта тексереді). */
function iinOk(iin: string) {
  if (!/^\d{12}$/.test(iin)) return false;
  const d = iin.split('').map(Number);
  let c = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].reduce((s, w, i) => s + w * d[i], 0) % 11;
  if (c === 10) c = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2].reduce((s, w, i) => s + w * d[i], 0) % 11;
  return c !== 10 && c === d[11];
}

export function StudentForm({ open, onClose, student, onSaved }: { open: boolean; onClose: () => void; student?: StudentProfile | null; onSaved?: (id: number) => void }) {
  const { ref } = useReference();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(empty);
  const [errs, setErrs] = useState<Partial<Record<keyof Form, string>>>({});
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrs({});
    setServerErr(null);
    setF(
      student
        ? {
            lastName: student.lastName,
            firstName: student.firstName,
            middleName: student.middleName ?? '',
            gender: student.gender,
            birthDate: student.birthDate,
            nationalityId: student.nationalityId ? String(student.nationalityId) : '',
            classId: student.classId ? String(student.classId) : '',
            iin: '',
            phone: student.phone ?? '',
            parentName: student.parentName ?? '',
            parentPhone: student.parentPhone ?? '',
            enrolledAt: student.enrolledAt ?? '',
            previousSchool: student.previousSchool ?? '',
            notes: student.notes ?? '',
          }
        : empty,
    );
  }, [open, student]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => (student ? api.put<StudentProfile>(`/students/${student.id}`, body) : api.post<StudentProfile>('/students', body)),
    onSuccess: (s) => {
      toast(student ? 'Оқушы деректері сақталды' : 'Оқушы қосылды');
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['student', s.id] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onSaved?.(s.id);
      onClose();
    },
    onError: (e: Error) => setServerErr(e instanceof ApiError && Array.isArray(e.details) ? `${e.message}: ${(e.details as string[]).join('; ')}` : e.message),
  });

  const submit = () => {
    const e: typeof errs = {};
    if (f.lastName.trim().length < 2) e.lastName = 'Тегін енгізіңіз';
    if (f.firstName.trim().length < 2) e.firstName = 'Атын енгізіңіз';
    if (!f.gender) e.gender = 'Жынысын таңдаңыз';
    if (!f.birthDate) e.birthDate = 'Туған күнін енгізіңіз';
    else if (f.birthDate > ref.today) e.birthDate = 'Болашақ күн болмайды';
    if (f.iin && !iinOk(f.iin)) e.iin = 'ЖСН қате (12 сан, бақылау саны)';
    const phone = /^\+?[0-9 ()-]{7,20}$/;
    if (f.phone && !phone.test(f.phone)) e.phone = 'Телефон форматы қате';
    if (f.parentPhone && !phone.test(f.parentPhone)) e.parentPhone = 'Телефон форматы қате';
    setErrs(e);
    if (Object.keys(e).length) return;
    m.mutate({
      lastName: f.lastName,
      firstName: f.firstName,
      middleName: f.middleName || null,
      gender: f.gender,
      birthDate: f.birthDate,
      nationalityId: f.nationalityId ? Number(f.nationalityId) : null,
      classId: f.classId ? Number(f.classId) : null,
      ...(f.iin ? { iin: f.iin } : {}),
      phone: f.phone || null,
      parentName: f.parentName || null,
      parentPhone: f.parentPhone || null,
      enrolledAt: f.enrolledAt || null,
      previousSchool: f.previousSchool || null,
      notes: f.notes || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={student ? 'Оқушы деректерін өзгерту' : 'Жаңа оқушы'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Болдырмау
          </button>
          <button className="btn primary" onClick={submit} disabled={m.isPending}>
            Сақтау
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={(e) => (e.preventDefault(), submit())} noValidate>
        {serverErr && <div className="err-box full">{serverErr}</div>}
        <Field label="Тегі *" error={errs.lastName}>
          <input className={`input ${errs.lastName ? 'err' : ''}`} value={f.lastName} onChange={set('lastName')} />
        </Field>
        <Field label="Аты *" error={errs.firstName}>
          <input className={`input ${errs.firstName ? 'err' : ''}`} value={f.firstName} onChange={set('firstName')} />
        </Field>
        <Field label="Әкесінің аты">
          <input className="input" value={f.middleName} onChange={set('middleName')} />
        </Field>
        <Field label="Жынысы *" error={errs.gender}>
          <select className={`select ${errs.gender ? 'err' : ''}`} value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="M">Ұл</option>
            <option value="F">Қыз</option>
          </select>
        </Field>
        <Field label="Туған күні *" error={errs.birthDate}>
          <input className={`input ${errs.birthDate ? 'err' : ''}`} type="date" max={ref.today} value={f.birthDate} onChange={set('birthDate')} />
        </Field>
        <Field label="Сыныбы">
          <select className="select" value={f.classId} onChange={set('classId')}>
            <option value="">—</option>
            {ref.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {(ref.nationalities || !student) && (
          <Field label="Ұлты" hint={!ref.nationalities ? 'Статистика тек әкімшілікке көрінеді' : undefined}>
            <select className="select" value={f.nationalityId} onChange={set('nationalityId')} disabled={!ref.nationalities}>
              <option value="">—</option>
              {ref.nationalities?.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="ЖСН" error={errs.iin} hint={student?.iinMasked ? `Қазіргі: ${student.iinMasked}. Өзгерту үшін ғана толтырыңыз` : 'Шифрланып сақталады'}>
          <input className={`input mono ${errs.iin ? 'err' : ''}`} inputMode="numeric" maxLength={12} autoComplete="off" value={f.iin} onChange={(e) => setF((x) => ({ ...x, iin: e.target.value.replace(/\D/g, '') }))} />
        </Field>
        <Field label="Телефон" error={errs.phone}>
          <input className="input" type="tel" value={f.phone} onChange={set('phone')} placeholder="+7 7__ ___ __ __" />
        </Field>
        <Field label="Ата-анасы / заңды өкілі">
          <input className="input" value={f.parentName} onChange={set('parentName')} />
        </Field>
        <Field label="Ата-анасының телефоны" error={errs.parentPhone}>
          <input className="input" type="tel" value={f.parentPhone} onChange={set('parentPhone')} placeholder="+7 7__ ___ __ __" />
        </Field>
        <Field label="Мектепке келген күні">
          <input className="input" type="date" max={ref.today} value={f.enrolledAt} onChange={set('enrolledAt')} />
        </Field>
        <Field label="Бұрынғы мектебі">
          <input className="input" value={f.previousSchool} onChange={set('previousSchool')} />
        </Field>
        <Field label="Қосымша ақпарат" className="full">
          <textarea className="textarea" value={f.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
        {!can(PERM.STUDENTS_WRITE) && <div className="err-box full">Оқушыны өзгертуге рұқсат жоқ</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
