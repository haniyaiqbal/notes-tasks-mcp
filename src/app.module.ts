import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envSchema, type Env } from './config/env.js';
import { dataSourceOptions } from './database/data-source.js';
import { HealthController } from './health/health.controller.js';
import { McpServerModule } from './mcp/mcp-server.module.js';
import { OAuthModule } from './oauth/oauth.module.js';

export const databaseModule = TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    ...dataSourceOptions,
    url: config.get('DATABASE_URL', { infer: true }),
    // Applies pending migrations on startup. Never `synchronize`.
    migrationsRun: true,
  }),
});

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    databaseModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [{ name: 'default', ttl: minutes(1), limit: 120 }],
        skipIf: () => config.get('NODE_ENV', { infer: true }) === 'test',
      }),
    }),
    TerminusModule,
    OAuthModule,
    McpServerModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
