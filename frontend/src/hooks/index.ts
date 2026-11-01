import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return m;
}

/** URL query параметрлерімен синхрондалған сүзгі күйі (бетті жаңартқанда және сілтеме бөліскенде сақталады). */
export function useUrlState<T extends Record<string, string | number | undefined>>(defaults: T) {
  const [sp, setSp] = useSearchParams();
  const state = { ...defaults } as T;
  (Object.keys(defaults) as (keyof T)[]).forEach((k) => {
    const v = sp.get(k as string);
    if (v !== null) (state as Record<string, unknown>)[k as string] = typeof defaults[k] === 'number' ? Number(v) : v;
  });
  const set = (patch: Partial<T>) => {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === '' || v === null || v === defaults[k]) next.delete(k);
      else next.set(k, String(v));
    });
    setSp(next, { replace: true });
  };
  return [state, set] as const;
}
