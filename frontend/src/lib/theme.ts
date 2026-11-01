import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const EVT = 'ustaz:theme';

/** Тақырып күйі: бірнеше компонент (header, баптаулар) бір мәнді бөліседі. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    const fn = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    window.addEventListener(EVT, fn);
    return () => window.removeEventListener(EVT, fn);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('ustaz.theme', t);
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0e1114' : '#f4f5f7');
    window.dispatchEvent(new CustomEvent(EVT, { detail: t }));
  }, []);
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
