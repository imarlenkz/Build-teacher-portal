export interface Level {
  name: string;
  fromPct: number;
  toPct: number;
  order: number;
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Пайыз қай деңгейге түседі (деңгейлер order бойынша сұрыпталған). */
export function levelIndex(pct: number, levels: Level[]): number {
  const p = Math.round(pct);
  for (let i = levels.length - 1; i >= 0; i--) if (p >= levels[i].fromPct) return i;
  return 0;
}

export interface ScoreStats {
  count: number;
  avgScore: number;
  avgPct: number;
  maxPct: number;
  minPct: number;
  maxScore: number;
  minScore: number;
  /** Сапа: жоғарғы екі деңгейдегі оқушылар үлесі (%). */
  quality: number;
  /** Үлгерім: ең төменгі деңгейден жоғары оқушылар үлесі (%). */
  progress: number;
  distribution: number[];
}

/**
 * Сапа мен үлгерім деңгей индексі арқылы есептеледі, сондықтан мектеп диапазонды өзгертсе,
 * барлық көрсеткіш автоматты түрде қайта есептеледі.
 */
export function scoreStats(rows: { score: number; pct: number }[], levels: Level[]): ScoreStats {
  const n = rows.length;
  const idx = rows.map((r) => levelIndex(r.pct, levels));
  const qualityFrom = Math.max(1, levels.length - 2);
  return {
    count: n,
    avgScore: round1(avg(rows.map((r) => r.score))),
    avgPct: round1(avg(rows.map((r) => r.pct))),
    maxPct: n ? round1(Math.max(...rows.map((r) => r.pct))) : 0,
    minPct: n ? round1(Math.min(...rows.map((r) => r.pct))) : 0,
    maxScore: n ? Math.max(...rows.map((r) => r.score)) : 0,
    minScore: n ? Math.min(...rows.map((r) => r.score)) : 0,
    quality: n ? Math.round((idx.filter((i) => i >= qualityFrom).length / n) * 100) : 0,
    progress: n ? Math.round((idx.filter((i) => i >= 1).length / n) * 100) : 0,
    distribution: levels.map((_, i) => idx.filter((x) => x === i).length),
  };
}

/** Деңгей диапазондарын тексеру: 0–100 толық жабылуы, бос орын мен қабаттасу болмауы керек. */
export function validateLevels(levels: { name: string; fromPct: number; toPct: number }[]): string | null {
  if (levels.length < 2 || levels.length > 6) return 'Деңгей саны 2–6 аралығында болуы керек';
  const sorted = [...levels].sort((a, b) => a.fromPct - b.fromPct);
  if (sorted[0].fromPct !== 0) return 'Бірінші деңгей 0%-дан басталуы керек';
  if (sorted[sorted.length - 1].toPct !== 100) return 'Соңғы деңгей 100%-бен аяқталуы керек';
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (!l.name?.trim()) return 'Деңгей атауы бос болмауы керек';
    if (l.fromPct > l.toPct) return `«${l.name}»: басы соңынан үлкен`;
    if (i > 0 && l.fromPct !== sorted[i - 1].toPct + 1) {
      return l.fromPct <= sorted[i - 1].toPct
        ? `«${sorted[i - 1].name}» мен «${l.name}» қабаттасады`
        : `«${sorted[i - 1].name}» мен «${l.name}» арасында бос орын бар`;
    }
  }
  return null;
}

export const ATTENDED = new Set(['P', 'K']);
export const ABSENT_EXCUSED = new Set(['S', 'A', 'O']);
