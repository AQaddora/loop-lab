# The attendance system

`apps/attendance` is an on-site check-in system. The loop built it from `specs/attendance.md`, and every rule below has
an acceptance criterion (AC-nn) and a test. Production origin, once the production loop's first deploy (T16) lands:
https://attendance.apps.taqat.academy.

## What it does

An employee is on site, joins the office Wi-Fi and scans the QR code at the entrance. They sign in with Google and
confirm with the phone's fingerprint or Face ID. The server then writes one check-in or check-out row to a
tamper-evident log (spec §0).

| Role | Uses | Does |
|---|---|---|
| Owner, admin | `/admin` | allowlists members, sets which networks count as "the office", pairs kiosks, approves new passkeys, corrects the log, exports CSV, verifies the chain |
| Employee | a phone browser | scans, signs in, enrols one passkey, checks in and out, sees their own history at `/me` |
| Kiosk | a paired screen at the entrance | shows a QR code that changes every 30 seconds |

```
scan QR on office Wi-Fi -> /s/<site>?t=<token>
  -> IP in the site's networks?  -> QR token valid?  -> scan ticket cookie, 303 to /punch
  -> Google sign-in (12 h session) -> "Check in" or "Check out"
  -> passkey prompt (user verification) -> the server runs 10 checks -> one chained row
```

## How it resists manipulation

Five layers. Each one closes a way to cheat that the others leave open (spec §2, threat table §3).

**1. A rotating QR code.** The kiosk shows a token that the server mints with HMAC-SHA256 for the current 30-second
window, and the server accepts the previous window too. A photo forwarded to a friend dies within 60 seconds. The kiosk
never holds a key. The QR is only an entry ticket: it cannot check anyone in by itself. A site can use a printed static
QR instead, but then only the network gate protects it (TH-02). AC-04, AC-05, AC-14, AC-32.

**2. An office network allowlist.** Each site lists the public IPv4 and IPv6 ranges of its Wi-Fi. The client IP comes
only from the proxy in front of the app: one trusted header, or `X-Forwarded-For` read from the right. The leftmost,
client-written entry is never used. The IP is checked again at scan, enrolment, punch and every kiosk request.
Ranges that are too broad (`/0`, IPv4 shorter than /16) or not public are refused. AC-02, AC-03, AC-13, AC-25, AC-39.

**3. Google sign-in.** Only allowlisted members can sign in, with a verified email. The Google account id (`sub`) is
pinned at first login, so reassigning an email to someone else does not hand over the account. Role and status are
reloaded from the database on every request, so a suspension works at once. AC-10, AC-11, AC-43.

**4. A passkey, approved by an admin with a confirm code.** The employee enrols a passkey on site. The server requires
user verification (fingerprint, face or device PIN) on every punch. A new passkey stays `PENDING` until an admin
approves it, and to approve it the admin must type the 6-character confirm code shown on the employee's phone. No admin
screen or API shows that code. A member has at most one approved passkey, and approving a new one revokes the old one
in the same transaction. AC-17, AC-18, AC-19, AC-20, AC-26.

**5. A hash-chained, append-only log.** Each row carries an HMAC over the previous row's hash and its own fields. The
key lives in the deploy environment, never in the database. Database triggers abort deletes and edits (the one
exception: clearing the IP and user agent for retention). Corrections are
new rows with a reason, and the employee sees them at `/me`. `GET /api/admin/attendance/verify` returns the first bad
row. AC-06, AC-28, AC-29, AC-30.

The ten checks of a punch run in a fixed order, and the first failure wins (spec §2.5):

| # | Check | Example error code |
|---|---|---|
| 1 | `Origin` header and JSON body | `bad_origin` |
| 2 | session, member active, profile complete | `unauthenticated` |
| 3 | rate limit | `rate_limited` |
| 4 | single-use WebAuthn challenge, bound to member, ticket and kind | `challenge_used` |
| 5 | scan ticket: present, unexpired, unused, this member's | `ticket_used` |
| 6 | the current IP is in the site's networks | `ip_not_allowed` |
| 7 | the passkey signature, with user verification and the counter check | `uv_required` |
| 8 | the passkey belongs to this member and is approved | `credential_pending` |
| 9 | the transition makes sense (no IN after IN), 60 s since the last row | `already_in` |
| 10 | consume the ticket and append the chained row, in one transaction | `ticket_used` |

Steps 9 and 10 run as one synchronous database transaction, so two parallel punches cannot both pass (AC-41).
Time comes from the server clock only; any time the client sends is ignored (AC-27).

## The honest limits

The spec states what the system cannot do (§0). Its words: "Tamper-evident, not tamper-proof."

