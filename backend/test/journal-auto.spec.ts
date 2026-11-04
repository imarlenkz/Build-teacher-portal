import { autoColumns } from '../src/modules/journal/journal-auto';

describe('autoColumns', () => {
  // 2026-11-02 — дүйсенбі
  it('creates one column per timetable lesson, skipping existing ones', () => {
    const r = autoColumns('2026-11-02', '2026-11-06', [1, 3, 3], new Map([['2026-11-04', 1]]));
    expect(r.map((c) => c.date)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('skips holidays', () => {
    const r = autoColumns('2026-12-14', '2026-12-20', [3, 6], new Map());
    expect(r.map((c) => c.date)).toEqual(['2026-12-19']); // 16.12 — мереке
  });

  it('takes topics from the plan', () => {
    const plan = new Map([
      ['2026-11-04', ['A', 'B']],
      ['2026-11-02', ['X', 'Y']],
    ]);
    const r = autoColumns('2026-11-02', '2026-11-04', [1, 3, 3], new Map(), plan);
    expect(r).toEqual([
      { date: '2026-11-02', topic: 'X; Y' },
      { date: '2026-11-04', topic: 'A' },
      { date: '2026-11-04', topic: 'B' },
    ]);
  });

  it('returns nothing without a timetable', () => {
    expect(autoColumns('2026-11-02', '2026-11-30', [], new Map())).toEqual([]);
  });
});
