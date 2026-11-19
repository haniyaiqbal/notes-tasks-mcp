import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { NextFunction, Request, Response } from 'express';
import Provider, { errors, type Configuration } from 'oidc-provider';
import { DataSource } from 'typeorm';
import type { Env } from '../config/env.js';
import { ALL_SCOPES } from '../mcp/scopes.js';
import { UsersService } from '../users/users.service.js';
import { deleteExpiredEntries, PostgresAdapter } from './postgres-adapter.js';
import { renderErrorPage } from './views.js';

/** Paths the OAuth server answers. Everything else goes to Nest. */
const OAUTH_PATHS =
  /^\/(oauth\/(?!interaction\/)|\.well-known\/(oauth-authorization-server|openid-configuration)$)/;

/**
 * The OAuth 2.1 authorization server, built on `oidc-provider` (a certified
 * OpenID Connect implementation) instead of hand-written token code.
 *
 * It issues JWT access tokens for exactly one resource: this server's MCP
 * endpoint. The MCP endpoint then only checks those tokens, like any
 * separate API would (it never looks inside the OAuth server's database).
 */
@Injectable()
export class OAuthService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OAuthService.name);
  readonly issuer: string;
  /** The MCP endpoint's URL: the `resource` and the tokens' audience. */
  readonly resource: string;
  readonly provider: Provider;
  private cleanup?: NodeJS.Timeout;

  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
    @InjectDataSource() private readonly db: DataSource,
  ) {
    this.issuer = config.get('APP_URL', { infer: true });
    this.resource = `${this.issuer}/mcp`;
    const signingKey = config.get('OAUTH_SIGNING_KEY', { infer: true });

    const configuration: Configuration = {
      adapter: (name: string) => new PostgresAdapter(name, db),
      jwks: { keys: [{ ...signingKey, use: 'sig', alg: 'ES256' }] },
      cookies: { keys: [config.get('COOKIE_SECRET', { infer: true })] },

      routes: {
        authorization: '/oauth/authorize',
        token: '/oauth/token',
        registration: '/oauth/register',
        revocation: '/oauth/revoke',
        jwks: '/oauth/jwks',
        end_session: '/oauth/logout',
        pushed_authorization_request: '/oauth/par',
        introspection: '/oauth/introspect',
        userinfo: '/oauth/userinfo',
      },

      // Our own login and consent pages (see interaction.controller.ts).
      interactions: {
        url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}`,
      },

      findAccount: async (_ctx, sub) => {
        const user = await this.users.findById(sub);
        if (!user) return undefined;
        return {
          accountId: user.id,
          claims: () => ({ sub: user.id, email: user.email }),
        };
      },

      scopes: ['openid', 'offline_access'],
      claims: { openid: ['sub'], email: ['email'] },

      // MCP clients are apps on the user's machine or in a browser: they
      // can't keep a secret, so they use PKCE instead of a client secret.
      clientDefaults: {
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        id_token_signed_response_alg: 'ES256',
      },
      pkce: { required: () => true },
      // OAuth 2.1: authorization code flow only (no implicit flow).
      responseTypes: ['code'],

      // Refresh tokens for any client allowed to use them. (The MCP spec
      // says not to make clients ask for `offline_access`.)
      issueRefreshToken: async (_ctx, client) =>
        client.grantTypeAllowed('refresh_token'),
      rotateRefreshToken: true,

      ttl: {
        AccessToken: 60 * 60, // 1 hour
        AuthorizationCode: 60,
        Interaction: 60 * 60,
        Grant: 30 * 24 * 60 * 60,
        Session: 14 * 24 * 60 * 60,
        RefreshToken: 30 * 24 * 60 * 60,
        IdToken: 60 * 60,
      },

      features: {
        devInteractions: { enabled: false },
        revocation: { enabled: true },

        // RFC 8707: the client says which API the token is for (`resource`),
        // and the token is only valid there. We serve exactly one: /mcp.
        resourceIndicators: {
          enabled: true,
          // Clients that forget `resource` still get a token for /mcp.
          defaultResource: () => this.resource,
          // Refreshing without `resource` reuses the one originally granted.
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx, resourceIndicator) => {
            if (resourceIndicator !== this.resource) {
              throw new errors.InvalidTarget(
                `Unknown resource: ${resourceIndicator}`,
              );
            }
            return {
              scope: ALL_SCOPES.join(' '),
              audience: this.resource,
              accessTokenFormat: 'jwt',
              accessTokenTTL: 60 * 60,
              jwt: { sign: { alg: 'ES256' } },
            };
          },
        },

        // How a new MCP client gets a client_id. The MCP spec prefers
        // Client ID Metadata Documents (the client_id is an HTTPS URL that
        // describes the client); Dynamic Client Registration is the
        // fallback older clients use.
        clientIdMetadataDocument: {
          enabled: config.get('ALLOW_CLIENT_METADATA_DOCUMENTS', {
            infer: true,
          }),
          ack: 'draft-03',
        },
        registration: {
          enabled: config.get('ALLOW_DYNAMIC_REGISTRATION', { infer: true }),
        },
      },

      renderError: (ctx, out) => {
        ctx.type = 'html';
        ctx.body = renderErrorPage(
          String(out.error ?? 'error'),
          String(out.error_description ?? 'Something went wrong.'),
        );
      },
    };

    this.provider = new Provider(this.issuer, configuration);
    // Behind a reverse proxy, trust X-Forwarded-Proto so URLs use https.
    this.provider.proxy = true;
  }

  onModuleInit() {
    this.provider.on('server_error', (_ctx, error) =>
      this.logger.error(`OAuth server error: ${error.message}`),
    );
    this.cleanup = setInterval(() => {
      deleteExpiredEntries(this.db).catch((error: Error) =>
        this.logger.warn(`Cleanup failed: ${error.message}`),
      );
    }, 60 * 60_000).unref();
  }

  onApplicationShutdown() {
    clearInterval(this.cleanup);
  }

  /**
   * Express middleware that hands OAuth routes to oidc-provider. Mounted in
   * main.ts before Nest's body parsers, because the library reads the raw
   * request body itself.
   */
  middleware() {
    const handle = this.provider.callback();
    return (req: Request, res: Response, next: NextFunction) => {
      if (OAUTH_PATHS.test(req.path)) {
        void handle(req, res);
        return;
      }
      next();
    };
  }
}
