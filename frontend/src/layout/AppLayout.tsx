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

  type Item = { to: string; label: string; icon: IconName; show?: boolean; badge?: number };
  const groups: { key: string; label?: string; items: Item[] }[] = [
    { key: 'home', items: [{ to: '/', label: t('nav.dashboard'), icon: 'home' }] },
    {
      key: 'students',
      label: t('navGroup.students'),
      items: [
        { to: '/students', label: t('nav.students'), icon: 'users' },
        { to: '/classes', label: t('nav.classes'), icon: 'grid' },
        { to: '/attendance', label: t('nav.attendance'), icon: 'check' },
        { to: '/movements', label: t('nav.movements'), icon: 'swap' },
      ],
    },
    {
      key: 'assess',
      label: t('navGroup.assess'),
      items: [
        { to: '/journal', label: t('nav.journal'), icon: 'book' },
        { to: '/bjb', label: t('nav.bjb'), icon: 'doc' },
        { to: '/tjb', label: t('nav.tjb'), icon: 'doc' },
        { to: '/aralyk', label: t('nav.aralyk'), icon: 'doc', show: ref.classes.some((c) => c.grade >= 2 && c.grade <= 4) },
      ],
    },
    {
      key: 'reports',
      label: t('navGroup.reports'),
      items: [
        { to: '/tjb-analysis', label: t('nav.tjbAnalysis'), icon: 'chart' },
        { to: '/report', label: t('nav.report'), icon: 'file' },
        { to: '/analytics', label: t('nav.analytics'), icon: 'trend' },
      ],
    },
    {
      key: 'system',
      label: t('navGroup.system'),
      items: [
        { to: '/notifications', label: t('nav.notifications'), icon: 'bell', badge: unread },
        { to: '/audit', label: t('nav.audit'), icon: 'shield', show: can(PERM.AUDIT) },
        { to: '/admin', label: t('nav.admin'), icon: 'sliders', show: can(PERM.USERS) || can(PERM.CLASSES) },
        { to: '/settings', label: t('nav.settings'), icon: 'gear' },
      ],
    },
  ];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ustaz.navCollapsed') ?? '{}');
    } catch {
      return {};
    }
  });
  const toggleGroup = (key: string) =>
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      try {
        localStorage.setItem('ustaz.navCollapsed', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname === to || loc.pathname.startsWith(to + '/'));
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
            U
          </div>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-sub">{t('app.tagline')}</div>
          </div>
        </div>
        <nav className="nav">
          {groups.map((g) => {
            const visible = g.items.filter((i) => i.show !== false);
            if (!visible.length) return null;
            const hasActive = visible.some((i) => isActive(i.to));
            const open = !g.label || hasActive || !collapsed[g.key];
            const groupBadge = visible.reduce((n, i) => n + (i.badge ?? 0), 0);
            return (
              <div key={g.key} className="nav-group">
                {g.label && (
                  <button className="nav-group-head" onClick={() => toggleGroup(g.key)} aria-expanded={open} disabled={hasActive}>
                    <span>{g.label}</span>
                    {!open && groupBadge > 0 && <span className="count-badge">{groupBadge}</span>}
                    <svg className={`chev ${open ? 'open' : ''}`} viewBox="0 0 24 24" width="12" height="12" aria-hidden>
                      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {open &&
                  visible.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <NavIcon name={i.icon} />
                      <span className="nav-label">{i.label}</span>
                      {!!i.badge && <span className="count-badge">{i.badge}</span>}
                    </NavLink>
                  ))}
              </div>
            );
          })}
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

type IconName = 'home' | 'users' | 'grid' | 'check' | 'swap' | 'book' | 'doc' | 'chart' | 'file' | 'trend' | 'bell' | 'shield' | 'sliders' | 'gear';
const ICONS: Record<IconName, string> = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 20v-2a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  check: 'M4 4h16v16H4zM8 12l3 3 5-6',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  book: 'M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h8',
  doc: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  file: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2',
};
function NavIcon({ name }: { name: IconName }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