| Limit | What happens | Spec |
|---|---|---|
| A synced passkey | iCloud Keychain and Google Password Manager copy the passkey to all of the user's devices. The server sees the sync flags but cannot stop syncing | §0, OD-4 |
| A lent, unlocked phone | if B hands A an unlocked phone and its passcode, no web app can tell who is holding it | TH-03, OD-7 |
| A narrow home IP | an admin can add a home address as an "office network". Only too-broad and non-public ranges are refused; only a review of the change catches it | TH-19 |
| A VPN into the office | a VPN that leaves through the office network passes the IP gate. The gate proves the network, not the body | TH-04 |
| The passcode instead of a fingerprint | the device PIN also satisfies user verification. The signed flag does not say which method was used | TH-09 |
| Cutting the newest rows | the chain head lives in the same database, so a tail cut needs an external anchor to be caught | TH-13, OD-6 |
| A ghost employee | in a one-admin org, the admin can invite and approve a fake member | TH-20, OD-10 |

## No passwords, by design

There is no username or password anywhere in the system. Identity is a Google account, and the device is a passkey.

- The first owner is the Google account in `BOOTSTRAP_OWNER_EMAIL`. In production that is `<owner's Google account>`,
  and it lives in the deploy environment only, never in the repo.
- While no organization exists, only that account can sign in. It opens `/admin/setup` once to create the
  organization, the owner member and the first site. After that, setup returns `forbidden` (AC-42).
- Admins open `/admin` and sign in with Google. Only the owner can make someone an admin (AC-43).

## Run it locally

You need Node 22 and npm. Everything below runs on your machine and needs **no secret**.

```bash
npm --prefix apps/attendance ci
(cd apps/attendance && npx playwright install chromium)
```

### The oracle

```bash
npm --prefix apps/attendance run check                    # lint + typecheck + unit tests
bash apps/attendance/scripts/check-ac-coverage.sh         # every AC has a test titled with its id; no skips
npm --prefix apps/attendance run e2e                      # Playwright on Chromium; starts its own server on :3100
bash apps/attendance/scripts/check-prod-no-test-mode.sh   # builds for production and proves the test bypasses are dead
```

- The E2E suite drives the whole journey from an empty database (AC-37, `e2e/journey.spec.ts`), with `test-login` in
  place of Google and a CDP virtual authenticator in place of the phone (spec §7.1).
- Port 3100 busy? Set `E2E_PORT=3110`. Port 3200 busy for the prod guard? Set `PRODCHECK_PORT`.
- Failure evidence lands in `apps/attendance/test-results/e2e.json`, with Playwright traces for failed tests.

### The E2E fixtures

`npm --prefix apps/attendance run dev:test` starts the test-mode server on http://localhost:3100, with the dummy
values in `apps/attendance/.env.e2e`. Test mode adds the surfaces in spec §7.2, and a production build removes them:

| Surface | Use |
|---|---|
| `POST /api/test/reset` | wipe the database and load the fixture: `{}` for the default, `{"fixture":"empty"}` for no org |
| the "Test login" form on `/signin` | sign in as a fixture member, for example `admin@acme.test` |
| header `x-test-client-ip` | choose the client IP. Browsers do not send it, so a plain browser fails the IP gate; the E2E helpers set it |
| `POST /api/test/clock` | move or freeze the server clock |
| `POST /api/test/qr` | mint a rotating QR token for any time |

The default fixture (spec §7.3) has the org `Acme`, a rotating site `site_hq`, a static site `site_wh`, four members
(owner, admin and two invited employees) and documentation-only IP ranges. Use it for every experiment, including
security ones ([SECURITY.md](../../SECURITY.md)).

### With real Google sign-in

1. Create your own Google OAuth client. Add the redirect `http://localhost:3000/api/auth/callback/google`.
2. Copy `apps/attendance/.env.example` to `apps/attendance/.env.local` (gitignored) and fill it in. Set
   `BOOTSTRAP_OWNER_EMAIL` to your own Google account.
3. `npm --prefix apps/attendance run dev`, open http://localhost:3000/admin and run the setup.

The IP gate trusts only the proxy in front of the app (spec §2.2). On a laptop with no proxy, check what the server
sees with `GET /api/client-ip` before you add a network.

## Where the code is

| Concern | File in `apps/attendance/src/` |
|---|---|
| QR tokens, scan tickets | `lib/qr.ts`, `lib/static-qr.ts`, `lib/tickets.ts` |
| Client IP and CIDR rules | `lib/ip.ts` |
| Sign-in policy | `auth.ts`, `lib/signin-policy.ts`, `lib/identity.ts` |
| Passkeys and approvals | `lib/webauthn.ts`, `lib/approvals.ts` |
| Punch checks and the commit | `lib/punch.ts`, `lib/punch-state.ts` |
| Hash chain, corrections, CSV | `lib/chain.ts`, `lib/corrections.ts`, `lib/csv.ts` |
| Origin check, rate limits, audit | `lib/origin.ts`, `lib/ratelimit.ts`, `lib/audit.ts` |
| Test switch and server clock | `lib/test-mode.ts`, `lib/clock.ts` |
| Security headers (CSP) | `proxy.ts` |
