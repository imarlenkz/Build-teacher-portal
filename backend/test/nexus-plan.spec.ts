import { buildPlan, classLetter, NexusLesson } from '../src/modules/nexus/nexus.plan';

const L = (o: Partial<NexusLesson>): NexusLesson => ({
  lesson_id: 'x',
  date: '2026-11-02',
  starts_at: '08:00',
  ends_at: '08:45',
  day_of_week: 1,
  period_index: 1,
  subject_name: 'Алгебра',
  teacher_name: 'Ахметова Гүлмира',
  teacher_email: 'akhmetova@school.kz',
  group_name: '9А',
  grade_level: 9,
  section: 'А',
  subgroup: null,
  classroom: null,
  ...o,
});

describe('buildPlan', () => {
  const existing = {
    teachers: [{ id: 1, fullName: 'Ахметова Гүлмира', email: null }],
    classes: [{ id: 10, grade: 9, letter: 'А' }],
    subjects: [{ id: 5, name: 'Алгебра' }],
  };

  it('matches teachers by email or name, classes by grade+letter, subjects by name', () => {
    const p = buildPlan(
      [L({}), L({ date: '2026-11-09' }), L({ subject_name: 'ағылшын тілі', teacher_name: 'Жақыпова А.', teacher_email: 'J@school.kz', group_name: '9 Ә', section: null, day_of_week: 2 })],
      existing,
    );
    expect(p.teachers.find((t) => t.email === 'akhmetova@school.kz')!.existingId).toBe(1);
    expect(p.teachers.find((t) => t.email === 'j@school.kz')!.existingId).toBeNull();
    expect(p.classes.map((c) => [c.name, c.existingId])).toEqual([
      ['9А', 10],
      ['9Ә', null],
    ]);
    expect(p.subjects.find((s) => s.name === 'Алгебра')!.existingId).toBe(5);
    // Екі күнгі бір апталық сабақ — бір слот.
    expect(p.slots.filter((s) => s.subject === 'Алгебра')).toHaveLength(1);
  });

  it('turns subgroup lessons into subject groups with their own teachers', () => {
    const p = buildPlan(
      [
        L({ subject_name: 'Информатика', subgroup: '1-топ', teacher_email: 'a@s.kz', teacher_name: 'A' }),
        L({ subject_name: 'Информатика', subgroup: '2-топ', teacher_email: 'b@s.kz', teacher_name: 'B' }),
        L({ subject_name: 'Информатика', subgroup: '1-топ', teacher_email: 'a@s.kz', teacher_name: 'A', day_of_week: 3 }),
      ],
      existing,
    );
    expect(p.groups).toEqual([
      { classKey: '9А', subject: 'Информатика', name: '1-топ', teacherEmail: 'a@s.kz' },
      { classKey: '9А', subject: 'Информатика', name: '2-топ', teacherEmail: 'b@s.kz' },
    ]);
    expect(p.assignments).toEqual([{ classKey: '9А', subject: 'Информатика', teacherEmail: 'a@s.kz' }]);
    expect(p.slots).toHaveLength(3);
  });

  it('takes the letter from the class name (Nexus section is a profile, often empty)', () => {
    expect(classLetter({ group_name: '1 А', grade_level: 1, section: null })).toBe('А');
    expect(classLetter({ group_name: '4 Ғ', grade_level: 4, section: null })).toBe('Ғ');
    expect(classLetter({ group_name: '10 А', grade_level: 10, section: 'ЖМБ' })).toBe('А');
    expect(classLetter({ group_name: '11 Ә', grade_level: 11, section: 'ҚГБ' })).toBe('Ә');
    expect(classLetter({ group_name: 'Арнайы', grade_level: 9, section: 'Б' })).toBe('Б');
    const p = buildPlan([L({ group_name: '10 А', grade_level: 10, section: 'ЖМБ' }), L({ group_name: '1 Ә', grade_level: 1, section: null })], existing);
    expect(p.classes.map((c) => c.key)).toEqual(['1Ә', '10А']);
    expect(p.warnings).toHaveLength(0);
  });

  it('skips classes without a usable letter and warns', () => {
    const p = buildPlan([L({ section: null, group_name: 'Арнайы' })], existing);
    expect(p.classes).toHaveLength(0);
    expect(p.warnings[0]).toContain('Арнайы');
  });
});
