import { escapeHtml, renderConsentPage, renderLoginPage } from './views.js';

describe('login and consent pages', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('never renders a client name as HTML', () => {
    const html = renderLoginPage({
      uid: 'u1',
      clientName: '<img src=x onerror=alert(1)>',
      mode: 'sign-in',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('lists each requested scope as a checkbox', () => {
    const html = renderConsentPage({
      uid: 'u1',
      clientName: 'Claude',
      email: 'me@example.com',
      scopes: [{ scope: 'notes:read', label: 'Read your notes' }],
    });
    expect(html).toContain('name="scope" value="notes:read" checked');
    expect(html).toContain('/oauth/interaction/u1/abort');
  });
});
