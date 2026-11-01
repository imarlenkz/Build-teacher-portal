import type { Level } from '../api/types';

export interface AssessmentListItem {
  id: number;
  type: AssessmentType;
  title: string;
  section: string | null;
  classId: number;
  className: string;
  subjectId: number;
  subject: string;
  quarterId: number;
  quarter: number;
  groupId: number | null;
  groupName: string | null;
  maxScore: number;
  date: string | null;
  results: number;
  criteria: number;
  avgPct: number;
}

export interface AssessmentRow {
  studentId: number;
  fullName: string;
  studentCode: string;
  entered: boolean;
  absent: boolean;
  score: number | null;
  pct: number | null;
  criteria: (number | null)[];
  level: string | null;
  levelIndex: number | null;
}

export interface ScoreStats {
  count: number;
  avgScore: number;
  avgPct: number;
  maxPct: number;
  minPct: number;
  maxScore: number;
  minScore: number;
  quality: number;
  progress: number;
  distribution: number[];
}

export interface CriterionAnalysis {
  code: string;
  topic: string;
  maxScore: number;
  avgScore: number;
  avgPct: number;
  below50: number;
  struggling: string[];
  verdict: 'weak' | 'strong' | 'normal';
}

export interface AssessmentDetail extends Omit<AssessmentListItem, 'results' | 'criteria' | 'avgPct'> {
  criteria: { id: number; code: string; topic: string; maxScore: number }[];
  levels: Level[];
  rows: AssessmentRow[];
  stats: ScoreStats;
  entered: number;
  criteriaAnalysis: CriterionAnalysis[];
  insight: string[];
  top: { studentId: number; fullName: string; pct: number }[];
  low: { studentId: number; fullName: string; pct: number }[];
}

export const round1 = (x: number) => Math.round(x * 10) / 10;

/** Backend-тегі levelIndex-пен бірдей: пайыз бүтінге дөңгелектеніп, деңгейдің басымен салыстырылады. */
export function levelIndexOf(pct: number, levels: Level[]): number {
  const p = Math.round(pct);
  for (let i = levels.length - 1; i >= 0; i--) if (p >= levels[i].fromPct) return i;
  return 0;
}

/** Енгізу кезінде серверге сұраныссыз жедел есептеу (сақталғаннан кейін сервер нәтижесімен ауыстырылады). */
export function liveStats(rows: { score: number; pct: number }[], levels: Level[]): ScoreStats {
  const n = rows.length;
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const idx = rows.map((r) => levelIndexOf(r.pct, levels));
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

export type AssessmentType = 'BJB' | 'TJB' | 'ARALYK';
export const TYPE_KK: Record<AssessmentType, string> = { BJB: 'БЖБ', TJB: 'ТЖБ', ARALYK: 'Аралық бағалау' };
/** 2–4 сыныптарда БЖБ/ТЖБ орнына аралық бағалау алынады. */
export const usesInterim = (grade?: number) => !!grade && grade >= 2 && grade <= 4;
