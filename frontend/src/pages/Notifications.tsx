import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useToast } from '../lib/toast';
import { NotificationList, useNotifications } from '../components/NotificationPanel';
import { Card, Spinner } from '../components/ui';

/** Ережеге негізделген ескертулер: төмен қатысу, ТЖБ төмен нәтиже, кеткен оқушылар, тапсырылмаған есептер. */
export default function Notifications() {
  const q = useNotifications();
  const qc = useQueryClient();
  const toast = useToast();
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('Барлығы оқылды деп белгіленді');
    },
  });
  const unread = q.data?.unread ?? 0;
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Хабарламалар</h1>
        <span className="page-sub">{unread ? `${unread} оқылмаған` : 'Барлығы оқылған'}</span>
        <span className="grow" />
        <button className="btn" onClick={() => (sessionStorage.removeItem('ustaz.notif.refresh'), q.refetch())} disabled={q.isFetching}>
          {q.isFetching ? <Spinner /> : '↻'} Жаңарту
        </button>
        <button className="btn" onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending}>
          Барлығын оқылды деп белгілеу
        </button>
      </div>
      <Card sub="Ескертулер деректер бойынша автоматты түрде жасалады: қатысу шегі, ТЖБ деңгейі, оқушы қозғалысы және есеп мерзімі.">
        <NotificationList />
      </Card>
    </div>
  );
}
