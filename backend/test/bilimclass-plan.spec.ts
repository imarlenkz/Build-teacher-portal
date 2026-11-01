import { buildPlan, groupKey, parseClassName, parseDay, parseKind, teacherMatcher } from '../src/modules/bilimclass/bilimclass.plan';

const students = [
  { id: 1, fullName: 'Ахметов Ерлан Серікұлы' },
  { id: 2, fullName: 'Бекова Айгерім' },
  { id: 3, fullName: 'Сейіт Нұрлан' },
];
const subjects = [
  { id: 10, name: 'Жаратылыстану' },
  { id: 11, name: 'Шетел тілі' },
];
const teachers = [
  { id: 100, fullName: 'Жақыпова Алия Болатқызы' },
  { id: 101, fullName: 'Жақыпов Асқар' },
];

describe('bilimclass helpers', () => {
  it('parses class names with a language suffix', () => {
    expect(parseClassName('4 А ҚАЗ')).toEqual({ grade: 4, letter: 'А' });
    expect(parseClassName('10Ә РУС')).toEqual({ grade: 10, letter: 'Ә' });
    expect(parseClassName('11-Б')).toEqual({ grade: 11, letter: 'Б' });
    expect(parseClassName('ҚАЗ')).toBeNull();
  });

  it('normalises group names to a key', () => {
    expect(groupKey('Барлық сынып')).toBeNull();
    expect(groupKey('')).toBeNull();
    expect(groupKey('1 топ')).toBe('1');
    expect(groupKey('Группа 2')).toBe('2');
    expect(groupKey('2-топ')).toBe('2');
  });

  it('parses dates and types', () => {
    expect(parseDay('09.09.26')).toBe('2026-09-09');
    expect(parseDay('14.10.2026')).toBe('2026-10-14');
    expect(parseDay('31.02.26')).toBeNull();
    expect(parseKind('ФО')).toBe('FO');
    expect(parseKind('аралық')).toBe('ARALYK');
    expect(parseKind('СОЧ')).toBe('TJB');
    expect(parseKind('БЖБ')).toBe('BJB');
  });

  it('matches teachers by full name or surname + initials', () => {
    const find = teacherMatcher(teachers);
    expect(find('Жақыпова Алия Болатқызы')).toBe(100);
    expect(find('Жақыпова А.Б.')).toBe(100);
    expect(find('Жақыпов А.')).toBe(101);
    expect(find('Белгісіз Б.')).toBeNull();
  });
});

