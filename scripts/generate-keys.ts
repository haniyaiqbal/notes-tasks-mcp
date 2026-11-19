/**
 * Prints fresh secrets for .env:
 *   npm run keys:generate
 *
 * OAUTH_SIGNING_KEY signs access tokens (ES256). Keep it secret; anyone with
 * it could mint tokens. COOKIE_SECRET signs the login-page cookies.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: randomUUID() };

console.log(`OAUTH_SIGNING_KEY='${JSON.stringify(jwk)}'`);
console.log(`COOKIE_SECRET=${randomBytes(32).toString('base64url')}`);
