import { effectiveScopes } from './scopes.js';

describe('effectiveScopes', () => {
  it('adds read when write is granted', () => {
    expect(effectiveScopes(['notes:write'])).toEqual([
      'notes:read',
      'notes:write',
    ]);
  });

  it('keeps read-only tokens read-only', () => {
    expect(effectiveScopes(['tasks:read'])).toEqual(['tasks:read']);
  });

  it('drops scopes this server does not know', () => {
    expect(effectiveScopes(['openid', 'admin', 'notes:read', ''])).toEqual([
      'notes:read',
    ]);
  });
});