describe('buildPlan', () => {
  it('builds groups, FO columns, interim assessments and quarter marks for grade 4', () => {
    const p = buildPlan(
      [
        {
          subject: 'Шетел тілі',
          group: '1 топ',
          teacher: 'Жақыпова А.Б.',
          student: 'Ахметов Ерлан Серікұлы',
        },
        {
          subject: 'Шетел тілі',
          group: '2 топ',
          teacher: 'Жақыпов А.',
          student: 'Бекова Айгерім',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          teacher: 'Жақыпова А.Б.',
          student: 'Бекова Айгерім',
        },
      ],
      [
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Ахметов Ерлан',
          date: '09.09.26',
          type: 'ФО',
          mark: '6',
          max: '10',
          quarterMark: '4',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Ахметов Ерлан',
          date: '09.09.26',
          type: 'ФО',
          mark: '8',
          max: '10',
          quarterMark: '4',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Бекова Айгерім',
          date: '09.09.26',
          type: 'ФО',
          mark: '9',
          max: '10',
          quarterMark: '5',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Ахметов Ерлан',
          date: '14.10.26',
          type: 'аралық',
          mark: '11',
          max: '16',
          quarterMark: '4',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Ахметов Ерлан',
          date: '20.10.26',
          type: 'БЖБ',
          mark: '5',
          max: '10',
          quarterMark: '4',
        },
        {
          subject: 'Шетел тілі',
          group: '1 топ',
          student: 'Ахметов Ерлан',
          date: '10.09.26',
          type: 'ФО',
          mark: 'н',
          max: '10',
          quarterMark: '',
        },
        {
          subject: 'Сынып сағаты',
          group: 'Барлық сынып',
          student: 'Сейіт Нұрлан',
          date: '',
          type: '',
          mark: '',
          max: '',
          quarterMark: '5',
        },
        {
          subject: 'Жаратылыстану',
          group: 'Барлық сынып',
          student: 'Белгісіз Оқушы',
          date: '09.09.26',
          type: 'ФО',
          mark: '7',
          max: '10',
          quarterMark: '',
        },
      ],
      { grade: 4, students, subjects, teachers },
    );

    expect(p.missingSubjects).toEqual(['Сынып сағаты']);
    expect(p.students.unmatched).toEqual(['Белгісіз Оқушы']);
    expect(p.groups.map((g) => [g.subject, g.key, g.teacherId, g.members])).toEqual([
      ['Шетел тілі', '1', 100, [1]],
      ['Шетел тілі', '2', 101, [2]],
    ]);
    // Бір күні екі ФО → екі баған
    expect(p.fo.filter((c) => c.subject === 'Жаратылыстану').map((c) => [c.date, c.slot, c.marks])).toEqual([
      [
        '2026-09-09',
        0,
        [
          { studentId: 1, value: 6 },
          { studentId: 2, value: 9 },
        ],
      ],
      ['2026-09-09', 1, [{ studentId: 1, value: 8 }]],
    ]);
    expect(p.summatives).toEqual([
      {
        subject: 'Жаратылыстану',
        groupKey: null,
        type: 'ARALYK',
        date: '2026-10-14',
        maxScore: 16,
        title: 'Аралық бағалау 1',
        results: [{ studentId: 1, score: 11, percent: 68.8 }],
      },
    ]);
    // 4-сыныпта БЖБ қабылданбайды
    expect(p.warnings.some((w) => w.includes('БЖБ қабылданбайды'))).toBe(true);
    expect(p.quarterMarks).toEqual(
      expect.arrayContaining([
        { subject: 'Жаратылыстану', studentId: 1, mark: 4 },
        { subject: 'Жаратылыстану', studentId: 2, mark: 5 },
        { subject: 'Сынып сағаты', studentId: 3, mark: 5 },
      ]),
    );
    expect(p.skipped).toBe(3); // «н», БЖБ (4-сынып), белгісіз оқушы
  });

  it('numbers БЖБ by date and scales ФО given on another scale', () => {
    const p = buildPlan(
      [],
      [
        {
          subject: 'Жаратылыстану',
          group: '',
          student: 'Бекова Айгерім',
          date: '20.10.26',
          type: 'БЖБ',
          mark: '8',
          max: '10',
        },
        {
          subject: 'Жаратылыстану',
          group: '',
          student: 'Бекова Айгерім',
          date: '01.10.26',
          type: 'БЖБ',
          mark: '15',
          max: '20',
        },
        {
          subject: 'Жаратылыстану',
          group: '',
          student: 'Бекова Айгерім',
          date: '24.10.26',
          type: 'ТЖБ',
          mark: '20',
          max: '25',
        },
        {
          subject: 'Жаратылыстану',
          group: '',
          student: 'Бекова Айгерім',
          date: '05.09.26',
          type: 'ФО',
          mark: '4',
          max: '5',
        },
      ],
      { grade: 7, students, subjects, teachers },
    );
    expect(p.summatives.map((s) => [s.title, s.date])).toEqual([
      ['БЖБ 1', '2026-10-01'],
      ['БЖБ 2', '2026-10-20'],
      ['ТЖБ', '2026-10-24'],
    ]);
    expect(p.fo[0].marks).toEqual([{ studentId: 2, value: 8 }]);
  });
  it('takes the quarter mark from «тоқсандық» rows', () => {
    const p = buildPlan(
      [],
      [
        { subject: 'Жаратылыстану', group: 'Барлық сынып', student: 'Бекова Айгерім', date: '', type: 'тоқсандық', mark: '5', max: '', quarterMark: '' },
        { subject: 'Жаратылыстану', group: 'Барлық сынып', student: 'Сейіт Нұрлан', date: '', type: 'тоқсандық', mark: '', max: '', quarterMark: '3' },
      ],
      { grade: 7, students, subjects, teachers },
    );
    expect(p.quarterMarks).toEqual([
      { subject: 'Жаратылыстану', studentId: 2, mark: 5 },
      { subject: 'Жаратылыстану', studentId: 3, mark: 3 },
    ]);
    expect(p.skipped).toBe(0);
    expect(p.warnings).toEqual([]);
  });
});
