import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PERM, useAuth } from '../lib/auth';
import { useReference } from '../lib/reference';
import { useTheme } from '../lib/theme';
import { initials, ROMAN } from '../lib/format';
import { NotificationList, useNotifications } from '../components/NotificationPanel';
import { api, getSchoolOverride, setSchoolOverride } from '../api/client';
import { Field, Modal } from '../components/ui';
import { useToast } from '../lib/toast';

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', fn);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', fn);
      document.removeEventListener('keydown', key);
    };
  }, []);
  return { open, setOpen, ref };
}

export function AppLayout() {
  const { t } = useTranslation();
  const { me, can, logout } = useAuth();
  const { ref, quarterId, setQuarterId, year } = useReference();
  const { theme, toggle } = useTheme();
  const notif = useNotifications();
  const unread = notif.data?.unread ?? 0;
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const np = usePopover();
  const up = usePopover();
  const [pwOpen, setPwOpen] = useState(false);
  const qc = useQueryClient();
  useEffect(() => setDrawer(false), [loc.pathname]);

  const items: { to: string; label: string; show?: boolean; badge?: number }[] = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/students', label: t('nav.students') },
    { to: '/classes', label: t('nav.classes') },
    { to: '/attendance', label: t('nav.attendance') },
    { to: '/movements', label: t('nav.movements') },
    { to: '/journal', label: t('nav.journal') },
    { to: '/bjb', label: t('nav.bjb') },
    { to: '/tjb', label: t('nav.tjb') },
    { to: '/tjb-analysis', label: t('nav.tjbAnalysis') },
    { to: '/report', label: t('nav.report') },
    { to: '/analytics', label: t('nav.analytics') },
    { to: '/notifications', label: t('nav.notifications'), badge: unread },
    { to: '/audit', label: t('nav.audit'), show: can(PERM.AUDIT) },
    { to: '/admin', label: t('nav.admin'), show: can(PERM.USERS) || can(PERM.CLASSES) },
    { to: '/settings', label: t('nav.settings') },
  ];
  const switchSchool = (id: number) => {
    setSchoolOverride(id === me?.school?.id && !getSchoolOverride() ? null : id);
    qc.clear();
    window.location.assign('/');
  };

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Негізгі мазмұнға өту
      </a>
      <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="Негізгі мәзір">
        <div className="brand">
          <div className="logo" aria-hidden>
            Ұ
          </div>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-sub">{t('app.tagline')}</div>
          </div>
        </div>
        <nav className="nav">
          {items
            .filter((i) => i.show !== false)
            .map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span>{i.label}</span>
                {!!i.badge && <span className="count-badge">{i.badge}</span>}
              </NavLink>
            ))}
        </nav>
        {me && me.schools.length > 1 && (
          <div className="field" style={{ marginTop: 'auto', padding: '0 4px' }}>
            <label htmlFor="school-switch">Мектеп</label>
            <select id="school-switch" className="select" value={me.school?.id} onChange={(e) => switchSchool(Number(e.target.value))}>
              {me.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </select>
          </div>
        )}
      </aside>
      {drawer && <div className="overlay mobile-only" style={{ zIndex: 110 }} onClick={() => setDrawer(false)} />}
      <div className="main-col">
        <header className="header">
          <button className="btn icon burger" onClick={() => setDrawer(true)} aria-label="Мәзірді ашу">
            ☰
          </button>
          <span className="school">{me?.school?.name}</span>
          <span className="chip hide-sm">
            {year.name} {t('common.schoolYear')}
          </span>
          <select className="chip acc" value={quarterId} onChange={(e) => setQuarterId(Number(e.target.value))} aria-label="Тоқсан">
            {ref.years.map((y) => (
              <optgroup key={y.id} label={y.name}>
                {y.quarters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {ROMAN[q.number - 1]} {t('common.quarter')}
                    {y.id !== ref.currentYearId ? ` · ${y.name}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="spacer" />
          <button className="btn hide-md" onClick={toggle} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
          </button>
          <div style={{ position: 'relative' }} ref={np.ref}>
            <button className="btn" onClick={() => np.setOpen(!np.open)} aria-expanded={np.open} aria-label={`${t('nav.notifications')}: ${unread}`}>
              <span className="hide-sm">{t('nav.notifications')}</span>
              <span className="mobile-only" aria-hidden>
                🔔
              </span>
              {unread > 0 && <span className="count-badge">{unread}</span>}
            </button>
            {np.open && (
              <div className="popover notif-panel">
                <div className="row" style={{ justifyContent: 'space-between', padding: '4px 4px 8px' }}>
                  <b>{t('nav.notifications')}</b>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      np.setOpen(false);
                      nav('/notifications');
                    }}
                  >
                    Барлығы →
                  </button>
                </div>
                <NotificationList compact onNavigate={() => np.setOpen(false)} />
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }} ref={up.ref}>
            <button className="user-box" onClick={() => up.setOpen(!up.open)} aria-expanded={up.open} aria-haspopup="menu">
              <span className="avatar">{initials(me?.fullName ?? '')}</span>
              <span className="hide-sm">
                <div className="user-name">{me?.fullName.split(' ').slice(0, 2).join(' ')}</div>
                <div className="user-title">{me?.title ?? me?.roleLabel}</div>
              </span>
            </button>
            {up.open && (
              <div className="popover" role="menu" style={{ padding: 4 }}>
                <div style={{ padding: '8px 12px' }}>
                  <div className="user-name">{me?.fullName}</div>
                  <div className="user-title">
                    {me?.roleLabel} · {me?.login}
                  </div>
                </div>
                <button className="menu-item" role="menuitem" onClick={toggle}>
                  {theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
                </button>
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    up.setOpen(false);
                    setPwOpen(true);
                  }}
                >
                  {t('common.changePassword')}
                </button>
                <button className="menu-item c-bad" role="menuitem" onClick={() => void logout()}>
                  {t('common.logout')}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>
      <nav className="tabbar" aria-label="Жылдам мәзір">
        <NavLink to="/" end>
          {t('tab.today')}
        </NavLink>
        <NavLink to="/attendance">{t('tab.attendance')}</NavLink>
        <NavLink to="/students">{t('tab.students')}</NavLink>
        <NavLink to="/tjb">{t('tab.assess')}</NavLink>
        <NavLink to="/notifications">
          {t('tab.notif')}
          {unread > 0 && <span className="tb-badge">{unread} жаңа</span>}
        </NavLink>
      </nav>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      toast('Құпиясөз өзгертілді');
      setCur('');
      setNext('');
      setRep('');
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const submit = () => {
    setErr(null);
    if (next.length < 8 || !/\d/.test(next) || !/\p{L}/u.test(next)) return setErr('Кемінде 8 таңба, әріп пен сан болуы керек');
    if (next !== rep) return setErr('Жаңа құпиясөздер сәйкес емес');
    m.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Құпиясөзді өзгерту"
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
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
        {err && <div className="err-box">{err}</div>}
        <Field label="Ағымдағы құпиясөз">
          <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="Жаңа құпиясөз" hint="Кемінде 8 таңба, әріп пен сан">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Қайталаңыз">
          <input className="input" type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
