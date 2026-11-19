import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { connectMcpClient } from '@nestjs/mcp/testing';
import { decodeJwt, importJWK, SignJWT } from 'jose';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { ALL_SCOPES } from '../src/mcp/scopes.js';
import { setupApp } from '../src/setup-app.js';
import { OAuthTestClient } from './oauth-client.js';

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, any>;
  content: { type: string; text?: string }[];
};

/**
 * The whole server over real HTTP against a real Postgres
 * (`docker compose up -d postgres`): OAuth discovery, registration, login,
 * consent, tokens, then MCP calls with those tokens.
 */
describe('Notes & Tasks MCP server (e2e)', () => {
  let app: INestApplication;
  let issuer: string;
  let resource: string;
  let oauth: OAuthTestClient;
  const emails: string[] = [];

  /**
   * A brand-new user, in a fresh "browser" (no cookies), who connects a
   * new client and grants `allow`.
   */
  async function connectUser(allow: string[] = ALL_SCOPES) {
    const client = new OAuthTestClient(oauth.base, issuer);
    const email = `${randomUUID()}@test.dev`;
    emails.push(email);
    const { clientId, redirectUri } = await client.register();
    const result = await client.authorize({
      clientId,
      redirectUri,
      scopes: ALL_SCOPES,
      resource,
      email,
      password: 'correct-horse-battery',
      signUp: true,
      allow,
    });
    if ('loginFailed' in result) throw new Error('login failed');
    const code = result.callback.searchParams.get('code')!;
    const tokens = await client.exchangeCode({
      clientId,
      redirectUri,
      code,
      verifier: result.verifier,
      resource,
    });
    return {
      email,
      clientId,
      redirectUri,
      client,
      ...result,
      tokens: tokens.body,
    };
  }

  async function mcp(token: string) {
    return connectMcpClient(app, { token });
  }

  async function call(
    token: string,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const client = await mcp(token);
    try {
      return (await client.callTool({ name, arguments: args })) as ToolResult;
    } finally {
      await client.close();
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    issuer = app.get(ConfigService).getOrThrow<string>('APP_URL');
    resource = `${issuer}/mcp`;
    oauth = new OAuthTestClient(`http://127.0.0.1:${port}`, issuer);
  });

  afterAll(async () => {
    // Leave the database as we found it (notes, tasks and grants cascade).
    if (emails.length) {
      await app
        .get(DataSource)
        .query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
    }
    await app?.close();
  });

  describe('discovery', () => {
    it('publishes Protected Resource Metadata and Authorization Server Metadata', async () => {
      const { prm, as } = await oauth.discover();
      expect(prm).toMatchObject({
        resource,
        authorization_servers: [issuer],
        scopes_supported: ALL_SCOPES,
      });
      expect(as).toMatchObject({
        issuer,
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        response_types_supported: ['code'],
      });
    });

    it('answers MCP requests without a token with 401', async () => {
      await expect(mcp('')).rejects.toThrow();
      await expect(mcp('not-a-jwt')).rejects.toThrow();
    });
  });

  describe('OAuth flow', () => {
    it('registers, signs up, consents and gets a JWT for the MCP resource', async () => {
      const { callback, state, tokens } = await connectUser();
      // RFC 9207: the response says which server issued it.
      expect(callback.searchParams.get('iss')).toBe(issuer);
      expect(callback.searchParams.get('state')).toBe(state);
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.refresh_token).toBeTruthy();

      const claims = decodeJwt(tokens.access_token);
      expect(claims).toMatchObject({ iss: issuer, aud: resource });
      expect(String(claims.scope).split(' ').sort()).toEqual(
        [...ALL_SCOPES].sort(),
      );
    });

    it('refuses a reused authorization code', async () => {
      const user = await connectUser();
      const again = await user.client.exchangeCode({
        clientId: user.clientId,
        redirectUri: user.redirectUri,
        code: user.callback.searchParams.get('code')!,
        verifier: user.verifier,
        resource,
      });
      expect(again.status).toBe(400);
      expect(again.body.error).toBe('invalid_grant');
    });

    it('refuses a code with the wrong PKCE verifier', async () => {
      const client = new OAuthTestClient(oauth.base, issuer);
      const { clientId, redirectUri } = await client.register();
      const email = `${randomUUID()}@test.dev`;
      emails.push(email);
      const result = await client.authorize({
        clientId,
        redirectUri,
        scopes: ALL_SCOPES,
        resource,
        email,
        password: 'correct-horse-battery',
        signUp: true,
      });
      if ('loginFailed' in result) throw new Error('login failed');
      const res = await client.exchangeCode({
        clientId,
        redirectUri,
        resource,
        code: result.callback.searchParams.get('code')!,
        verifier: 'x'.repeat(43),
      });
      expect(res.body.error).toBe('invalid_grant');
    });

    it('rotates refresh tokens and rejects a used one', async () => {
      const { tokens, clientId, client } = await connectUser();
      const first = await client.token({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(first.status).toBe(200);
      expect(first.body.refresh_token).not.toBe(tokens.refresh_token);
      expect(decodeJwt(first.body.access_token).aud).toBe(resource);

      const reused = await client.token({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      });
      expect(reused.body.error).toBe('invalid_grant');
    });

    it('sends the user back with access_denied when they deny', async () => {
      const client = new OAuthTestClient(oauth.base, issuer);
      const { clientId, redirectUri } = await client.register();
      const email = `${randomUUID()}@test.dev`;
      emails.push(email);
      const result = await client.authorize({
        clientId,
        redirectUri,
        scopes: ALL_SCOPES,
        resource,
        email,
        password: 'correct-horse-battery',
        signUp: true,
        deny: true,
      });
      if ('loginFailed' in result) throw new Error('login failed');
      expect(result.callback.searchParams.get('error')).toBe('access_denied');
    });

    it('rejects a wrong password', async () => {
      const user = await connectUser();
      const client = new OAuthTestClient(oauth.base, issuer);
      const result = await client.authorize({
        clientId: user.clientId,
        redirectUri: user.redirectUri,
        scopes: ALL_SCOPES,
        resource,
        email: user.email,
        password: 'wrong-password',
      });
      expect(result).toEqual({ loginFailed: true });
    });
  });

  describe('token checks on /mcp', () => {
    async function forge(claims: Record<string, unknown>, expiresIn = '5m') {
      const jwk = app
        .get(ConfigService)
        .getOrThrow<Record<string, unknown>>('OAUTH_SIGNING_KEY');
      const key = await importJWK(jwk, 'ES256');
      return new SignJWT({
        client_id: 'x',
        scope: ALL_SCOPES.join(' '),
        ...claims,
      })
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'at+jwt',
          kid: String(jwk.kid),
        })
        .setIssuer(issuer)
        .setSubject(randomUUID())
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(key);
    }

    it('accepts a correctly signed token for this resource', async () => {
      const client = await mcp(await forge({ aud: resource }));
      await client.close();
    });

    it('rejects a token issued for another API (audience)', async () => {
      await expect(
        mcp(await forge({ aud: 'https://other.example/api' })),
      ).rejects.toThrow();
    });

    it('rejects an expired token', async () => {
      await expect(
        mcp(await forge({ aud: resource }, '-1m')),
      ).rejects.toThrow();
    });
  });

  describe('MCP tools, resources and prompts', () => {
    it('lists the tools with annotations and output schemas', async () => {
      const { tokens } = await connectUser();
      const client = await mcp(tokens.access_token);
      const { tools } = await client.listTools();
      await client.close();

      expect(tools.map((t) => t.name).sort()).toEqual([
        'complete_task',
        'create_note',
        'create_task',
        'delete_note',
        'delete_task',
        'get_note',
        'list_tasks',
        'search_notes',
        'update_note',
        'update_task',
      ]);
      const search = tools.find((t) => t.name === 'search_notes')!;
      expect(search.annotations?.readOnlyHint).toBe(true);
      expect(search.outputSchema).toBeDefined();
      expect(
        tools.find((t) => t.name === 'delete_note')!.annotations
          ?.destructiveHint,
      ).toBe(true);
    });

    it('creates, finds, links and completes notes and tasks', async () => {
      const { tokens } = await connectUser();
      const token = tokens.access_token;

      const note = await call(token, 'create_note', {
        title: 'Bank loan',
        body: 'The bank needs **3 months of salary slips**.',
        tags: ['#Finance', 'finance', 'home'],
      });
      expect(note.isError).toBeFalsy();
      const noteId = note.structuredContent!.id;
      expect(note.structuredContent!.tags).toEqual(['finance', 'home']);

      const found = await call(token, 'search_notes', {
        query: 'salary slips',
      });
      expect(
        found.structuredContent!.notes.map((n: { id: string }) => n.id),
      ).toEqual([noteId]);
      const byTag = await call(token, 'search_notes', { tag: 'finance' });
      expect(byTag.structuredContent!.total).toBe(1);

      await call(token, 'update_note', {
        id: noteId,
        append_text: 'Deadline: Friday.',
      });
      const full = await call(token, 'get_note', { id: noteId });
      expect(full.structuredContent!.body).toContain('Deadline: Friday.');

      const task = await call(token, 'create_task', {
        title: 'Send salary slips',
        due_date: '2026-01-02',
        priority: 'high',
        note_id: noteId,
      });
      const taskId = task.structuredContent!.id;
      const overdue = await call(token, 'list_tasks', {
        due: 'overdue',
        today: '2026-01-05',
      });
      expect(
        overdue.structuredContent!.tasks.map((t: { id: string }) => t.id),
      ).toEqual([taskId]);

      const done = await call(token, 'complete_task', { id: taskId });
      expect(done.structuredContent!).toMatchObject({ status: 'done' });
      const again = await call(token, 'complete_task', { id: taskId });
      expect(again.isError).toBeFalsy();
      const open = await call(token, 'list_tasks', {});
      expect(open.structuredContent!.total).toBe(0);

      // Resources
      const client = await mcp(token);
      const resource = await client.readResource({ uri: `note://${noteId}` });
      expect((resource.contents[0] as { text: string }).text).toContain(
        '# Bank loan',
      );
      const templates = await client.listResourceTemplates();
      expect(templates.resourceTemplates.map((t) => t.uriTemplate)).toContain(
        'note://{id}',
      );

      // Prompts
      const { prompts } = await client.listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual([
        'daily_briefing',
        'summarize_notes',
        'weekly_review',
      ]);
      const review = await client.getPrompt({ name: 'weekly_review' });
      expect(JSON.stringify(review.messages)).toContain('Send salary slips');
      await client.close();
    });

    it('validates tool input', async () => {
      const { tokens } = await connectUser();
      const bad = await call(tokens.access_token, 'create_task', {
        title: '',
        due_date: 'tomorrow',
      });
      expect(bad.isError).toBe(true);
    });

    it("keeps each user's data private", async () => {
      const alice = await connectUser();
      const bob = await connectUser();
      const note = await call(alice.tokens.access_token, 'create_note', {
        title: 'Alice only',
      });
      const id = note.structuredContent!.id;

      const peek = await call(bob.tokens.access_token, 'get_note', { id });
      expect(peek.isError).toBe(true);
      expect(peek.content[0].text).toContain('not found');
      const del = await call(bob.tokens.access_token, 'delete_note', { id });
      expect(del.isError).toBe(true);
      const search = await call(bob.tokens.access_token, 'search_notes', {
        query: 'Alice',
      });
      expect(search.structuredContent!.total).toBe(0);
    });
  });

  describe('scopes (fail closed)', () => {
    it('grants only what the user ticked on the consent screen', async () => {
      const { tokens } = await connectUser(['notes:read']);
      expect(decodeJwt(tokens.access_token).scope).toBe('notes:read');

      const read = await call(tokens.access_token, 'search_notes', {});
      expect(read.isError).toBeFalsy();
      // Missing scope: refused before the tool runs (HTTP 403 insufficient_scope).
      await expect(
        call(tokens.access_token, 'create_note', { title: 'x' }),
      ).rejects.toThrow(/insufficient.scope/i);
      await expect(call(tokens.access_token, 'list_tasks', {})).rejects.toThrow(
        /insufficient.scope/i,
      );
    });

    it('answers a missing scope with HTTP 403 and a step-up challenge', async () => {
      const { tokens } = await connectUser(['notes:read']);
      const res = await fetch(`${oauth.base}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'create_note', arguments: { title: 'x' } },
        }),
      });
      expect(res.status).toBe(403);
      const challenge = res.headers.get('www-authenticate') ?? '';
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="notes:write"');
      expect(challenge).toContain(
        `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
      );
    });

    it('treats write as including read', async () => {
      const { tokens } = await connectUser(['tasks:write']);
      const list = await call(tokens.access_token, 'list_tasks', {});
      expect(list.isError).toBeFalsy();
    });
  });
});
