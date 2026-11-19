import { createHash, randomBytes } from 'node:crypto';

/**
 * A tiny OAuth client that does what an MCP client (like Claude) does:
 * discover → register → authorize with PKCE → sign in → consent → token.
 * It runs against the real server over HTTP, so the tests cover the whole
 * flow, including the HTML forms and cookies.
 */
export class OAuthTestClient {
  private cookies = new Map<string, string>();

  /**
   * @param base where the test server really listens (random port)
   * @param issuer the configured APP_URL. The server builds redirects with
   *   it, so they're rewritten to `base`.
   */
  constructor(
    readonly base: string,
    readonly issuer: string,
  ) {}

  async discover() {
    const prm = await this.json(`/.well-known/oauth-protected-resource/mcp`);
    const as = await this.json(`/.well-known/oauth-authorization-server`);
    return { prm, as };
  }

  async register(redirectUri = 'http://127.0.0.1:33418/callback') {
    const res = await this.fetch('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test MCP Client',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
      }),
    });
    if (res.status !== 201)
      throw new Error(`register: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { client_id: string };
    return { clientId: body.client_id, redirectUri };
  }

  /**
   * Runs the browser part: authorize, the login (or sign-up) form, the
   * consent form (ticking only `allow`), and returns the callback URL.
   */
  async authorize(opts: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    resource: string;
    email: string;
    password: string;
    signUp?: boolean;
    allow?: string[];
    deny?: boolean;
  }) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(8).toString('hex');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      scope: opts.scopes.join(' '),
      resource: opts.resource,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });

    // 1. Authorization endpoint → redirect to our login page.
    let res = await this.fetch(`/oauth/authorize?${params}`);
    let page = await this.follow(res);
    if (!page.url.includes('/oauth/interaction/')) {
      throw new Error(`expected login page, got ${page.url}`);
    }

    // 2. Sign in (or sign up) on the login page.
    const uid = page.url.split('/oauth/interaction/')[1].split(/[/?]/)[0];
    res = await this.fetch(
      `/oauth/interaction/${uid}/${opts.signUp ? 'sign-up' : 'login'}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: opts.email,
          password: opts.password,
        }),
      },
    );
    if (res.status === 401) return { loginFailed: true as const };
    page = await this.follow(res);

    // 3. Consent page (skipped by the server if already granted).
    if (page.url.includes('/oauth/interaction/')) {
      const consentUid = page.url
        .split('/oauth/interaction/')[1]
        .split(/[/?]/)[0];
      const form = new URLSearchParams();
      for (const scope of opts.allow ?? opts.scopes)
        form.append('scope', scope);
      res = await this.fetch(
        `/oauth/interaction/${consentUid}/${opts.deny ? 'abort' : 'confirm'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
        },
      );
      page = await this.follow(res);
    }

    const callback = new URL(page.url);
    return { callback, verifier, state };
  }

  async exchangeCode(opts: {
    clientId: string;
    redirectUri: string;
    code: string;
    verifier: string;
    resource: string;
  }) {
    return this.token({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
      resource: opts.resource,
    });
  }

  async token(params: Record<string, string>) {
    const res = await this.fetch('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, string>,
    };
  }

  /** Follows redirects inside our server; stops at the first outside URL. */
  private async follow(res: Response): Promise<{ url: string; html?: string }> {
    for (let hops = 0; hops < 10; hops++) {
      const location = res.headers.get('location');
      if (!location || res.status < 300 || res.status >= 400) {
        return { url: res.url, html: await res.text() };
      }
      const next = new URL(location, this.issuer);
      // Our server may redirect using either its configured issuer or the
      // address the request came in on; anything else is the client's
      // redirect_uri, where the browser part ends.
      const internal = [new URL(this.issuer).origin, new URL(this.base).origin];
      if (!internal.includes(next.origin)) return { url: next.href };
      res = await this.fetch(next.pathname + next.search);
    }
    throw new Error('Too many redirects');
  }

  private async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set(
        'cookie',
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      );
    }
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...value] = pair.split('=');
      this.cookies.set(name.trim(), value.join('='));
    }
    // Remember where we are, in issuer terms, for relative redirects.
    Object.defineProperty(res, 'url', { value: `${this.issuer}${path}` });
    return res;
  }

  private async json(path: string) {
    const res = await this.fetch(path);
    return (await res.json()) as Record<string, unknown>;
  }
}
