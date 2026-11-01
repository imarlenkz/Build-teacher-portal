import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { QuarterRef, Reference } from '../api/types';

interface RefCtx {
  ref: Reference;
  quarterId: number;
  setQuarterId: (id: number) => void;
  quarter: QuarterRef;
  year: Reference['years'][number];
  subjectsOf: (classId?: number | null) => { id: number; name: string }[];
  groupsOf: (classId: number, subjectId: number) => Reference['groups'];
  className: (id?: number | null) => string;
  subjectName: (id?: number | null) => string;
}

const Ctx = createContext<RefCtx>(null!);

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['reference'], queryFn: () => api.get<Reference>('/reference'), staleTime: 5 * 60_000 });
  const [quarterId, setQuarterId] = useState<number | null>(() => Number(sessionStorage.getItem('ustaz.quarter')) || null);
  useEffect(() => {
    if (q.data && (!quarterId || !q.data.years.some((y) => y.quarters.some((qq) => qq.id === quarterId)))) {
      setQuarterId(q.data.currentQuarterId ?? q.data.years[0]?.quarters[0]?.id ?? null);
    }
  }, [q.data, quarterId]);
  useEffect(() => {
    if (quarterId) sessionStorage.setItem('ustaz.quarter', String(quarterId));
  }, [quarterId]);

  const value = useMemo<RefCtx | null>(() => {
    const ref = q.data;
    if (!ref || !quarterId) return null;
    const year = ref.years.find((y) => y.quarters.some((qq) => qq.id === quarterId)) ?? ref.years[0];
    const quarter = year.quarters.find((qq) => qq.id === quarterId) ?? year.quarters[0];
    return {
      ref,
      quarterId,
      setQuarterId,
      quarter,
      year,
      subjectsOf: (classId) => {
        if (!classId) return ref.subjects;
        const ids = new Set(ref.classSubjects.filter((c) => c.classId === classId).map((c) => c.subjectId));
        return ref.subjects.filter((s) => ids.has(s.id));
      },
      groupsOf: (classId, subjectId) => ref.groups.filter((g) => g.classId === classId && g.subjectId === subjectId),
      className: (id) => ref.classes.find((c) => c.id === id)?.name ?? '—',
      subjectName: (id) => ref.subjects.find((s) => s.id === id)?.name ?? '—',
    };
  }, [q.data, quarterId]);

  if (q.isError) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="err-box">Анықтамалықтарды жүктеу мүмкін болмады: {(q.error as Error).message}</div>
          <button className="btn" onClick={() => q.refetch()}>
            Қайталау
          </button>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="loading-block" style={{ height: '100%' }}>
        <span className="spinner" aria-label="Жүктелуде" />
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRef_ = () => useContext(Ctx);
export { useRef_ as useReference };
