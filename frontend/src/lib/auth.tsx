import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';
import type { Me } from '../api/types';

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  can: (perm: string) => boolean;
  refetch: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  const logout = useCallback(async () => {
    const sso = qc.getQueryData<Me | null>(['me'])?.idp;
    await api.post('/auth/logout').catch(() => undefined);
    if (sso) {
      // iMARLEN ID сессиясын да жабамыз, әйтпесе келесі «кіру» құпиясөзсіз қайта кіргізеді.
      const r = await api.get<{ url: string | null }>('/auth/idp/logout-url').catch(() => null);
      if (r?.url) {
        window.location.assign(r.url);
        return;
      }
    }
    // qc.clear() белсенді ['me'] бақылаушысын жаңартпайды — экран өзгермей қалатын.
    // Бетті толық қайта жүктеу кэшті де, күйді де тазалап, кіру бетін ашады.
    window.location.replace('/');
  }, [qc]);
  const value = useMemo<AuthCtx>(
    () => ({
      me: q.data ?? null,
      loading: q.isLoading,
      can: (p) => !!q.data?.permissions.includes(p),
      refetch: () => void q.refetch(),
      logout,
    }),
    [q.data, q.isLoading, q, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const PERM = {
  STUDENTS_WRITE: 'students.write',
  IIN: 'students.iin.view',
  NATIONALITY: 'nationality.view',
  ATTENDANCE: 'attendance.write',
  MOVEMENTS: 'movements.write',
  ASSESS: 'assessments.write',
  EXPORT: 'reports.export',
  SCHOOL_WIDE: 'school.wide',
  LEVELS: 'levels.manage',
  SETTINGS: 'settings.manage',
  AUDIT: 'audit.read',
  CLASSES: 'classes.manage',
  USERS: 'users.manage',
  SCHOOLS: 'schools.manage',
  BACKUP: 'backup.manage',
  PLATFORM: 'platform.wide',
} as const;
