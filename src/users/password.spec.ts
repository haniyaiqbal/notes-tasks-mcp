import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(hash).not.toContain('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for unknown users (after doing the same work)', async () => {
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
  });
});
