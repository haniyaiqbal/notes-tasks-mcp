import { Logger } from '@nestjs/common';
import type { McpTokenVerifier } from '@nestjs/mcp';
import type { AuthInfo } from '@modelcontextprotocol/server';
import {
  createLocalJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import { effectiveScopes } from './scopes.js';

/** What a verified token tells the tools. */
export interface McpUserInfo {
  userId: string;
}

/**
 * Checks the bearer token on every MCP request, as an OAuth resource server:
 * signature, issuer, audience, expiry and token type. Anything wrong means
 * `null`, which the MCP module turns into 401 with a `WWW-Authenticate`
 * challenge pointing the client at our OAuth metadata.
 */
export class JwtTokenVerifier implements McpTokenVerifier {
  private readonly logger = new Logger(JwtTokenVerifier.name);
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly issuer: string,
    /** This MCP server's URL. Tokens for any other API are refused. */
    private readonly resource: string,
    publicKeys: JWK[],
  ) {
    this.keys = createLocalJWKSet({ keys: publicKeys });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        // RFC 8707: a token issued for another API must not work here.
        audience: this.resource,
        // RFC 9068: only access tokens, never an ID token passed by mistake.
        typ: 'at+jwt',
        algorithms: ['ES256'],
        requiredClaims: ['sub', 'exp', 'client_id'],
      });
      return {
        token,
        clientId: String(payload.client_id),
        scopes: effectiveScopes(
          typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        ),
        expiresAt: payload.exp,
        resource: new URL(this.resource),
        // `sub` is guaranteed by requiredClaims above.
        extra: { userId: payload.sub! } satisfies McpUserInfo,
      };
    } catch (error) {
      this.logger.debug(`Rejected token: ${(error as Error).message}`);
      return null;
    }
  }
}

/** The public half of the signing key: all a resource server needs. */
export function publicJwk(privateJwk: Record<string, unknown>): JWK {
  const { d: _private, ...rest } = privateJwk;
  return { ...rest, use: 'sig', alg: 'ES256' } as JWK;
}
