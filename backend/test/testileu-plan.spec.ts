import { dayOf, detectKind, foValue, kindForGrade, parseGroupName, percentOf, pickQuarter, subjectMatcher } from '../src/modules/testileu/testileu.plan';

describe('testileu plan', () => {
  it('detects the assessment kind from the explicit field or the title', () => {
    expect(detectKind('TJB', 'Химия тест')).toBe('TJB');
    expect(detectKind(null, 'БЖБ №2 · Органикалық химия')).toBe('BJB');
    expect(detectKind(null, '1-тоқсанға арналған ТЖБ')).toBe('TJB');
    expect(detectKind(null, 'СОЧ за 1 четверть')).toBe('TJB');
    expect(detectKind(null, 'Аралық бағалау')).toBe('ARALYK');
    expect(detectKind(null, 'Атомның құрылысы')).toBe('FO');
    // «сор» сөздің ішінде болса — ФО
    expect(detectKind(null, 'Сорбция')).toBe('FO');
  });

  it('applies grade rules', () => {
    expect(kindForGrade('BJB', 3)).toEqual({ kind: 'ARALYK' });
    expect(kindForGrade('TJB', 9)).toEqual({ kind: 'TJB' });
    expect(kindForGrade('ARALYK', 9)).toHaveProperty('skip');
    expect(kindForGrade('TJB', 1)).toHaveProperty('skip');
    expect(kindForGrade('FO', 1)).toEqual({ kind: 'FO' });
  });

  it('maps percent to a 1–10 formative mark', () => {
    expect(foValue(0)).toBe(1);
    expect(foValue(84)).toBe(8);
    expect(foValue(95)).toBe(10);
    expect(foValue(100)).toBe(10);
    expect(percentOf({ score: 7, max_score: 10 })).toBe(70);
    expect(percentOf({ score: 7, max_score: 10, percent: 71 })).toBe(71);
  });

  it('picks the quarter by date, in the Almaty day', () => {
    const q = [
      { number: 1, startDate: new Date('2026-09-01'), endDate: new Date('2026-10-26') },
      { number: 2, startDate: new Date('2026-11-03'), endDate: new Date('2026-12-28') },
    ];
    expect(dayOf('2026-11-02T20:30:00.000Z')).toBe('2026-11-03');
    expect(pickQuarter(q, '2026-10-10')!.number).toBe(1);
    expect(pickQuarter(q, '2026-11-03')!.number).toBe(2);
    expect(pickQuarter(q, '2026-10-30')!.number).toBe(1); // демалыс — алдыңғы тоқсан
    expect(pickQuarter(q, '2026-10-30', 2)!.number).toBe(2);
    expect(pickQuarter(q, '2026-08-01')).toBeNull();
  });

  it('parses class names and matches subjects', () => {
    expect(parseGroupName('5-Ә')).toEqual({ grade: 5, letter: 'Ә' });
    expect(parseGroupName('11 А')).toEqual({ grade: 11, letter: 'А' });
    const m = subjectMatcher([{ id: 1, name: 'Химия' }, { id: 2, name: 'Ағылшын тілі (топ)' }]);
    expect(m('химия')).toBe(1);
    expect(m('Ағылшын тілі')).toBe(2);
    expect(m('Физика')).toBeNull();
  });
});

describe('nameMatcher', () => {
  const { nameMatcher } = require('../src/modules/testileu/testileu.plan');
  const m = nameMatcher([
    { id: 1, fullName: 'Қасымова Жанар Ерланқызы' },
    { id: 2, fullName: 'Оспан Дана' },
    { id: 3, fullName: 'Мұрат Ерлан Асқарұлы' },
    { id: 4, fullName: 'Мұрат Ерлан Бекұлы' },
  ]);
  it('ignores word order and the patronymic', () => {
    expect(m('Қасымова Жанар Ерланқызы')).toBe(1);
    expect(m('Жанар Қасымова')).toBe(1);
    expect(m('жанар  қасымова')).toBe(1);
    expect(m('Дана Оспан')).toBe(2);
    expect(m('Ерлан Мұрат Асқарұлы')).toBe(3);
  });
  it('refuses ambiguous or unknown names', () => {
    expect(m('Ерлан Мұрат')).toBeNull();
    expect(m('Белгісіз Бала')).toBeNull();
  });
});
