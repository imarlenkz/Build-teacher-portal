/**
 * API клиенті: httpOnly cookie-мен жұмыс, CSRF тақырыбы, 401-де бір рет access токенді жаңарту.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const SCHOOL_KEY = 'ustaz.school';
export const getSchoolOverride = () => localStorage.getItem(SCHOOL_KEY);
export const setSchoolOverride = (id: number | null) => (id ? localStorage.setItem(SCHOOL_KEY, String(id)) : localStorage.removeItem(SCHOOL_KEY));

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)ustaz_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(q?: Query) {
  if (!q) return '';
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf();
  const school = getSchoolOverride();
  if (school) headers['X-School-Id'] = school;
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refresh()) return request<T>(method, path, body, false);
    onUnauthorized();
  }
  if (!res.ok) {
    let msg = `Қате (${res.status})`;
    let details: unknown;
    try {
      const j = await res.json();
      msg = j.message ?? msg;
      details = j.details;
    } catch {
      /* not json */
    }
    if (res.status === 429) msg = 'Тым көп сұраныс. Біраздан кейін қайталаңыз';
    throw new ApiError(res.status, msg, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', path + qs(q)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Файлды жүктеп алу (PDF/XLSX/CSV) — cookie арқылы авторизацияланады. */
export async function download(path: string, q?: Query) {
  const headers: Record<string, string> = {};
  const school = getSchoolOverride();
  if (school) headers['X-School-Id'] = school;
  let res = await fetch(`/api${path}${qs(q)}`, { credentials: 'same-origin', headers });
  if (res.status === 401 && (await refresh())) res = await fetch(`/api${path}${qs(q)}`, { credentials: 'same-origin', headers });
  if (!res.ok) {
    let msg = 'Экспорт сәтсіз';
    try {
      msg = (await res.json()).message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : 'export';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
