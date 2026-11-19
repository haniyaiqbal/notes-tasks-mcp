import { UnauthorizedException } from '@nestjs/common';
import type { McpContext } from '@nestjs/mcp';
import type { McpUserInfo } from './token-verifier.js';

/**
 * Who is calling this tool. Over HTTP, it's the user the OAuth token belongs
 * to. Over stdio (a local process the user started themselves), it's the
 * account named in STDIO_USER_EMAIL, resolved at startup.
 *
 * Fail-closed: if there's no user, the call stops here. Every query below
 * is filtered by this ID, so one user can never touch another's data.
 */
export function currentUserId(ctx: McpContext): string {
  if (ctx.transport === 'stdio') {
    if (stdioUserId) return stdioUserId;
  } else {
    const userId = (ctx.authInfo?.extra as McpUserInfo | undefined)?.userId;
    if (userId) return userId;
  }
  throw new UnauthorizedException('No authenticated user');
}

let stdioUserId: string | undefined;

/** Called once by the stdio entry point. */
export function setStdioUser(userId: string) {
  stdioUserId = userId;
}
