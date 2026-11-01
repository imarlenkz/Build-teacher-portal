import { Level, levelIndex, round1 } from './stats';

/** ҚР БҒМ №125 бұйрығы бойынша әдепкі салмақтар: ФО 25%, БЖБ 25%, ТЖБ 50%. */
export interface GradeWeights {
  fo: number;
  bjb: number;
  tjb: number;
  /** Аралық бағалау (2–4 сыныптар). */
  interim?: number;
}

export const DEFAULT_WEIGHTS: GradeWeights = { fo: 25, bjb: 25, tjb: 50 };
/** 2–4 сыныптар: БЖБ/ТЖБ орнына аралық бағалау. */
export const DEFAULT_PRIMARY_WEIGHTS: GradeWeights = { fo: 50, bjb: 0, tjb: 0, interim: 50 };

/** 2–4 сыныптарда БЖБ/ТЖБ орнына аралық бағалау алынады. */
export const usesInterim = (grade: number) => grade >= 2 && grade <= 4;

/** Сынып параллеліне қарай салмақтар. */
export function weightsFor(grade: number, s: { foWeight: number; bjbWeight: number; tjbWeight: number; primaryFoWeight: number; interimWeight: number }): GradeWeights {
  return usesInterim(grade) ? { fo: s.primaryFoWeight, bjb: 0, tjb: 0, interim: s.interimWeight } : { fo: s.foWeight, bjb: s.bjbWeight, tjb: s.tjbWeight, interim: 0 };
}
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
  /** Қатысқан аралық бағалаулар. */
  interim?: { score: number; max: number }[];
}

export interface QuarterComputed {
  foPct: number | null;
  bjbPct: number | null;
  tjbPct: number | null;
  interimPct: number | null;
  /** Салмақталған қорытынды пайыз. Ешбір құрамдас болмаса null. */
  pct: number | null;
  mark: number | null;
  /** Есепке кірмеген (деректері жоқ) құрамдастар. */
  missing: ('fo' | 'bjb' | 'tjb' | 'interim')[];
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
  const iMax = (input.interim ?? []).reduce((s, x) => s + x.max, 0);
  const interimPct = iMax > 0 ? ((input.interim ?? []).reduce((s, x) => s + x.score, 0) / iMax) * 100 : null;
  const parts: [keyof GradeWeights, number | null][] = [
    ['fo', foPct],
    ['bjb', bjbPct],
    ['tjb', tjbPct],
    ['interim', interimPct],
  ];
  let sw = 0;
  let sum = 0;
  const missing: QuarterComputed['missing'] = [];
  for (const [k, v] of parts) {
    if (!w[k] || w[k]! <= 0) continue;
    if (v == null) {
      missing.push(k);
      continue;
    }
    sw += w[k]!;
    sum += w[k]! * v;
  }
  const pct = sw > 0 ? round1(sum / sw) : null;
  return {
    foPct: foPct == null ? null : round1(foPct),
    bjbPct: bjbPct == null ? null : round1(bjbPct),
    tjbPct: tjbPct == null ? null : round1(tjbPct),
    interimPct: interimPct == null ? null : round1(interimPct),
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
