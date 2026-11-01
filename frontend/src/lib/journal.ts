import type { Level } from '../api/types';
import { levelIndexOf, round1 } from './assess';

export interface Weights {
  fo: number;
  bjb: number;
  tjb: number;
  /** 2–4 сыныптар: аралық бағалау салмағы. */
  interim?: number;
}

export interface Computed {
  foPct: number | null;
  bjbPct: number | null;
  tjbPct: number | null;
  interimPct: number | null;
  pct: number | null;
  mark: number | null;
  missing: ('fo' | 'bjb' | 'tjb' | 'interim')[];
}

type ScoreCell = { score: number; absent: boolean; pct: number | null } | null;

export interface JournalRow {
  studentId: number;
  fullName: string;
  studentCode: string;
  left: boolean;
  marks: (number | null)[];
  foCount: number;
  foAvg: number | null;
  bjb: ScoreCell[];
  tjb: ScoreCell;
  interim: ScoreCell[];
  computed: Computed;
  final: { mark: number; computedPct: number | null; updatedAt: string } | null;
}

export interface Journal {
  classId: number;
  className: string;
  subjectId: number;
  subject: string;
  groupId: number | null;
  groupName: string | null;
  quarterId: number;
  quarter: number;
  startDate: string;
  endDate: string;
  canWrite: boolean;
  weights: Weights;
  levels: Level[];
  columns: { id: number; date: string; topic: string | null }[];
  bjb: { id: number; title: string; maxScore: number }[];
  tjb: { id: number; title: string; maxScore: number } | null;
  /** 2–4 сынып: БЖБ/ТЖБ орнына аралық бағалау. */
  primary: boolean;
  interim: { id: number; title: string; maxScore: number }[];
  rows: JournalRow[];
  finalsCount: number;
}

export interface JournalYear {
  classId: number;
  className: string;
  subjectId: number;
  subject: string;
  groupId: number | null;
  groupName: string | null;
  quarters: { id: number; number: number }[];
  rows: { studentId: number; fullName: string; studentCode: string; left: boolean; marks: (number | null)[]; year: number | null; complete: boolean }[];
  distribution: number[];
}

export const FO_MAX = 10;
export const MARK_COLOR: Record<number, string> = { 2: 'bad', 3: 'warn', 4: 'acc', 5: 'ok' };
export const PART_KK = { fo: 'ФО', bjb: 'БЖБ', tjb: 'ТЖБ', interim: 'Аралық бағалау' } as const;

/** Backend-тегі markFromPct-пен бірдей. */
export function markFromPct(pct: number, levels: Level[]): number {
  if (levels.length === 4) return 2 + levelIndexOf(pct, levels);
  const p = Math.round(pct);
  return p >= 85 ? 5 : p >= 65 ? 4 : p >= 40 ? 3 : 2;
}

/** Backend-тегі computeQuarter-мен бірдей: енгізу кезінде серверсіз жедел қайта есептеу. */
export function computeQuarter(fo: number[], bjbPct: number | null, tjbPct: number | null, w: Weights, levels: Level[], interimPct: number | null = null): Computed {
  const foPct = fo.length ? (fo.reduce((s, x) => s + x, 0) / (fo.length * FO_MAX)) * 100 : null;
  const parts: [keyof Weights, number | null][] = [
    ['fo', foPct],
    ['bjb', bjbPct],
    ['tjb', tjbPct],
    ['interim', interimPct],
  ];
  let sw = 0;
  let sum = 0;
  const missing: Computed['missing'] = [];
  for (const [k, v] of parts) {
    const wk = w[k] ?? 0;
    if (wk <= 0) continue;
    if (v == null) missing.push(k);
    else {
      sw += wk;
      sum += wk * v;
    }
  }
  const pct = sw > 0 ? round1(sum / sw) : null;
  return { foPct: foPct == null ? null : round1(foPct), bjbPct, tjbPct, interimPct, pct, mark: pct == null ? null : markFromPct(pct, levels), missing };
}
