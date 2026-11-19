/**
 * The OAuth scopes this server understands. A token only gets the scopes
 * the user agreed to on the consent screen, and every tool, resource and
 * prompt declares the scopes it needs.
 */
export const SCOPES = {
  'notes:read': 'Read your notes',
  'notes:write': 'Create, edit and delete your notes',
  'tasks:read': 'Read your tasks',
  'tasks:write': 'Create, edit, complete and delete your tasks',
} as const;

export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

/** A broader scope includes a narrower one: write implies read. */
const IMPLIES: Partial<Record<Scope, Scope[]>> = {
  'notes:write': ['notes:read'],
  'tasks:write': ['tasks:read'],
};

/**
 * Scopes from a token, with the ones they imply added, and anything we
 * don't know about dropped. The MCP spec asks servers to account for scope
 * hierarchies like this one.
 */
export function effectiveScopes(granted: Iterable<string>): Scope[] {
  const result = new Set<Scope>();
  for (const scope of granted) {
    if (!(scope in SCOPES)) continue;
    result.add(scope as Scope);
    for (const implied of IMPLIES[scope as Scope] ?? []) result.add(implied);
  }
  return ALL_SCOPES.filter((scope) => result.has(scope));
}
