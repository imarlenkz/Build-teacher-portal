import { decodeJwt, IDP_ROLE_MAP, IdpError, safeNext } from '../src/modules/auth/idp.service';

describe('safeNext (open redirect guard)', () => {
  it('keeps internal paths', () => {
    expect(safeNext('/attendance?date=2026-11-01')).toBe('/attendance?date=2026-11-01');
    expect(safeNext('/')).toBe('/');
  });
  it('rejects external, protocol-relative and api targets', () => {
    for (const bad of ['https://evil.kz', '//evil.kz', '/\\evil.kz', 'javascript:alert(1)', '/api/auth/logout', '', undefined, 42, '/a b']) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

describe('decodeJwt', () => {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  it('reads the payload', () => {
    const t = `${enc({ alg: 'RS256' })}.${enc({ sub: 'u1', aud: 'ustaz', nonce: 'n' })}.sig`;
    expect(decodeJwt(t)).toMatchObject({ sub: 'u1', aud: 'ustaz', nonce: 'n' });
  });
  it('throws IdpError on malformed tokens', () => {
    expect(() => decodeJwt('a.b')).toThrow(IdpError);
    expect(() => decodeJwt('a.!!!.c')).toThrow(IdpError);
  });
});

describe('role mapping', () => {
  it('admits only staff roles', () => {
    expect(IDP_ROLE_MAP.teacher).toBe('TEACHER');
    expect(IDP_ROLE_MAP.school_admin).toBe('SCHOOL_ADMIN');
    expect(IDP_ROLE_MAP.platform_owner).toBe('ADMIN');
    expect(IDP_ROLE_MAP.student).toBeUndefined();
    expect(IDP_ROLE_MAP.parent).toBeUndefined();
  });
});
