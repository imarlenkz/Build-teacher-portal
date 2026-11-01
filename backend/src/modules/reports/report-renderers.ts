import { Injectable } from '@nestjs/common';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PdfPrinter = require('pdfmake');
import type { Content, ContentCanvas, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { ExportService, SheetSpec } from '../exports/export.service';
import { fmtDot } from '../../common/utils/dates';
import type { QuarterReportData } from './reports.service';

const fontDir = (pkg: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'fonts', 'complete', 'woff');

const INK = '#16181b';
const MUTED = '#5b626b';
const LINE = '#c9cdd2';
const LINE2 = '#e3e5e8';
const SOFT = '#f3f4f6';

const v = (x: number | null | undefined, suf = '') => (x == null ? '—' : `${x}${suf}`);

@Injectable()
export class ReportRenderers {
  private printer: PdfPrinter;

  constructor(private readonly exporter: ExportService) {
    const sans = fontDir('@ibm/plex-sans');
    const mono = fontDir('@ibm/plex-mono');
    this.printer = new PdfPrinter({
      Plex: {
        normal: path.join(sans, 'IBMPlexSans-Regular.woff'),
        bold: path.join(sans, 'IBMPlexSans-Bold.woff'),
        italics: path.join(sans, 'IBMPlexSans-Regular.woff'),
        bolditalics: path.join(sans, 'IBMPlexSans-Bold.woff'),
      },
      PlexSemi: {
        normal: path.join(sans, 'IBMPlexSans-SemiBold.woff'),
        bold: path.join(sans, 'IBMPlexSans-SemiBold.woff'),
        italics: path.join(sans, 'IBMPlexSans-SemiBold.woff'),
        bolditalics: path.join(sans, 'IBMPlexSans-SemiBold.woff'),
      },
      Mono: {
        normal: path.join(mono, 'IBMPlexMono-Regular.woff'),
        bold: path.join(mono, 'IBMPlexMono-SemiBold.woff'),
        italics: path.join(mono, 'IBMPlexMono-Regular.woff'),
        bolditalics: path.join(mono, 'IBMPlexMono-SemiBold.woff'),
      },
    });
  }

  private section(n: number | string, title: string): Content {
    return { text: `${n}. ${title}`, font: 'PlexSemi', fontSize: 11, margin: [0, 12, 0, 6] };
  }

  private table(headers: string[], rows: (string | number | null)[][], widths?: (string | number)[], numericFrom = 99): Content {
    const head: TableCell[] = headers.map((h) => ({ text: h, font: 'PlexSemi', fontSize: 8.5, color: MUTED, fillColor: SOFT }));
    const body: TableCell[][] = rows.map((r) =>
      r.map((c, i) => ({ text: c == null ? '—' : String(c), fontSize: 9, ...(i >= numericFrom ? { font: 'Mono', alignment: 'right' as const } : {}) })),
    );
    return {
      table: { headerRows: 1, widths: widths ?? headers.map(() => '*'), body: [head, ...body] },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i <= 1 ? LINE : LINE2),
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
    };
  }

  private kpi(label: string, value: string, sub?: string): Content {
    return {
      table: {
        widths: ['*'],
        body: [[{ stack: [{ text: label, fontSize: 8, color: MUTED }, { text: value, font: 'Mono', bold: true, fontSize: 15, margin: [0, 2, 0, 0] }, ...(sub ? [{ text: sub, fontSize: 7.5, color: MUTED }] : [])] }]],
      },
      layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingLeft: () => 7, paddingTop: () => 5, paddingBottom: () => 5 },
    };
  }

  private chart(d: QuarterReportData): Content {
    const S = d.meta.summative;
    const W = 515;
    const H = 120;
    const series: { key: 'tjbAvg' | 'bjbAvg' | 'quality' | 'progress'; color: string; name: string }[] = [
      { key: 'progress', color: '#2e8b57', name: 'Үлгерім' },
      { key: 'quality', color: '#2a62b8', name: 'Сапа' },
      { key: 'tjbAvg', color: '#7a4fb0', name: `${S} %` },
      { key: 'bjbAvg', color: '#b07a1f', name: 'БЖБ %' },
    ];
    const groups = d.dynamics.length;
    const gw = (W - 30) / groups;
    const bw = Math.min(16, (gw - 16) / series.length);
    const canvas: ContentCanvas['canvas'] = [];
    for (let y = 0; y <= 100; y += 25) {
      const yy = H - (y / 100) * H;
      canvas.push({ type: 'line', x1: 30, y1: yy, x2: W, y2: yy, lineWidth: 0.4, lineColor: LINE2, dash: y === 0 ? undefined : { length: 2 } });
    }
    d.dynamics.forEach((q, gi) => {
      series.forEach((s, si) => {
        const val = q[s.key];
        if (val == null) return;
        const h = (val / 100) * H;
        canvas.push({ type: 'rect', x: 30 + gi * gw + 8 + si * (bw + 2), y: H - h, w: bw, h, color: s.color });
      });
    });
    const axis: Content = {
      columns: [{ width: 30, text: '' }, ...d.dynamics.map((q) => ({ width: gw, text: q.label, fontSize: 8, color: MUTED, alignment: 'center' as const }))],
      margin: [0, 3, 0, 0],
    };
    const yLabels = {
      stack: [100, 75, 50, 25, 0].map((y, i) => ({ text: `${y}`, fontSize: 7, color: MUTED, font: 'Mono', margin: [0, i === 0 ? -4 : 21, 0, 0] as [number, number, number, number] })),
      width: 26,
    };
    const legend: Content = {
      columns: series.map((s) => ({ width: 'auto', columns: [{ canvas: [{ type: 'rect', x: 0, y: 2, w: 7, h: 7, color: s.color }], width: 10 }, { text: s.name, fontSize: 8, width: 'auto', margin: [0, 0, 12, 0] }] })),
      margin: [30, 6, 0, 0],
    };
    return { stack: [{ columns: [yLabels, { canvas, width: W - 26, margin: [-30, 0, 0, 0] }] } as Content, axis, legend], unbreakable: true };
  }

  async pdf(d: QuarterReportData): Promise<Buffer> {
    const S = d.meta.summative;
    const m = d.meta;
    const kpis: [string, string, string?][] = [
      ['1. Оқушылар саны', String(d.counts.students)],
      ['2. Ұлдар', String(d.counts.boys)],
      ['3. Қыздар', String(d.counts.girls)],
      ['6. Сабаққа қатысу', v(d.attendance?.pct, '%'), d.attendance ? `себепті ${d.attendance.excused} · себепсіз ${d.attendance.unexcused}` : undefined],
      ['7. БЖБ орташа', d.bjb.length ? `${Math.round((d.bjb.reduce((s, b) => s + b.avgPct, 0) / d.bjb.length) * 10) / 10}%` : '—', `${d.bjb.length} БЖБ`],
      [`8. ${S} орташа`, v(d.tjb?.avgPct, '%'), d.tjb ? `${d.tjb.title}` : undefined],
      ['9–10. Үлгерім / Сапа', `${v(d.overall.progress, '%')} / ${v(d.overall.quality, '%')}`],
      ['11. Орташа балл', d.tjb ? `${d.tjb.avgScore} / ${d.tjb.maxScore}` : '—'],
    ];
    const content: Content[] = [
      {
        columns: [
          { stack: [{ text: m.school.toUpperCase(), font: 'PlexSemi', fontSize: 9, color: MUTED }, { text: 'ТОҚСАНДЫҚ ЕСЕП', bold: true, fontSize: 17, margin: [0, 4, 0, 0] }] },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: `${m.schoolYear} оқу жылы · ${m.quarterLabel}`, fontSize: 9 },
              { text: `Құрылған күні: ${fmtDot(m.generatedAt.slice(0, 10))}`, fontSize: 9, color: MUTED },
              { text: m.status === 'SUBMITTED' ? 'Тапсырылды' : 'Жоба', fontSize: 9, color: m.status === 'SUBMITTED' ? '#2e7d4f' : MUTED },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1.2, lineColor: INK }], margin: [0, 0, 0, 8] },
      {
        table: {
          widths: [90, '*', 90, '*'],
          body: [
            [{ text: 'Сынып', color: MUTED, fontSize: 9 }, { text: m.className, font: 'PlexSemi', fontSize: 9.5 }, { text: 'Пән', color: MUTED, fontSize: 9 }, { text: m.subject, font: 'PlexSemi', fontSize: 9.5 }],
            [{ text: 'Мұғалім', color: MUTED, fontSize: 9 }, { text: m.teacher, fontSize: 9.5 }, { text: 'Кезең', color: MUTED, fontSize: 9 }, { text: `${fmtDot(m.period.from)} – ${fmtDot(m.period.to)}`, font: 'Mono', fontSize: 9 }],
          ],
        },
        layout: 'noBorders',
      },
      this.section('1–11', 'Негізгі көрсеткіштер'),
      {
        stack: [0, 1].map((row) => ({ columns: kpis.slice(row * 4, row * 4 + 4).map(([l, val, sub]) => this.kpi(l, val, sub)), columnGap: 6, margin: [0, 0, 0, 6] })),
      },
      this.section(4, 'Ұлт бойынша статистика'),
      d.nationality
        ? this.table(['Ұлты', 'Саны', '%'], d.nationality.map((n) => [n.name, n.count, Math.round((n.count / Math.max(1, d.counts.students)) * 1000) / 10]), ['*', 60, 60], 1)
        : { text: 'Ұлт бойынша дерек тек рұқсаты бар қызметкерлерге көрсетіледі.', fontSize: 9, color: MUTED, italics: true },
      this.section(5, 'Оқушы қозғалысы'),
      { text: `Келді: ${d.movement.arrived} · Кетті: ${d.movement.left} · Сыныптар арасында ауысты: ${d.movement.transferred}`, fontSize: 9.5, margin: [0, 0, 0, 4] },
      d.movement.items.length
        ? this.table(['Күні', 'Оқушы', 'Түрі', 'Қайдан', 'Қайда', 'Бұйрық'], d.movement.items.map((x) => [fmtDot(x.date), x.student, x.type, x.from, x.to, x.order]), [52, '*', 100, 60, 60, 50])
        : { text: 'Тоқсанда қозғалыс болған жоқ.', fontSize: 9, color: MUTED },
      this.section(7, 'БЖБ нәтижелері'),
      d.bjb.length
        ? this.table(['БЖБ', 'Макс.', 'Орташа балл', 'Орташа %', 'Сапа %', 'Үлгерім %'], d.bjb.map((b) => [b.section ? `${b.title} · ${b.section}` : b.title, b.maxScore, b.avgScore, b.avgPct, b.quality, b.progress]), ['*', 40, 60, 55, 45, 55], 1)
        : { text: 'БЖБ нәтижелері енгізілмеген.', fontSize: 9, color: MUTED },
      this.section(8, `${S} нәтижелері`),
      d.tjb
        ? this.table(
            ['Көрсеткіш', 'Мәні'],
            [
              ['Атауы', d.tjb.title],
              ['Орташа балл', `${d.tjb.avgScore} / ${d.tjb.maxScore}`],
              ['Орташа пайыз', `${d.tjb.avgPct}%`],
              ['Ең жоғары / ең төмен', `${d.tjb.maxPct}% / ${d.tjb.minPct}%`],
              ...d.levels.map((l, i) => [`${l.name} (${l.fromPct}–${l.toPct}%)`, `${d.tjb!.distribution[i]} оқушы`]),
            ],
            ['*', 150],
          )
        : { text: `${S} нәтижелері енгізілмеген.`, fontSize: 9, color: MUTED },
      this.section(12, 'Жоғары нәтиже көрсеткен оқушылар'),
      d.top.length
        ? this.table(['№', 'Аты-жөні', `${S} %`, 'БЖБ %', 'Қатысу %'], d.top.map((s, i) => [i + 1, s.fullName, s.tjbPct, s.bjbPct, s.attendancePct]), [20, '*', 55, 55, 55], 2)
        : { text: 'Жоғары деңгейдегі оқушы жоқ.', fontSize: 9, color: MUTED },
      this.section(13, 'Қиындық көріп отырған оқушылар'),
      d.struggling.length
        ? this.table(['№', 'Аты-жөні', 'Себебі', `${S} %`, 'Қатысу %'], d.struggling.map((s, i) => [i + 1, s.fullName, s.reasons.join(', '), s.tjbPct, s.attendancePct]), [20, '*', 150, 45, 50], 3)
        : { text: 'Қиындық көріп отырған оқушы жоқ.', fontSize: 9, color: MUTED },
      this.section(14, 'Тоқсандар бойынша динамика (I → IV)'),
      this.table(
        ['Тоқсан', `${S} %`, 'БЖБ %', 'Сапа %', 'Үлгерім %', 'Қатысу %'],
        d.dynamics.map((q) => [q.label, q.tjbAvg, q.bjbAvg, q.quality, q.progress, q.attendancePct]),
        ['*', 55, 55, 55, 60, 60],
        1,
      ),
      { text: '', margin: [0, 8, 0, 0] },
      this.chart(d),
      { text: 'Қорытынды', font: 'PlexSemi', fontSize: 11, margin: [0, 14, 0, 4] },
      { text: d.summary, fontSize: 9.5, lineHeight: 1.3 },
      {
        margin: [0, 34, 0, 0],
        columns: [
          { stack: [{ text: 'Пән мұғалімі', fontSize: 9, color: MUTED }, { text: `____________________  ${m.teacher}`, fontSize: 9.5, margin: [0, 14, 0, 0] }] },
          { stack: [{ text: 'Директордың оқу ісі жөніндегі орынбасары', fontSize: 9, color: MUTED }, { text: '____________________  ________________', fontSize: 9.5, margin: [0, 14, 0, 0] }] },
        ],
        unbreakable: true,
      },
    ];
    const doc: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 44],
      defaultStyle: { font: 'Plex', fontSize: 10, color: INK },
      info: { title: `Тоқсандық есеп · ${m.className} · ${m.subject} · ${m.quarterLabel}`, author: m.generatedBy, creator: 'Ұстаз' },
      footer: (page, pages) => ({
        columns: [
          { text: `${m.school} · ${m.className} · ${m.subject} · ${m.quarterLabel}`, fontSize: 7.5, color: MUTED },
          { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7.5, color: MUTED, font: 'Mono' },
        ],
        margin: [40, 14, 40, 0],
      }),
      content,
    };
    return new Promise((resolve, reject) => {
      const pdf = this.printer.createPdfKitDocument(doc);
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });
  }

  sheets(d: QuarterReportData): SheetSpec[] {
    const S = d.meta.summative;
    const m = d.meta;
    const title = `Тоқсандық есеп · ${m.className} · ${m.subject} · ${m.quarterLabel} · ${m.schoolYear}`;
    const sub = `${m.school} · Мұғалім: ${m.teacher}`;
    return [
      {
        name: 'Оқушылар',
        title,
        subtitle: sub,
        headers: ['№', 'Аты-жөні', 'Жынысы', 'Қатысу %', 'Себепсіз', 'БЖБ %', `${S} балл`, `${S} %`, 'Деңгей'],
        rows: d.students.map((s, i) => [i + 1, s.fullName, s.gender === 'M' ? 'Ұл' : 'Қыз', s.attendancePct, s.unexcused, s.bjbPct, s.tjbScore, s.tjbPct, s.level]),
      },
      {
        name: 'Статистика',
        title,
        subtitle: sub,
        headers: ['Көрсеткіш', 'Мәні'],
        rows: [
          ['Оқушылар саны', d.counts.students],
          ['Ұлдар', d.counts.boys],
          ['Қыздар', d.counts.girls],
          ['Келгендер', d.movement.arrived],
          ['Кеткендер', d.movement.left],
          ['Ауысқандар', d.movement.transferred],
          ['Қатысу %', d.attendance?.pct ?? null],
          ['Себепті', d.attendance?.excused ?? null],
          ['Себепсіз', d.attendance?.unexcused ?? null],
          ['Кешігу', d.attendance?.late ?? null],
          ...(d.nationality ?? []).map((n) => [`Ұлт: ${n.name}`, n.count] as [string, number]),
        ],
      },
      {
        name: 'Есеп',
        title,
        subtitle: sub,
        headers: ['Бөлім', 'Көрсеткіш', 'Мәні'],
        rows: [
          ...d.bjb.flatMap((b) => [
            ['БЖБ', `${b.title} — орташа %`, b.avgPct],
            ['БЖБ', `${b.title} — сапа %`, b.quality],
            ['БЖБ', `${b.title} — үлгерім %`, b.progress],
          ]),
          ...(d.tjb
            ? [
                [`${S}`, 'Орташа балл', d.tjb.avgScore],
                [`${S}`, 'Орташа %', d.tjb.avgPct],
                [`${S}`, 'Сапа %', d.tjb.quality],
                [`${S}`, 'Үлгерім %', d.tjb.progress],
                [`${S}`, 'Ең жоғары %', d.tjb.maxPct],
                [`${S}`, 'Ең төмен %', d.tjb.minPct],
              ]
            : []),
          ...d.top.map((s) => ['Жоғары нәтиже', s.fullName, s.tjbPct ?? s.bjbPct]),
          ...d.struggling.map((s) => ['Қиындық көретін', s.fullName, s.reasons.join(', ')]),
          ['Қорытынды', d.summary, null],
        ],
        widths: [18, 60, 40],
      },
      {
        name: 'Аналитика',
        title,
        subtitle: sub,
        headers: ['Тоқсан', `${S} %`, 'БЖБ %', 'Сапа %', 'Үлгерім %', 'Қатысу %'],
        rows: d.dynamics.map((q) => [q.label, q.tjbAvg, q.bjbAvg, q.quality, q.progress, q.attendancePct]),
      },
    ];
  }

  async xlsx(d: QuarterReportData) {
    return this.exporter.xlsx(this.sheets(d));
  }

  csv(d: QuarterReportData) {
    const S = d.meta.summative;
    return this.exporter.csv(
      ['№', 'Аты-жөні', 'Жынысы', 'Қатысу %', 'Себепсіз', 'БЖБ %', `${S} балл`, `${S} %`, 'Деңгей'],
      d.students.map((s, i) => [i + 1, s.fullName, s.gender === 'M' ? 'Ұл' : 'Қыз', s.attendancePct, s.unexcused, s.bjbPct, s.tjbScore, s.tjbPct, s.level]),
    );
  }
}
