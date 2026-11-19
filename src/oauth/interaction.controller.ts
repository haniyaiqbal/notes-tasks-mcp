import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle, minutes } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SCOPES, type Scope } from '../mcp/scopes.js';
import { UsersService } from '../users/users.service.js';
import { OAuthService } from './oauth.service.js';
import {
  renderConsentPage,
  renderErrorPage,
  renderLoginPage,
} from './views.js';

const credentials = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});

/**
 * The login and consent screens the OAuth server sends people to.
 *
 * An "interaction" is one paused authorization request. oidc-provider ties
 * it to a cookie set on this browser, so a form posted from another site
 * (CSRF) can't complete someone else's login.
 */
@ApiExcludeController()
@Controller('oauth/interaction')
export class InteractionController {
  private readonly logger = new Logger(InteractionController.name);

  constructor(
    private readonly oauth: OAuthService,
    private readonly users: UsersService,
  ) {}

  @Get(':uid')
  async show(
    @Req() req: Request,
    @Res() res: Response,
    @Query('mode') mode?: string,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    const { uid, prompt, params, session } = details;
    const clientName = await this.clientName(String(params.client_id));

    if (prompt.name === 'login') {
      return this.html(
        res,
        renderLoginPage({
          uid,
          clientName,
          mode: mode === 'sign-up' ? 'sign-up' : 'sign-in',
        }),
      );
    }

    // Consent: list only the scopes this client still needs.
    const user = session?.accountId
      ? await this.users.findById(session.accountId)
      : null;
    const missing = this.missingScopes(prompt.details);
    return this.html(
      res,
      renderConsentPage({
        uid,
        clientName,
        email: user?.email ?? '',
        scopes: missing.map((scope) => ({ scope, label: SCOPES[scope] })),
      }),
    );
  }

  @Throttle({ default: { limit: 10, ttl: minutes(5) } })
  @Post(':uid/login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    const parsed = credentials.safeParse(body);
    const user = parsed.success
      ? await this.users.verifyCredentials(
          parsed.data.email,
          parsed.data.password,
        )
      : null;

    if (!user) {
      return this.html(
        res,
        renderLoginPage({
          uid,
          clientName: await this.clientName(String(details.params.client_id)),
          mode: 'sign-in',
          email: parsed.success ? parsed.data.email : '',
          error: 'Wrong email or password.',
        }),
        401,
      );
    }
    await this.oauth.provider.interactionFinished(
      req,
      res,
      { login: { accountId: user.id } },
      { mergeWithLastSubmission: false },
    );
  }

  @Throttle({ default: { limit: 5, ttl: minutes(15) } })
  @Post(':uid/sign-up')
  async signUp(
    @Req() req: Request,
    @Res() res: Response,
    @Param('uid') uid: string,
    @Body() body: unknown,
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    const parsed = credentials
      .extend({ password: z.string().min(10).max(128) })
      .safeParse(body);
    const clientName = await this.clientName(String(details.params.client_id));

    if (!parsed.success) {
      return this.html(
        res,
        renderLoginPage({
          uid,
          clientName,
          mode: 'sign-up',
          error:
            'Enter a valid email and a password of at least 10 characters.',
        }),
        400,
      );
    }
    try {
      const user = await this.users.register(
        parsed.data.email,
        parsed.data.password,
      );
      await this.oauth.provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id } },
        { mergeWithLastSubmission: false },
      );
    } catch {
      return this.html(
        res,
        renderLoginPage({
          uid,
          clientName,
          mode: 'sign-up',
          email: parsed.data.email,
          error: 'An account with this email already exists. Sign in instead.',
        }),
        409,
      );
    }
  }

  @Post(':uid/confirm')
  async confirm(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { scope?: string | string[] },
  ) {
    const details = await this.details(req, res);
    if (!details) return;
    const { prompt, params, session, grantId } = details;
    if (prompt.name !== 'consent' || !session?.accountId) {
      return this.html(
        res,
        renderErrorPage('invalid_request', 'Nothing to confirm.'),
        400,
      );
    }

    // The user can untick scopes: grant only what they left ticked, and
    // only scopes that were actually requested.
    const requested = new Set(this.missingScopes(prompt.details));
    const ticked = [body.scope ?? []]
      .flat()
      .filter((s) => requested.has(s as Scope));
    if (ticked.length === 0)
      return this.deny(req, res, 'No permissions were allowed');

    const { provider } = this.oauth;
    const grant = grantId
      ? await provider.Grant.find(grantId)
      : new provider.Grant({
          accountId: session.accountId,
          clientId: String(params.client_id),
        });
    if (!grant) return this.deny(req, res, 'The grant no longer exists');

    const missingOIDCScope = prompt.details.missingOIDCScope as
      string[] | undefined;
    if (missingOIDCScope?.length)
      grant.addOIDCScope(missingOIDCScope.join(' '));
    const missingOIDCClaims = prompt.details.missingOIDCClaims as
      string[] | undefined;
    if (missingOIDCClaims?.length) grant.addOIDCClaims(missingOIDCClaims);
    grant.addResourceScope(this.oauth.resource, ticked.join(' '));
    // Record the unticked scopes as declined, so the client gets a token
    // with fewer permissions instead of being asked again.
    const declined = [...requested].filter((s) => !ticked.includes(s));
    if (declined.length) {
      grant.rejectResourceScope(this.oauth.resource, declined.join(' '));
    }

    const savedGrantId = await grant.save();
    this.logger.log(
      `User ${session.accountId} allowed ${String(params.client_id)}: ${ticked.join(' ')}`,
    );
    await provider.interactionFinished(
      req,
      res,
      { consent: { grantId: savedGrantId } },
      { mergeWithLastSubmission: true },
    );
  }

  @Post(':uid/abort')
  async abort(@Req() req: Request, @Res() res: Response) {
    if (!(await this.details(req, res))) return;
    return this.deny(req, res, 'The user denied access');
  }

  /** The paused request, or an error page if it expired or isn't ours. */
  private async details(req: Request, res: Response) {
    try {
      return await this.oauth.provider.interactionDetails(req, res);
    } catch {
      this.html(
        res,
        renderErrorPage(
          'session_expired',
          'This sign-in link has expired. Go back to your app and connect again.',
        ),
        400,
      );
      return null;
    }
  }

  private deny(req: Request, res: Response, description: string) {
    return this.oauth.provider.interactionFinished(
      req,
      res,
      { error: 'access_denied', error_description: description },
      { mergeWithLastSubmission: false },
    );
  }

  /** Scopes of our MCP resource the client asked for but doesn't have yet. */
  private missingScopes(details: Record<string, unknown>): Scope[] {
    const byResource = (details.missingResourceScopes ?? {}) as Record<
      string,
      string[]
    >;
    const missing = byResource[this.oauth.resource] ?? [];
    return (Object.keys(SCOPES) as Scope[]).filter((scope) =>
      missing.includes(scope),
    );
  }

  private async clientName(clientId: string): Promise<string> {
    const client = await this.oauth.provider.Client.find(clientId);
    return (client?.clientName as string | undefined) ?? clientId;
  }

  private html(res: Response, html: string, status = 200) {
    res
      .status(status)
      .type('html')
      .setHeader('Cache-Control', 'no-store')
      .send(html);
  }
}
