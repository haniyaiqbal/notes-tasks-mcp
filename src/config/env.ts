import { z } from 'zod';

/**
 * Every environment variable the app reads. It refuses to start if one is
 * missing or wrong, so a bad deploy fails loudly instead of half-working.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),

  /**
   * The public address of this server, without a trailing slash. It is the
   * OAuth issuer, and `${APP_URL}/mcp` is the MCP endpoint (the "resource"
   * tokens are issued for).
   */
  APP_URL: z.url().transform((url) => url.replace(/\/+$/, '')),

  /**
   * The private key that signs access tokens, as a JSON Web Key (ES256).
   * Generate one with: npm run keys:generate
   */
  OAUTH_SIGNING_KEY: z.string().transform((value, ctx) => {
    try {
      const jwk = JSON.parse(value) as Record<string, unknown>;
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new Error();
      return jwk;
    } catch {
      ctx.addIssue({
        code: 'custom',
        message:
          'OAUTH_SIGNING_KEY must be a private P-256 JWK (npm run keys:generate)',
      });
      return z.NEVER;
    }
  }),
  /** Signs the login-page cookies. At least 32 random characters. */
  COOKIE_SECRET: z.string().min(32),

  /** Let MCP clients register themselves (RFC 7591). */
  ALLOW_DYNAMIC_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Let clients identify with an HTTPS URL (Client ID Metadata Documents). */
  ALLOW_CLIENT_METADATA_DOCUMENTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** For the stdio server only: whose notes and tasks it works with. */
  STDIO_USER_EMAIL: z
    .union([z.literal(''), z.email()])
    .optional()
    .transform((value) => value || undefined),
});

export type Env = z.infer<typeof envSchema>;

/** Reads and validates the environment outside Nest's DI (stdio, scripts). */
export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
