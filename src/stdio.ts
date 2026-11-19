/**
 * stdio mode: for an AI app that starts this server as a local process
 * (Claude Desktop, Claude Code, Cursor...). The app talks MCP over stdin and
 * stdout, so nothing else may be printed to stdout: logs go to stderr.
 *
 * There's no OAuth here. The MCP spec says stdio servers take credentials
 * from the environment: the process acts as the user in STDIO_USER_EMAIL
 * (it must already have an account, created through the OAuth sign-up page).
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpStdioLogger, McpStdioServer } from '@nestjs/mcp';
import { databaseModule } from './app.module.js';
import { envSchema, type Env } from './config/env.js';
import { setStdioUser } from './mcp/current-user.js';
import { PromptsMcp } from './mcp/prompts.mcp.js';
import { NotesModule } from './notes/notes.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';
import { UsersService } from './users/users.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    databaseModule,
    UsersModule,
    NotesModule,
    TasksModule,
    McpModule.forRoot({
      path: false, // no HTTP endpoint
      name: 'notes-tasks-mcp',
      version: '1.0.0',
      title: 'Notes & Tasks',
    }),
  ],
  providers: [PromptsMcp],
})
class StdioModule {}

const app = await NestFactory.createApplicationContext(StdioModule, {
  logger: new McpStdioLogger(),
});

const email = app
  .get<ConfigService<Env, true>>(ConfigService)
  .get('STDIO_USER_EMAIL', {
    infer: true,
  });
const user = email ? await app.get(UsersService).findByEmail(email) : null;
if (!user) {
  process.stderr.write(
    email
      ? `No account for ${email}. Sign up first by connecting over HTTP.\n`
      : 'Set STDIO_USER_EMAIL to the account this server should act as.\n',
  );
  await app.close();
  process.exit(1);
}
setStdioUser(user.id);

await app.get(McpStdioServer).listen();
await app.close();
