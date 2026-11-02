import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../lib/toast';
import { dateTime } from '../lib/format';
import { Badge, Card, DashboardCard, Empty, ErrorState, Spinner } from '../components/ui';

type Status = 'APPLIED' | 'UNMATCHED' | 'SKIPPED' | 'SUPERSEDED';

interface Item {
  id: number;
  testTitle: string;
  subjectName: string | null;
  className: string | null;
  studentName: string;
  kind: string | null;
  percent: number;
  submittedAt: string;
  status: Status;
  reason: string | null;
}

interface Data {
  configured: boolean;
  schoolCode: string | null;
  counts: Partial<Record<Status, number>>;
  items: Item[];
}

const LABEL: Record<Status, { text: string; tone: string }> = {
  APPLIED: { text: 'Журналда', tone: 'ok' },
  UNMATCHED: { text: 'Сәйкестенбеді', tone: 'bad' },
  SKIPPED: { text: 'Өткізілді', tone: 'warn' },
  SUPERSEDED: { text: 'Қайта тапсырылды', tone: '' },
};
const KIND: Record<string, string> = { FO: 'ФО', BJB: 'БЖБ', TJB: 'ТЖБ', ARALYK: 'Аралық' };

/** Тестілеу (test.imarlen.kz) нәтижелері: журналға автоматты түскені және сәйкестенбегендері. */
export function TestileuResults() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Status | ''>('');
  const q = useQuery({ queryKey: ['testileu', status], queryFn: () => api.get<Data>(`/testileu${status ? `?status=${status}` : ''}`) });
  const retry = useMutation({
    mutationFn: () => api.post<{ received: number; applied: number; unmatched: number }>('/testileu/retry'),
    onSuccess: (x) => {
      qc.invalidateQueries({ queryKey: ['testileu'] });
      toast(`${x.received} нәтиже қайта өңделді: ${x.applied} журналға түсті, ${x.unmatched} әлі сәйкестенбеді`);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Қате', 'error'),
  });

  if (q.isLoading) return <Spinner block />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const n = (s: Status) => d.counts[s] ?? 0;

  return (
    <div className="stack">
      <Card
        title="Тестілеу байланысы"
        sub="test.imarlen.kz-те бағаланған тест нәтижесі журналға автоматты түседі: ФО тесті — сабақ күнінің бағанына (1–10), атауында БЖБ / ТЖБ / Аралық бар тест — жиынтық бағалауға."
      >
        {!d.configured ? (
          <div className="err-box">
            Серверде <code>TESTILEU_INTEGRATION_KEY</code> орнатылмаған — нәтижелер қабылданбайды. USTAZ-дың .env файлына кілтті, ал Тестілеудің .env файлына сол кілтті{' '}
            <code>USTAZ_INTEGRATION_KEY</code> ретінде қосып, екі жүйені де қайта іске қосыңыз.
          </div>
        ) : !d.schoolCode ? (
          <div className="err-box">Бұл мектептің iMARLEN ID коды жоқ (Әкімші &gt; Мектептер). Тестілеу мектепті осы код бойынша табады.</div>
        ) : (
          <div className="muted" style={{ fontSize: 12.5 }}>
            Қосулы. Мектеп коды: <code>{d.schoolCode}</code>. Оқушы аты-жөні мен сыныбы, пән атауы бойынша сәйкестендіріледі. Оқушы тестті қайта тапсырса, журналда соңғы нәтиже қалады.
          </div>
        )}
      </Card>

      <div className="kpis">
        <DashboardCard label="Журналға түсті" value={n('APPLIED')} tone="ok" onClick={() => setStatus('APPLIED')} />
        <DashboardCard label="Сәйкестенбеді" value={n('UNMATCHED')} tone={n('UNMATCHED') ? 'bad' : undefined} onClick={() => setStatus('UNMATCHED')} />
        <DashboardCard label="Өткізілді" value={n('SKIPPED')} onClick={() => setStatus('SKIPPED')} />
        <DashboardCard label="Қайта тапсырылды" value={n('SUPERSEDED')} onClick={() => setStatus('SUPERSEDED')} />
      </div>

      <Card
        title="Соңғы нәтижелер"
        sub="Оқушы, пән немесе сынып USTAZ-да түзетілсе, «Қайта өңдеу» сәйкестенбеген нәтижелерді журналға қайта түсіреді."
        action={
          <div className="row">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status | '')}>
              <option value="">Барлығы</option>
              {(Object.keys(LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {LABEL[s].text}
                </option>
              ))}
            </select>
            <button className="btn" disabled={retry.isPending || !(n('UNMATCHED') + n('SKIPPED'))} onClick={() => retry.mutate()}>
              {retry.isPending && <Spinner />} Қайта өңдеу
            </button>
          </div>
        }
        flush
      >
        {d.items.length === 0 ? (
          <Empty>Әзірге нәтиже келмеген</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Тапсырылды</th>
                <th>Оқушы</th>
                <th>Сынып</th>
                <th>Пән</th>
                <th>Тест</th>
                <th className="num">%</th>
                <th>Күйі</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(i.submittedAt)}</td>
                  <td>{i.studentName}</td>
                  <td>{i.className ?? '—'}</td>
                  <td>{i.subjectName ?? '—'}</td>
                  <td>
                    {i.testTitle} {i.kind && <Badge tone="vio">{KIND[i.kind] ?? i.kind}</Badge>}
                  </td>
                  <td className="num">{Math.round(i.percent)}</td>
                  <td>
                    <Badge tone={LABEL[i.status].tone}>{LABEL[i.status].text}</Badge>
                    {i.reason && i.status !== 'APPLIED' && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {i.reason}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
