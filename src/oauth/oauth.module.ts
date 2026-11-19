import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { InteractionController } from './interaction.controller.js';
import { OAuthService } from './oauth.service.js';

/** The OAuth authorization server (oidc-provider) and its login pages. */
@Module({
  imports: [UsersModule],
  controllers: [InteractionController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
