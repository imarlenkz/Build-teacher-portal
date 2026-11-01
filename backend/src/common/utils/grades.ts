import { Level, levelIndex, round1 } from './stats';

/** ҚР БҒМ №125 бұйрығы бойынша әдепкі салмақтар: ФО 25%, БЖБ 25%, ТЖБ 50%. */
export interface GradeWeights {
  fo: number;
  bjb: number;
  tjb: number;
}

export const DEFAULT_WEIGHTS: GradeWeights = { fo: 25, bjb: 25, tjb: 50 };
/** Ағымдағы бағаның шкаласы. */
export const FO_MAX = 10;

/** Пайыз → бес балдық баға. 4 деңгей бапталса, мектеп диапазоны қолданылады; әйтпесе ресми шек 85/65/40. */
export function markFromPct(pct: number, levels: Level[]): number {
  if (levels.length === 4) return 2 + levelIndex(pct, levels);
  const p = Math.round(pct);
  return p >= 85 ? 5 : p >= 65 ? 4 : p >= 40 ? 3 : 2;
}

export interface QuarterInput {
  /** Ағымдағы бағалар (1–10). */
  fo: number[];
  /** Қатысқан БЖБ-лар: алынған балл мен максимум. */
  bjb: { score: number; max: number }[];
  /** Қатысқан ТЖБ (болмаса null). */
  tjb: { score: number; max: number } | null;
}

export interface QuarterComputed {
  foPct: number | null;
  bjbPct: number | null;
  tjbPct: number | null;
  /** Салмақталған қорытынды пайыз. Ешбір құрамдас болмаса null. */
  pct: number | null;
  mark: number | null;
  /** Есепке кірмеген (деректері жоқ) құрамдастар. */
  missing: ('fo' | 'bjb' | 'tjb')[];
}

/**
 * Тоқсандық пайыз = Σ(салмақ × құрамдас %) / Σ(салмақ).
 * Деректері жоқ құрамдас (мысалы, тоқсанда ТЖБ жоқ) есептен шығып, қалғандарының салмағы
 * пропорционалды артады — ФО 25 / БЖБ 25 болса, әрқайсысы 50% болады (ресми ереже).
 */
export function computeQuarter(input: QuarterInput, w: GradeWeights, levels: Level[]): QuarterComputed {
  const foPct = input.fo.length ? (input.fo.reduce((s, x) => s + x, 0) / (input.fo.length * FO_MAX)) * 100 : null;
  const bMax = input.bjb.reduce((s, x) => s + x.max, 0);
  const bjbPct = bMax > 0 ? (input.bjb.reduce((s, x) => s + x.score, 0) / bMax) * 100 : null;
  const tjbPct = input.tjb && input.tjb.max > 0 ? (input.tjb.score / input.tjb.max) * 100 : null;
  const parts: [keyof GradeWeights, number | null][] = [
    ['fo', foPct],
    ['bjb', bjbPct],
    ['tjb', tjbPct],
  ];
  let sw = 0;
  let sum = 0;
  const missing: QuarterComputed['missing'] = [];
  for (const [k, v] of parts) {
    if (w[k] <= 0) continue;
    if (v == null) {
      missing.push(k);
      continue;
    }
    sw += w[k];
    sum += w[k] * v;
  }
  const pct = sw > 0 ? round1(sum / sw) : null;
  return {
    foPct: foPct == null ? null : round1(foPct),
    bjbPct: bjbPct == null ? null : round1(bjbPct),
    tjbPct: tjbPct == null ? null : round1(tjbPct),
    pct,
    mark: pct == null ? null : markFromPct(pct, levels),
    missing,
  };
}

/** Жылдық баға: қойылған тоқсандық бағалардың орташасы, 0.5 жоғары дөңгелектенеді. */
export function yearMark(marks: (number | null)[]): number | null {
  const m = marks.filter((x): x is number => x != null);
  if (!m.length) return null;
  return Math.floor(m.reduce((s, x) => s + x, 0) / m.length + 0.5);
}
