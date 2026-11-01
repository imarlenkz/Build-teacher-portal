import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Notification } from '../api/types';
import { dateTime } from '../lib/format';
import { Empty, Spinner } from './ui';

type NotifList = { items: Notification[]; unread: number };

export const SEV_COLOR = { INFO: 'acc', WARNING: 'warn', CRITICAL: 'bad' } as const;

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    // Ережелерді қайта есептеу (refresh) серверде шектелген: жиі жаңартқанда тек бар тізім оқылады.
    queryFn: async () => {
      const last = Number(sessionStorage.getItem('ustaz.notif.refresh') ?? 0);
      if (Date.now() - last < 120_000) return api.get<NotifList>('/notifications');
      sessionStorage.setItem('ustaz.notif.refresh', String(Date.now()));
      return api.post<NotifList>('/notifications/refresh').catch((e) => {
        if (e instanceof ApiError && e.status === 429) return api.get<NotifList>('/notifications');
        throw e;
      });
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Хабарламаның сілтемесін фронтенд маршрутына айналдыру. */
export function notificationHref(n: Notification) {
  const p = n.link?.params ?? {};
  const q = new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString();
  const base: Record<string, string> = {
    analytics: '/analytics',
    'tjb-analysis': '/tjb-analysis',
    movements: '/movements',
    report: '/report',
    students: '/students',
    attendance: '/attendance',
  };
  return `${base[n.link?.screen ?? ''] ?? '/notifications'}${q ? `?${q}` : ''}`;
}

export function NotificationList({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const q = useNotifications();
  const qc = useQueryClient();
  const nav = useNavigate();
  const read = useMutation({
    mutationFn: (id: number) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  if (q.isLoading) return <Spinner block />;
  const items = q.data?.items ?? [];
  if (!items.length) return <Empty>Жаңа ескерту жоқ</Empty>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.slice(0, compact ? 5 : 100).map((n) => (
        <button
          key={n.id}
          className={`alert-item ${n.readAt ? '' : 'unread'}`}
          onClick={() => {
            if (!n.readAt) read.mutate(n.id);
            onNavigate?.();
            nav(notificationHref(n));
          }}
        >
          <span className="dot" style={{ background: `var(--${SEV_COLOR[n.severity]})`, marginTop: 6, opacity: n.readAt ? 0.4 : 1 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <span className="t">{n.title}</span>
            <span className="s">
              {n.body}
              {!compact && ` · ${dateTime(n.createdAt)}`}
            </span>
          </span>
          {!compact && <span className="btn sm" aria-hidden>Ашу →</span>}
        </button>
      ))}
    </div>
  );
}
