import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { OAuthService } from './oauth/oauth.service.js';

/**
 * Wiring shared by main.ts and the end-to-end tests. Must run before
 * `init()`/`listen()`, so the OAuth server sees requests before Nest's
 * body parsers do (oidc-provider reads the raw body itself).
 */
export function setupApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 'loopback');
  express.use(app.get(OAuthService).middleware());
  // The login forms post url-encoded data.
  express.useBodyParser('urlencoded', { extended: false });
  return app;
}
