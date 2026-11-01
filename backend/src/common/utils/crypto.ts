import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/** ЖСН сияқты жеке деректерді AES-256-GCM арқылы шифрлау. Формат: iv.tag.cipher (base64url). */
export class PiiCipher {
  private readonly key: Buffer;
  private readonly hashKey: Buffer;

  constructor(hexKey: string, hashKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error('PII_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    if (!hashKey || hashKey.length < 16) throw new Error('PII_HASH_KEY must be at least 16 chars');
    this.key = Buffer.from(hexKey, 'hex');
    this.hashKey = Buffer.from(hashKey, 'utf8');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  }

  hash(plain: string): string {
    return createHmac('sha256', this.hashKey).update(plain).digest('hex');
  }
}

/** Қазақстан ЖСН (12 сан) бақылау санын тексеру. */
export function isValidIin(iin: string): boolean {
  if (!/^\d{12}$/.test(iin)) return false;
  const d = iin.split('').map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let c = w1.reduce((s, w, i) => s + w * d[i], 0) % 11;
  if (c === 10) {
    c = w2.reduce((s, w, i) => s + w * d[i], 0) % 11;
    if (c === 10) return false;
  }
  return c === d[11];
}

/** Демо деректер үшін бақылау саны дұрыс ЖСН құрастыру. */
export function makeIin(birth: Date, gender: 'M' | 'F', serial: number): string {
  const yy = String(birth.getUTCFullYear()).slice(2);
  const mm = String(birth.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(birth.getUTCDate()).padStart(2, '0');
  const century = birth.getUTCFullYear() >= 2000 ? (gender === 'M' ? 5 : 6) : gender === 'M' ? 3 : 4;
  for (let s = serial; s < serial + 50; s++) {
    const base = `${yy}${mm}${dd}${century}${String(s % 10000).padStart(4, '0')}`;
    for (let k = 0; k <= 9; k++) {
      if (isValidIin(base + k)) return base + k;
    }
  }
  throw new Error('cannot build IIN');
}
