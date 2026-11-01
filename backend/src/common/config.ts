/** Іске қосылғанда env айнымалыларын тексеру: production-да әлсіз құпиялармен іске қосылмайды. */
export function validateEnv(env: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'PII_ENCRYPTION_KEY', 'PII_HASH_KEY'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
  if (env.NODE_ENV === 'production') {
    const secret = String(env.JWT_ACCESS_SECRET);
    if (secret.length < 32 || /change-me/i.test(secret)) throw new Error('JWT_ACCESS_SECRET is weak — set a random 32+ char value');
    if (/^0123456789abcdef/i.test(String(env.PII_ENCRYPTION_KEY))) throw new Error('PII_ENCRYPTION_KEY is the dev default');
    if (/change-me/i.test(String(env.PII_HASH_KEY))) throw new Error('PII_HASH_KEY is the dev default');
  }
  return env;
}
