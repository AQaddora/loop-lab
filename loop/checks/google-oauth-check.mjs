// Validates a Google OAuth client WITHOUT a browser: exchanges a deliberately bogus code.
// Google answers "invalid_grant" when the client id+secret are valid, "invalid_client" when they are not.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(process.argv[2], 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]));
const id = env.AUTH_GOOGLE_ID || env.GOOGLE_CLIENT_ID, secret = env.AUTH_GOOGLE_SECRET || env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) { console.log('missing AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET'); process.exit(1); }
const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  body: new URLSearchParams({ client_id: id, client_secret: secret, code: 'loop-lab-probe', grant_type: 'authorization_code', redirect_uri: 'http://localhost:3000/api/auth/callback/google' }) });
const err = (await r.json().catch(() => ({}))).error;
const ok = err === 'invalid_grant';
console.log(`client_id_format=${/\.apps\.googleusercontent\.com$/.test(id)} google_says=${err} creds_valid=${ok}`);
// Redirect URIs: Google sends a registered URI to the sign-in page and an unregistered one to /signin/oauth/error (redirect_uri_mismatch).
const uris = (process.env.REDIRECT_URIS || 'http://localhost:3000/api/auth/callback/google').split(',').map(u => u.trim()).filter(Boolean);
let allReg = true;
for (const u of uris) {
  const a = await fetch('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: u, response_type: 'code', scope: 'openid email profile' }), { redirect: 'manual' });
  const reg = a.status === 302 && !(a.headers.get('location') || '').includes('/signin/oauth/error');
  allReg &&= reg;
  console.log(`redirect_uri=${u} registered=${reg}`);
}
process.exit(ok && allReg ? 0 : 1);
