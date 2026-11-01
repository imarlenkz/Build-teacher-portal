import { isValidIin, makeIin, PiiCipher } from '../src/common/utils/crypto';

const KEY = 'a'.repeat(64);
const HKEY = 'b'.repeat(64);

describe('PiiCipher', () => {
  const c = new PiiCipher(KEY, HKEY);
  it('round-trips and uses a random IV', () => {
    const a = c.encrypt('090315500123');
    const b = c.encrypt('090315500123');
    expect(a).not.toEqual(b);
    expect(c.decrypt(a)).toBe('090315500123');
  });
  it('detects tampering (GCM auth tag)', () => {
    const enc = c.encrypt('090315500123');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A') + enc.slice(-1);
    expect(() => c.decrypt(tampered)).toThrow();
  });
  it('hash is deterministic for lookups', () => {
    expect(c.hash('x')).toBe(c.hash('x'));
    expect(c.hash('x')).not.toBe(c.hash('y'));
  });
});

describe('IIN', () => {
  it('generates IINs that pass the official checksum', () => {
    for (let i = 1; i < 200; i++) {
      const iin = makeIin(new Date(Date.UTC(2010, i % 12, (i % 27) + 1)), i % 2 ? 'M' : 'F', i);
      expect(iin).toMatch(/^\d{12}$/);
      expect(isValidIin(iin)).toBe(true);
    }
  });
  it('rejects malformed values and wrong checksums', () => {
    expect(isValidIin('123')).toBe(false);
    expect(isValidIin('abcdefghijkl')).toBe(false);
    const ok = makeIin(new Date(Date.UTC(2012, 4, 9)), 'F', 77);
    const bad = ok.slice(0, 11) + String((Number(ok[11]) + 1) % 10);
    expect(isValidIin(bad)).toBe(false);
  });
});
