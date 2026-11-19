import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { JwtTokenVerifier, publicJwk } from './token-verifier.js';

const ISSUER = 'https://auth.example.com';
const RESOURCE = 'https://api.example.com/mcp';

describe('JwtTokenVerifier', () => {
  let privateKey: CryptoKey;
  let verifier: JwtTokenVerifier;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.privateKey)), kid: 'k1' };
    verifier = new JwtTokenVerifier(ISSUER, RESOURCE, [publicJwk(jwk)]);
  });

  function token(
    overrides: {
      aud?: string;
      iss?: string;
      typ?: string;
      exp?: string;
      scope?: string;
    } = {},
  ) {
    return new SignJWT({
      client_id: 'client-1',
      scope: overrides.scope ?? 'notes:read',
    })
      .setProtectedHeader({
        alg: 'ES256',
        typ: overrides.typ ?? 'at+jwt',
        kid: 'k1',
      })
      .setIssuer(overrides.iss ?? ISSUER)
      .setAudience(overrides.aud ?? RESOURCE)
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime(overrides.exp ?? '5m')
      .sign(privateKey);
  }

  it('accepts a valid token and returns who and what', async () => {
    const info = await verifier.verifyAccessToken(
      await token({ scope: 'notes:write tasks:read' }),
    );
    expect(info).toMatchObject({
      clientId: 'client-1',
      scopes: ['notes:read', 'notes:write', 'tasks:read'],
      resource: new URL(RESOURCE),
      extra: { userId: 'user-1' },
    });
    expect(info!.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it.each([
    ['another audience', { aud: 'https://other.example.com/api' }],
    ['another issuer', { iss: 'https://evil.example.com' }],
    ['an ID token instead of an access token', { typ: 'JWT' }],
    ['an expired token', { exp: '-1m' }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(
      verifier.verifyAccessToken(await token(overrides)),
    ).resolves.toBeNull();
  });

  it('refuses a token signed with another key', async () => {
    const other = await generateKeyPair('ES256');
    const forged = await new SignJWT({ client_id: 'x', scope: 'notes:write' })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(RESOURCE)
      .setSubject('user-1')
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verifier.verifyAccessToken(forged)).resolves.toBeNull();
  });

  it('refuses garbage', async () => {
    await expect(verifier.verifyAccessToken('not.a.token')).resolves.toBeNull();
  });

  it('never exposes the private key', () => {
    expect(
      publicJwk({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'secret' }),
    ).not.toHaveProperty('d');
  });
});
