import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Талдау қорытындыларын жасайтын қабат. Бірінші нұсқада ережеге негізделген (RuleBasedInsights).
 * Кейін AI модулін қосу үшін INSIGHTS_PROVIDER токеніне басқа іске асыруды байлау жеткілікті —
 * барлық модуль осы интерфейс арқылы ғана жұмыс істейді.
 */
export interface CriterionStat {
  code: string;
  topic: string;
  avgPct: number;
  below50: number;
}

export interface AssessmentInsightInput {
  type: 'BJB' | 'TJB' | 'ARALYK';
  title: string;
  subject: string;
  className: string;
  avgPct: number;
  quality: number;
  progress: number;
  count: number;
  lowCount: number;
  criteria: CriterionStat[];
}

export interface CriterionVerdict {
  code: string;
  verdict: 'weak' | 'strong' | 'normal';
}

export interface AssessmentInsight {
  verdicts: CriterionVerdict[];
  weakest?: CriterionStat;
  strongest?: CriterionStat;
  text: string[];
}

export interface QuarterSummaryInput {
  className: string;
  subject: string;
  quarter: number;
  students: number;
  attendancePct: number | null;
  tjbAvg: number | null;
  /** 'ТЖБ' немесе 2–4 сыныптарда 'Аралық'. */
  summative?: string;
  quality: number | null;
  progress: number | null;
  prevTjbAvg: number | null;
  struggling: number;
  topCount: number;
  arrived: number;
  left: number;
}

export interface RiskInput {
  studentId: number;
  fullName: string;
  attendancePct: number | null;
  unexcused: number;
  tjbPct: number | null;
  bjbPct: number | null;
  lowLevel: boolean;
}

export interface RiskVerdict {
  studentId: number;
  score: number;
  reasons: string[];
}

export interface InsightsProvider {
  readonly name: string;
  assessment(input: AssessmentInsightInput): Promise<AssessmentInsight>;
  quarterSummary(input: QuarterSummaryInput): Promise<string>;
  risk(rows: RiskInput[], attendanceThreshold: number): Promise<RiskVerdict[]>;
}

export const INSIGHTS_PROVIDER = Symbol('INSIGHTS_PROVIDER');

@Injectable()
export class RuleBasedInsights implements InsightsProvider {
  readonly name = 'rules';

  async assessment(i: AssessmentInsightInput): Promise<AssessmentInsight> {
    const crit = i.criteria;
    if (!crit.length) {
      const text = [`Орташа нәтиже ${i.avgPct}%, сапа ${i.quality}%, үлгерім ${i.progress}%.`];
      if (i.lowCount) text.push(`${i.lowCount} оқушы төмен деңгейде — жеке жұмыс жоспарлау ұсынылады.`);
      return { verdicts: [], text };
    }
    const min = crit.reduce((a, b) => (b.avgPct < a.avgPct ? b : a));
    const max = crit.reduce((a, b) => (b.avgPct > a.avgPct ? b : a));
    const verdicts = crit.map((c) => ({
      code: c.code,
      verdict: (c === min || c.avgPct < 65 ? 'weak' : c === max && c.avgPct >= 80 ? 'strong' : 'normal') as CriterionVerdict['verdict'],
    }));
    const text = [
      `«${min.topic}» (${min.code}, ${min.avgPct}%) — ең әлсіз критерий: ${min.below50} оқушы 50%-дан төмен алды.`,
      `Ең жақсы нәтиже — «${max.topic}» (${max.code}, ${max.avgPct}%).`,
    ];
    const weakOthers = crit.filter((c) => c !== min && c.avgPct < 65);
    if (weakOthers.length) text.push(`Қосымша назар аудару керек тақырыптар: ${weakOthers.map((c) => `«${c.topic}» (${c.avgPct}%)`).join(', ')}.`);
    text.push(`Келесі тоқсанда «${min.topic}» тақырыбына қайталау сабағын жоспарлау ұсынылады.`);
    return { verdicts, weakest: min, strongest: max, text };
  }

  async quarterSummary(i: QuarterSummaryInput): Promise<string> {
    const parts: string[] = [];
    parts.push(`${i.className} сыныбы, «${i.subject}» пәні бойынша ${i.quarter}-тоқсанда ${i.students} оқушы оқыды.`);
    if (i.attendancePct != null) parts.push(`Сабаққа қатысу ${i.attendancePct}% құрады.`);
    if (i.tjbAvg != null) {
      let s = `${i.summative ?? 'ТЖБ'} орташа нәтижесі ${i.tjbAvg}%`;
      if (i.prevTjbAvg != null) {
        const d = Math.round((i.tjbAvg - i.prevTjbAvg) * 10) / 10;
        s += d === 0 ? ' (алдыңғы тоқсанмен бірдей)' : d > 0 ? ` (алдыңғы тоқсаннан +${d} п.)` : ` (алдыңғы тоқсаннан ${d} п.)`;
      }
      parts.push(`${s}, сапа ${i.quality}%, үлгерім ${i.progress}%.`);
    }
    if (i.topCount) parts.push(`${i.topCount} оқушы жоғары нәтиже көрсетті.`);
    if (i.struggling) parts.push(`${i.struggling} оқушы қиындық көріп отыр — жеке қолдау қажет.`);
    if (i.arrived || i.left) parts.push(`Тоқсанда ${i.arrived} оқушы келді, ${i.left} оқушы кетті.`);
    return parts.join(' ');
  }

  async risk(rows: RiskInput[], threshold: number): Promise<RiskVerdict[]> {
    return rows
      .map((r) => {
        const reasons: string[] = [];
        let score = 0;
        if (r.attendancePct != null && r.attendancePct < threshold) {
          reasons.push(`қатысу ${r.attendancePct}%`);
          score += 2;
        }
        if (r.unexcused >= 3) {
          reasons.push(`${r.unexcused} себепсіз`);
          score += 1;
        }
        if (r.lowLevel) {
          reasons.push(`ТЖБ ${r.tjbPct}%`);
          score += 2;
        }
        if (r.bjbPct != null && r.bjbPct < 40) {
          reasons.push(`БЖБ ${r.bjbPct}%`);
          score += 1;
        }
        return { studentId: r.studentId, score, reasons };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }
}

@Global()
@Module({
  providers: [{ provide: INSIGHTS_PROVIDER, useClass: RuleBasedInsights }],
  exports: [INSIGHTS_PROVIDER],
})
export class InsightsModule {}
