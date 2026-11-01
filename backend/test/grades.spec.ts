import { computeQuarter, DEFAULT_WEIGHTS, markFromPct, yearMark } from '../src/common/utils/grades';
import { DEFAULT_LEVELS } from '../src/modules/core/levels.service';

describe('markFromPct', () => {
  it('uses official thresholds 85/65/40', () => {
    expect(markFromPct(100, DEFAULT_LEVELS)).toBe(5);
    expect(markFromPct(85, DEFAULT_LEVELS)).toBe(5);
    expect(markFromPct(84.4, DEFAULT_LEVELS)).toBe(4);
    expect(markFromPct(65, DEFAULT_LEVELS)).toBe(4);
    expect(markFromPct(64, DEFAULT_LEVELS)).toBe(3);
    expect(markFromPct(40, DEFAULT_LEVELS)).toBe(3);
    expect(markFromPct(39, DEFAULT_LEVELS)).toBe(2);
    expect(markFromPct(0, [])).toBe(2);
    expect(markFromPct(90, [])).toBe(5);
  });
});

describe('computeQuarter', () => {
  it('weights ФО 25 / БЖБ 25 / ТЖБ 50', () => {
    const r = computeQuarter({ fo: [8, 10], bjb: [{ score: 7, max: 10 }, { score: 13, max: 20 }], tjb: { score: 24, max: 30 } }, DEFAULT_WEIGHTS, DEFAULT_LEVELS);
    // ФО 90%, БЖБ 20/30 = 66.7%, ТЖБ 80% → 0.25*90 + 0.25*66.67 + 0.5*80 = 79.2
    expect(r.foPct).toBe(90);
    expect(r.bjbPct).toBe(66.7);
    expect(r.tjbPct).toBe(80);
    expect(r.pct).toBe(79.2);
    expect(r.mark).toBe(4);
    expect(r.missing).toEqual([]);
  });
  it('renormalises when ТЖБ is absent (ФО 50 / БЖБ 50)', () => {
    const r = computeQuarter({ fo: [9], bjb: [{ score: 8, max: 10 }], tjb: null }, DEFAULT_WEIGHTS, DEFAULT_LEVELS);
    expect(r.pct).toBe(85);
    expect(r.mark).toBe(5);
    expect(r.missing).toEqual(['tjb']);
  });
  it('returns null when nothing is entered', () => {
    const r = computeQuarter({ fo: [], bjb: [], tjb: null }, DEFAULT_WEIGHTS, DEFAULT_LEVELS);
    expect(r.pct).toBeNull();
    expect(r.mark).toBeNull();
  });
  it('ignores components with zero weight', () => {
    const r = computeQuarter({ fo: [2], bjb: [{ score: 10, max: 10 }], tjb: null }, { fo: 0, bjb: 50, tjb: 50 }, DEFAULT_LEVELS);
    expect(r.pct).toBe(100);
    expect(r.missing).toEqual(['tjb']);
  });
});

describe('yearMark', () => {
  it('rounds the average of quarter marks half up', () => {
    expect(yearMark([4, 5, 4, 5])).toBe(5);
    expect(yearMark([4, 4, 4, 5])).toBe(4);
    expect(yearMark([3, null, 4])).toBe(4);
    expect(yearMark([null, null])).toBeNull();
  });
});
