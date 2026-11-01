import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Field } from '../components/ui';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
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
            Ұ
          </div>
          <div>
            <div className="brand-name">Ұстаз</div>
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
        <Field label="Логин">
          <input className="input" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
        </Field>
        <Field label="Құпиясөз">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Кіру…' : 'Кіру'}
        </button>
        <div className="muted" style={{ fontSize: 11.5 }}>
          Құпиясөзді ұмытсаңыз, мектеп әкімшісіне хабарласыңыз.
        </div>
      </form>
    </div>
  );
}
