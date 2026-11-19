import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupApp } from './setup-app.js';

/** HTTP mode: the MCP endpoint at /mcp, and the OAuth server at /oauth. */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
  const url = config.get('APP_URL', { infer: true });
  console.log(`MCP server:    ${url}/mcp`);
  console.log(`OAuth issuer:  ${url}`);
}
await bootstrap();
