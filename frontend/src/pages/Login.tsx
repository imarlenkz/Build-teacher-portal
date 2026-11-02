import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Field } from '../components/ui';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  // iMARLEN ID-дан қатемен оралса — хабарды көрсетіп, URL-ді тазалаймыз.
  const [err, setErr] = useState<string | null>(() => new URLSearchParams(window.location.search).get('sso_error'));
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (!p.has('sso_error')) return;
    p.delete('sso_error');
    const qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const qc = useQueryClient();
  const idp = useQuery({
    queryKey: ['idp-config'],
    queryFn: () => api.get<{ enabled: boolean; passwordLogin: boolean }>('/auth/idp/config'),
    staleTime: Infinity,
    retry: 1,
  });
  const sso = idp.data?.enabled ?? false;
  const passwordForm = !sso || idp.data!.passwordLogin || showPassword;
  const next = window.location.pathname === '/' ? '/' : window.location.pathname + window.location.search;
  const ssoHref = `/api/auth/idp/start?next=${encodeURIComponent(next)}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!login.trim() || !password) return setErr('Логин мен құпиясөзді енгізіңіз');
    setBusy(true);
    try {
      await api.post('/auth/login', { login: login.trim(), password });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand" style={{ padding: 0 }}>
          <div className="logo" aria-hidden>
            U
          </div>
          <div>
            <div className="brand-name">USTAZ</div>
            <div className="brand-sub">мектеп порталы</div>
          </div>
        </div>
        <h1 className="page-title" style={{ fontSize: 18 }}>
          Жүйеге кіру
        </h1>
        {err && (
          <div className="err-box" role="alert">
            {err}
          </div>
        )}
        {sso && (
          <a className={`btn ${passwordForm && !idp.data!.passwordLogin ? '' : 'primary'}`} href={ssoHref} style={{ justifyContent: 'center' }}>
            iMARLEN ID арқылы кіру
          </a>
        )}
        {sso && passwordForm && <div className="muted" style={{ textAlign: 'center', fontSize: 12 }}>немесе логин мен құпиясөз</div>}
        {passwordForm && (
          <>
            <Field label="Логин">
              <input className="input" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
            </Field>
            <Field label="Құпиясөз">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <button className={`btn ${sso ? '' : 'primary'}`} type="submit" disabled={busy}>
              {busy ? 'Кіру…' : 'Кіру'}
            </button>
          </>
        )}
        {sso && !passwordForm && (
          <button type="button" className="btn ghost sm" onClick={() => setShowPassword(true)}>
            Әкімші ретінде құпиясөзбен кіру
          </button>
        )}
        <div className="muted" style={{ fontSize: 11.5 }}>
          {sso ? 'iMARLEN ID құпиясөзін ұмытсаңыз, мектеп әкімшісіне хабарласыңыз.' : 'Құпиясөзді ұмытсаңыз, мектеп әкімшісіне хабарласыңыз.'}
        </div>
      </form>
    </div>
  );
}
