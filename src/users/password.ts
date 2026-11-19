import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** scrypt settings (OWASP-recommended minimum: N=2^17, r=8, p=1). */
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 32;

/** Stored as "scrypt$N$r$p$salt$hash" so settings can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/** A real hash of a random password, checked when the email is unknown. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/**
 * Checks a password. For unknown users, pass `undefined`: a dummy hash is
 * still checked, so the response time doesn't reveal which emails exist.
 */
export async function verifyPassword(
  password: string,
  stored: string | undefined,
): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = (stored ?? (await DUMMY_HASH)).split(
    '$',
  );
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(
    password,
    Buffer.from(salt, 'base64url'),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    },
  );
  return stored !== undefined && timingSafeEqual(actual, expected);
}
