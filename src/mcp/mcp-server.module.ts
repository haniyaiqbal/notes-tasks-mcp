import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpModule } from '@nestjs/mcp';
import { SkipThrottle } from '@nestjs/throttler';
import type { Env } from '../config/env.js';
import { NotesModule } from '../notes/notes.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { PromptsMcp } from './prompts.mcp.js';
import { ALL_SCOPES } from './scopes.js';
import { JwtTokenVerifier, publicJwk } from './token-verifier.js';

const INSTRUCTIONS = `This server holds the user's personal notes and tasks.
- Search before creating, to avoid duplicates (search_notes, list_tasks).
- Notes are Markdown. Use update_note with append_text to add to a note without rewriting it.
- Prefer complete_task over delete_task for finished work.
- Always confirm with the user before delete_note or delete_task.
- For date filters, pass the user's local date as \`today\` (YYYY-MM-DD).`;

/**
 * The MCP server: Streamable HTTP at /mcp (protocol 2026-07-28, stateless,
 * also serving 2025-era clients), protected as an OAuth 2.1 resource server.
 * The same tools, resources and prompts are served over stdio by stdio.ts.
 */
@Module({
  imports: [
    NotesModule,
    TasksModule,
    McpModule.forRootAsync({
      path: 'mcp',
      decorators: [SkipThrottle()],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const issuer = config.get('APP_URL', { infer: true });
        const resource = `${issuer}/mcp`;
        const appHost = new URL(issuer).hostname;
        return {
          name: 'notes-tasks-mcp',
          version: '1.0.0',
          title: 'Notes & Tasks',
          description: 'Your personal notes and to-do list, for AI assistants.',
          instructions: INSTRUCTIONS,
          http: {
            // Serve 2025-era clients too (statelessly) while they upgrade.
            legacy: 'stateless',
            // DNS rebinding protection: only answer requests for our own host.
            allowedHosts: [
              ...new Set([appHost, 'localhost', '127.0.0.1', '[::1]']),
            ],
          },
          auth: {
            verifier: new JwtTokenVerifier(issuer, resource, [
              publicJwk(config.get('OAUTH_SIGNING_KEY', { infer: true })),
            ]),
            resource,
            authorizationServers: [issuer],
            scopesSupported: ALL_SCOPES,
            resourceName: 'Notes & Tasks',
          },
        };
      },
    }),
  ],
  providers: [PromptsMcp],
})
export class McpServerModule {}
