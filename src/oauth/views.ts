/**
 * The login and consent pages. Plain server-rendered HTML: no JavaScript is
 * needed to sign in. Every value from outside is escaped.
 */

export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
:root{color-scheme:light;--bg:#f6f6f4;--surface:#fcfcfb;--border:#e3e2de;--text:#0b0b0b;--text-2:#52514e;--muted:#76756f;--accent:#2a78d6;--danger:#c23b3a}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121211;--surface:#1a1a19;--border:#2e2e2c;--text:#f0efec;--text-2:#c3c2b7;--muted:#9a998f;--accent:#3987e5;--danger:#e66767}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:48px auto;padding:0 16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}
h1{font-size:1.3rem;margin:0 0 4px}p{margin:0 0 16px;color:var(--text-2)}
label{display:flex;flex-direction:column;gap:4px;font-size:.875rem;color:var(--text-2);margin-bottom:12px}
input[type=email],input[type=password]{font:inherit;padding:9px 11px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
button{font:inherit;width:100%;padding:10px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;margin-top:4px}
button.secondary{background:transparent;color:var(--text);border-color:var(--border)}
.scopes{list-style:none;padding:0;margin:0 0 16px;border:1px solid var(--border);border-radius:8px}
.scopes li{border-bottom:1px solid var(--border)}.scopes li:last-child{border-bottom:none}
.scopes label{flex-direction:row;align-items:flex-start;gap:10px;margin:0;padding:10px 12px;color:var(--text);font-size:.95rem}
.scopes code{display:block;font-size:.75rem;color:var(--muted)}
.client{font-weight:600}.error{color:var(--danger);font-size:.875rem;margin:0 0 12px}
.muted{color:var(--muted);font-size:.8rem}.row{display:flex;gap:8px}.row form{flex:1}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function renderLoginPage(opts: {
  uid: string;
  clientName: string;
  mode: 'sign-in' | 'sign-up';
  email?: string;
  error?: string;
}): string {
  const signUp = opts.mode === 'sign-up';
  const action = `/oauth/interaction/${encodeURIComponent(opts.uid)}/${signUp ? 'sign-up' : 'login'}`;
  return page(
    signUp ? 'Create account' : 'Sign in',
    `<div class="card">
      <h1>${signUp ? 'Create an account' : 'Sign in'}</h1>
      <p>to continue to <span class="client">${escapeHtml(opts.clientName)}</span></p>
      ${opts.error ? `<p class="error" role="alert">${escapeHtml(opts.error)}</p>` : ''}
      <form method="post" action="${action}">
        <label>Email<input type="email" name="email" required autocomplete="email" value="${escapeHtml(opts.email)}" autofocus></label>
        <label>Password<input type="password" name="password" required minlength="${signUp ? 10 : 1}" autocomplete="${signUp ? 'new-password' : 'current-password'}"></label>
        <button type="submit">${signUp ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="muted" style="margin:16px 0 0">${
        signUp
          ? `Have an account? <a href="/oauth/interaction/${encodeURIComponent(opts.uid)}">Sign in</a>`
          : `New here? <a href="/oauth/interaction/${encodeURIComponent(opts.uid)}?mode=sign-up">Create an account</a>`
      }</p>
    </div>`,
  );
}

export function renderConsentPage(opts: {
  uid: string;
  clientName: string;
  email: string;
  scopes: { scope: string; label: string }[];
}): string {
  const uid = encodeURIComponent(opts.uid);
  return page(
    'Allow access',
    `<div class="card">
      <h1>Allow access?</h1>
      <p><span class="client">${escapeHtml(opts.clientName)}</span> wants to use your notes and tasks. Signed in as ${escapeHtml(opts.email)}.</p>
      <form method="post" action="/oauth/interaction/${uid}/confirm">
        <p class="muted" style="margin-bottom:8px">Untick anything you don't want to allow.</p>
        <ul class="scopes">
          ${opts.scopes
            .map(
              (
                s,
              ) => `<li><label><input type="checkbox" name="scope" value="${escapeHtml(s.scope)}" checked>
                <span>${escapeHtml(s.label)}<code>${escapeHtml(s.scope)}</code></span></label></li>`,
            )
            .join('')}
        </ul>
        <button type="submit">Allow</button>
      </form>
      <form method="post" action="/oauth/interaction/${uid}/abort">
        <button type="submit" class="secondary">Deny</button>
      </form>
    </div>`,
  );
}

export function renderErrorPage(error: string, description: string): string {
  return page(
    'Error',
    `<div class="card"><h1>Something went wrong</h1><p>${escapeHtml(description)}</p><p class="muted">${escapeHtml(error)}</p></div>`,
  );
}
