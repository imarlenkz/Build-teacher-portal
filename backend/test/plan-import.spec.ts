import ExcelJS from 'exceljs';
import { headerKey, parsePlanDate, parsePlanWorkbook, quarterOf } from '../src/modules/plan/plan-import';

async function book(rows: (string | number | Date | null)[][], merges: string[] = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('КТЖ');
  rows.forEach((r) => ws.addRow(r));
  merges.forEach((m) => ws.mergeCells(m));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('plan import helpers', () => {
  it('recognises headers in Kazakh and Russian', () => {
    expect(headerKey('Сабақ тақырыбы')).toBe('topic');
    expect(headerKey('Тема урока')).toBe('topic');
    expect(headerKey('Бөлім / ортақ тақырып')).toBe('section');
    expect(headerKey('Сквозная тема')).toBe('section');
    expect(headerKey('Оқу мақсаттары')).toBe('objectives');
    expect(headerKey('Цели обучения')).toBe('objectives');
    expect(headerKey('Сағат саны')).toBe('hours');
    expect(headerKey('Кол-во часов')).toBe('hours');
    expect(headerKey('Күні')).toBe('date');
    expect(headerKey('Дата')).toBe('date');
    expect(headerKey('№')).toBe('number');
    expect(headerKey('Ескерту')).toBe('notes');
    expect(headerKey('Бағалау критерийі')).toBeNull();
  });
  it('parses quarter markers', () => {
    expect(quarterOf('1-тоқсан')).toBe(1);
    expect(quarterOf('II тоқсан')).toBe(2);
    expect(quarterOf('3 четверть')).toBe(3);
    expect(quarterOf('IV четверть')).toBe(4);
    expect(quarterOf('2-ші тоқсан (16 сағат)')).toBe(2);
    expect(quarterOf('Тоқсан 3')).toBe(3);
    expect(quarterOf('Квадрат теңдеулер')).toBeNull();
  });
  it('parses dates with and without year', () => {
    expect(parsePlanDate('02.09.2026', 2026)).toBe('2026-09-02');
    expect(parsePlanDate('02.09', 2026)).toBe('2026-09-02');
    expect(parsePlanDate('15.01', 2026)).toBe('2027-01-15');
    expect(parsePlanDate('02.09-06.09', 2026)).toBe('2026-09-02');
    expect(parsePlanDate('2026-11-10', 2026)).toBe('2026-11-10');
    expect(parsePlanDate('31.02', 2026)).toBeNull();
    expect(parsePlanDate(new Date('2026-10-05T00:00:00Z'), 2026)).toBe('2026-10-05');
  });
});

describe('parsePlanWorkbook', () => {
  it('reads a typical КТЖ with title, quarter and section rows', async () => {
    const buf = await book(
      [
        ['Күнтізбелік-тақырыптық жоспар', null, null, null, null, null],
        ['7-сынып, алгебра', null, null, null, null, null],
        ['№', 'Бөлім', 'Сабақ тақырыбы', 'Оқу мақсаттары', 'Сағат саны', 'Күні'],
        [1, 2, 3, 4, 5, 6],
        ['1-тоқсан', null, null, null, null, null],
        ['1-бөлім. Дәрежелер', null, null, null, null, null],
        [1, null, 'Бүтін көрсеткішті дәреже', '7.1.2.1 дәрежені анықтау', 1, '02.09'],
        [2, null, 'Дәреженің қасиеттері', null, 2, '04.09.2026'],
        ['Барлығы', null, null, null, 3, null],
        ['2-тоқсан', null, null, null, null, null],
        [3, '2-бөлім. Көпмүшелер', 'Бірмүше', null, 1, null],
      ],
      ['A5:F5', 'A6:F6', 'A10:F10'],
    );
    const r = await parsePlanWorkbook(buf, { startYear: 2026 });
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ quarter: 1, section: '1-бөлім. Дәрежелер', topic: 'Бүтін көрсеткішті дәреже', objectives: '7.1.2.1 дәрежені анықтау', hours: 1, date: '2026-09-02' });
    expect(r.rows[1]).toMatchObject({ quarter: 1, section: '1-бөлім. Дәрежелер', hours: 2, date: '2026-09-04' });
    expect(r.rows[2]).toMatchObject({ quarter: 2, section: '2-бөлім. Көпмүшелер', topic: 'Бірмүше', date: null });
  });
  it('accepts a minimal Russian file with only a topic column', async () => {
    const buf = await book([['Тема'], ['Введение'], ['Повторение']]);
    const r = await parsePlanWorkbook(buf, { startYear: 2026 });
    expect(r.rows.map((x) => x.topic)).toEqual(['Введение', 'Повторение']);
    expect(r.rows.every((x) => x.hours === 1 && x.quarter == null)).toBe(true);
  });
  it('warns on unreadable dates and rejects files without a topic column', async () => {
    const r = await parsePlanWorkbook(await book([['№', 'Тақырып', 'Күні'], [1, 'А', 'ертең']]), { startYear: 2026 });
    expect(r.rows[0].date).toBeNull();
    expect(r.warnings).toHaveLength(1);
    await expect(parsePlanWorkbook(await book([['Аты', 'Тегі']]), { startYear: 2026 })).rejects.toThrow('Тақырып');
  });
});

describe('plan export round-trip', () => {
  it('re-imports a file produced by the export', async () => {
    const { ExportService } = await import('../src/modules/exports/export.service');
    const buf = await new ExportService().xlsx([
      {
        name: '1-тоқсан',
        title: 'Күнтізбелік-тақырыптық жоспар: 7А · Алгебра',
        subtitle: '1-тоқсан · 2026-2027 оқу жылы · 2 сабақ, 3 сағат',
        headers: ['№', 'Бөлім / ортақ тақырып', 'Сабақ тақырыбы', 'Оқу мақсаттары', 'Сағат саны', 'Күні', 'Ескерту', 'Журналда'],
        rows: [
          [1, 'Дәрежелер', 'Бүтін көрсеткішті дәреже', '7.1.2.1', 1, '02.09.2026', '', 'иә'],
          [2, 'Дәрежелер', 'Қасиеттері', null, 2, '', 'қайталау', ''],
        ],
      },
    ]);
    const r = await parsePlanWorkbook(buf, { startYear: 2026 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ quarter: 1, section: 'Дәрежелер', topic: 'Бүтін көрсеткішті дәреже', hours: 1, date: '2026-09-02' });
    expect(r.rows[1]).toMatchObject({ hours: 2, notes: 'қайталау', date: null });
  });
});
