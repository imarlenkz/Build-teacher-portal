import { levelIndex, markStats, round1, scoreStats, validateLevels } from '../src/common/utils/stats';
import { DEFAULT_LEVELS } from '../src/modules/core/levels.service';

describe('levelIndex', () => {
  it('maps percentages to configured ranges (rounded)', () => {
    expect(levelIndex(0, DEFAULT_LEVELS)).toBe(0);
    expect(levelIndex(39.4, DEFAULT_LEVELS)).toBe(0);
    expect(levelIndex(39.5, DEFAULT_LEVELS)).toBe(1);
    expect(levelIndex(64, DEFAULT_LEVELS)).toBe(1);
    expect(levelIndex(65, DEFAULT_LEVELS)).toBe(2);
    expect(levelIndex(100, DEFAULT_LEVELS)).toBe(3);
  });
  it('follows custom ranges', () => {
    const lv = [
      { name: 'A', fromPct: 0, toPct: 49, order: 0 },
      { name: 'B', fromPct: 50, toPct: 100, order: 1 },
    ];
    expect(levelIndex(49, lv)).toBe(0);
    expect(levelIndex(50, lv)).toBe(1);
  });
});

describe('scoreStats', () => {
  it('computes average, min/max, quality and progress', () => {
    const rows = [30, 50, 70, 90].map((p) => ({ score: p / 10, pct: p }));
    const s = scoreStats(rows, DEFAULT_LEVELS);
    expect(s.count).toBe(4);
    expect(s.avgPct).toBe(60);
    expect(s.maxPct).toBe(90);
    expect(s.minPct).toBe(30);
    expect(s.distribution).toEqual([1, 1, 1, 1]);
    expect(s.quality).toBe(50); // Жақсы + Жоғары
    expect(s.progress).toBe(75); // Төменнен жоғары
  });
  it('handles empty input', () => {
    const s = scoreStats([], DEFAULT_LEVELS);
    expect(s.count).toBe(0);
    expect(s.quality).toBe(0);
    expect(s.distribution).toEqual([0, 0, 0, 0]);
  });
});

describe('validateLevels', () => {
  it('accepts the default scale', () => expect(validateLevels(DEFAULT_LEVELS)).toBeNull());
  it('rejects gaps, overlaps and incomplete coverage', () => {
    expect(validateLevels([{ name: 'A', fromPct: 0, toPct: 40 }, { name: 'B', fromPct: 42, toPct: 100 }] as never)).toMatch(/бос орын/);
    expect(validateLevels([{ name: 'A', fromPct: 0, toPct: 50 }, { name: 'B', fromPct: 50, toPct: 100 }] as never)).toMatch(/қабаттасады/);
    expect(validateLevels([{ name: 'A', fromPct: 5, toPct: 50 }, { name: 'B', fromPct: 51, toPct: 100 }] as never)).toMatch(/0%/);
    expect(validateLevels([{ name: 'A', fromPct: 0, toPct: 50 }, { name: 'B', fromPct: 51, toPct: 99 }] as never)).toMatch(/100%/);
    expect(validateLevels([{ name: 'A', fromPct: 0, toPct: 100 }] as never)).toMatch(/2–6/);
  });
});

describe('markStats', () => {
  it('computes quality, progress, average mark and SOU', () => {
    const s = markStats([5, 5, 4, 3, 2]);
    expect(s).toMatchObject({ count: 5, d5: 2, d4: 1, d3: 1, d2: 1, quality: 60, progress: 80, avgMark: 3.8 });
    expect(s.sou).toBe(round1((200 + 64 + 36 + 16) / 5));
  });
  it('returns nulls for an empty set', () => {
    expect(markStats([])).toMatchObject({ count: 0, quality: null, progress: null, avgMark: null, sou: null });
  });
});
