# Spec · attendance — on-site check-in with QR + office Wi-Fi + passkey

Status: v1 spec, the source of truth for `loop/backlog-attendance.md`. App lives in `apps/attendance/`. Revised 2026-11-17 after an adversarial review (attacks from a dishonest employee, a dishonest admin and an unattended builder).
Role in the session: this is the **closed loop** demo. The spec defines the ACs, the ACs become tests, the tests are the oracle, and the loop keeps going until every test passes. No human judges "done". If the spec is ambiguous, the agent takes the more restrictive reading and adds an entry to `loop/decisions.md`. It never guesses silently.

## 0. Summary

An employee is on site, joins the office Wi-Fi and scans the QR at the entrance. Then they sign in with Google and confirm with their phone's fingerprint or Face ID, and the server writes one check-in or check-out row to a tamper-evident log. An admin allowlists who may enrol, which networks count as "the office", and which new passkeys are trusted.

### What this system can and cannot guarantee (state this on stage)

| Claim | Truth |
|---|---|
| "We verify the fingerprint" | **No.** The server never sees a fingerprint or face. It verifies a signature from a **passkey**, and the OS releases the private key only after local user verification (UV). |
| "UV means biometric" | **No.** The OS passcode or PIN can satisfy UV. The signed UV flag does not say which method was used. |
| "The passkey is bound to one phone" | **Not on iOS/Android.** iCloud Keychain and Google Password Manager passkeys **sync** to all of the user's devices. Strict device binding is impossible there. We can see the sync flags (BE/BS) but we cannot prevent syncing. |
| "Sign counter detects clones" | Only when counter > 0. Synced passkeys always report 0. |
| "AAGUID identifies the device model" | Only sometimes. It can be all-zero (for example iCloud Keychain, or attestation `none`). We treat it as information, never as a control. |
| "IP allowlist = physically present" | **No.** It shows the request left through the office network egress. A VPN or proxy that egresses there also passes. |
| "No buddy punching" | **No.** If B gives A an unlocked phone plus the passcode, software cannot tell. A human or camera control is needed (OD-7). |
| "Admin approval proves the employee was there" | **Partly.** It proves the approver saw the confirm code on the enrolling phone (§2.4). A colluding admin can still approve anyone (TH-20). |
| "The log cannot be changed" | **Tamper-evident, not tamper-proof.** The app cannot change rows, and a direct DB edit is caught by verify, except cutting the newest rows, which only an external anchor (OD-6) catches. |

Non-goals for v1: GPS geofencing (easy to spoof), face recognition, native apps, offline punches, payroll, multi-org SaaS (the schema has `org_id`, but each deployment runs one org).

## 1. Roles & flows

Roles: **owner** and **admin** (dashboard), **employee** (phone web app), **kiosk** (a paired display device, not a user).

### 1.1 Admin
1. **Bootstrap:** works **only while no org exists**. With an empty DB the sign-in policy admits only `BOOTSTRAP_OWNER_EMAIL` (§2.3 step 0). `/admin/setup` creates the org (name, optional Google Workspace domain, synced-passkey policy), the owner member (ACTIVE, `google_sub` pinned) and the first site in one transaction. Once an org exists, setup returns `forbidden` and the bootstrap email has no special power.
2. **Site:** set name, timezone, `qr_mode` (`rotating` or `static`), `rotation_seconds` (10–120) and `grace_windows` (0–2); out of range → `bad_request`. Add networks: the public IPv4 and IPv6 egress CIDRs of the office Wi-Fi (rules in §2.2). The page shows "your current IP" (from `GET /api/client-ip`) to help.
3. **Allowlist:** add members (email, optional employee code, role) one at a time or as a CSV paste (the UI turns the paste into a JSON array). Each member starts as `INVITED`. Admins manage employees only. Only the owner grants or removes `admin`/`owner`. Nobody changes their own role or status (`forbidden_self_action`). The last ACTIVE owner cannot be demoted, suspended or removed. `google_sub` is never editable, so editing an email cannot hand an account to someone else.
4. **QR:** for a `rotating` site, pair a kiosk (TV or tablet at the entrance) with a one-time code. For a `static` site, mint a QR with a TTL of at most `STATIC_QR_MAX_TTL_DAYS` (30, else `ttl_too_long`), print it, and revoke it when needed.
5. **Approvals:** work through the queue of `PENDING` passkeys, which shows UA, IP, site, time, AAGUID and the synced flag, but **never the confirm code**. To **Approve**, the admin types the 6-character confirm code shown on the employee's phone. Approving revokes the previous APPROVED passkey. **Reject** needs no code. Policy: approve only when the employee is in front of you.
6. **Attendance:** view the log and add corrections. Corrections are new rows with a mandatory reason. Export CSV and verify the chain.
7. **Incidents:** revoke a credential or suspend a member (lost phone, leaver). Revocation takes effect on the next request.

### 1.2 Kiosk display (rotating sites)
1. The admin creates a kiosk and gets a one-time pairing code: 8 chars of base32, valid 10 min, stored hashed, consumed atomically. Opening `/kiosk/pair?code=…` on the device posts it to `/api/kiosk/pair`, which sets a long-lived HttpOnly kiosk cookie. Pairing **must come from an IP inside the site's CIDRs** (`ip_not_allowed`).
2. `/kiosk` polls `GET /api/kiosk/token` every `rotation_seconds/2`. Every token request must also come from a site IP (`ip_not_allowed`). The response is `{token, url, window, expiresAt, serverNow}`. The page renders the QR (absolute URL `<AUTH_URL origin><BASE_PATH>/s/<siteId>?t=<token>`), the site name, a countdown and the server clock.
3. The kiosk keeps `offset = serverNow − Date.now()`. It **hides** the QR when `Date.now() + offset` passes the last `expiresAt` without a fresh token, and at once on any 401/403. It never shows a stale QR.

### 1.3 Employee, first time
1. Join the office Wi-Fi and scan the QR with the phone camera. It opens `/s/<siteId>?t=…` in Safari or Chrome. In-app webviews are not supported: Google blocks them and WebAuthn may be missing.
2. The server checks **IP first** (`ip_not_allowed` page: "connect to office Wi-Fi, detected IP x"), then the QR token. On success it creates a scan ticket, sets the `scan_ticket` cookie and answers **303 → `/punch`**, so the token never stays in the address bar.
3. With no session, the user goes to `/signin` and taps "Sign in with Google". The email must be allowlisted.
4. `/onboarding`: full name (1–100 chars), employee code (must match the allowlisted code if one is set) and phone (7–20 chars of `+0-9 -`). The member becomes `ACTIVE`. Later profile edits may change name and phone, never the code.
5. `/enroll`: "Register fingerprint / Face ID" shows the OS passkey prompt. The credential is stored as `PENDING`. Enrolment requires a live ticket and an allowed IP at options **and** verify, so passkeys are only enrolled **from the office network** (VPN caveat: TH-04).
6. The "Waiting for admin approval" screen shows the confirm code (`data-confirm-code`). The employee shows it to the admin, the admin approves (§1.1.5), and the next scan offers Check in.

### 1.4 Employee, daily
1. Scan the QR (rotating or static) to get a ticket. Sign in with Google only if the 12 h session has expired.
2. `/punch` shows the single valid action: **Check in** or **Check out**. Tapping it shows the OS biometric prompt, then `POST /api/punch`.
3. The server checks everything in §2.5. On success it appends one chained row and shows the server time and sequence number.
4. `/me` lists the user's own events, including any admin corrections and their reasons.

### 1.5 New phone or deleted passkey (same Google account)
1. Scan on the new phone and sign in with the **same Google account**. "Same" means the same Google `sub`, pinned at first login, not just the same email.
2. `/punch` offers a way out when the user has no usable passkey: "New phone / passkey deleted" leads to `/enroll`. The new credential is `PENDING` and the old APPROVED one is untouched. At most one PENDING passkey per member is kept: a newer one moves the older to `REJECTED` (note `superseded`) in the same transaction.
3. Until approval the employee **cannot punch** with the new passkey. The admin may add a manual correction with a reason for the gap.
4. The admin approves with the confirm code, and in **one transaction** the old credential becomes `REVOKED` and the new one `APPROVED`. From then on, any assertion from the old passkey fails with `credential_revoked`.
5. Honest note: with synced passkeys, a new iPhone or Android phone on the same Apple or Google account usually **already has** the passkey, so no re-enrolment happens.

## 2. Anti-manipulation design

### 2.1 QR tokens (admin picks the mode per site)

| | `rotating` (default, kiosk screen) | `static` (printed, the owner's original idea) |
|---|---|---|
| Lifetime | `rotation_seconds` (30) × (1 + `grace_windows` (1)), so at most 60 s by default (bounded to 10–120 s × 1–3) | Admin-set TTL, 1 h to 30 days |
| A photo forwarded to someone else | Dies within 60 s | Works until TTL or revoke, so **only the IP gate protects it** |
| Revocation | Bump `sites.qr_key_version`, which kills every token | `static_qr_codes.status = REVOKED`, or bump the key version |
| Needs | A paired kiosk with power, network and an office IP | Paper |

```
K_site   = HMAC-SHA256(QR_SIGNING_SECRET, "qr:" + siteId + ":" + qr_key_version)
rotating = "r." + siteId + "." + kv + "." + window + "." + b64url(HMAC(K_site, "r|siteId|kv|window"))
           window = floor(serverNowMs / 1000 / rotation_seconds)
static   = "s." + siteId + "." + kv + "." + staticQrId + "." + expUnix + "." + b64url(HMAC(K_site, "s|siteId|kv|id|exp"))

verify(pathSiteId, token), first failure wins:
  site unknown → qr_invalid · site DISABLED → qr_revoked
  parse error, prefix ≠ site.qr_mode ("r"/"s"), token siteId ≠ pathSiteId, kv ≠ site.qr_key_version, bad signature → qr_invalid
  rotating: window > w_now → qr_invalid · window < w_now − grace → qr_expired
  static:   DB row (same site, same exp) missing → qr_invalid · REVOKED → qr_revoked · now ≥ exp → qr_expired
compare signatures with crypto.timingSafeEqual on equal-length buffers
```
The kiosk never holds a key. The server mints every token. The QR is only an entry ticket and cannot punch by itself.

**Scan ticket:** a successful `/s/…` creates a `scan_tickets` row (128-bit random id, site, source, IP, UA, `expires_at = now + SCAN_TICKET_TTL_SECONDS` (300)). Its id goes in an HttpOnly cookie with `Max-Age` = TTL.
- **Bind:** the first authenticated use (`/api/webauthn/register/options` or `/api/punch/options`) runs `UPDATE scan_tickets SET bound_member_id=:m WHERE id=:t AND used_at IS NULL AND expires_at>:now AND (bound_member_id IS NULL OR bound_member_id=:m)`. Zero rows → the matching `ticket_*` code.
- **Consume:** exactly one punch, inside the step-10 transaction: `UPDATE … SET used_at=:now, event_id=:e WHERE id=:t AND used_at IS NULL`. Zero rows → `ticket_used` and the whole transaction rolls back.
- Enrolment needs a live ticket but does not consume it. A ticket whose site is no longer ACTIVE counts as `ticket_expired`.

### 2.2 Client IP (allowlist per site, IPv4 + IPv6)
- Next.js route handlers have no trustworthy socket IP, so the IP comes **only** from the proxy we deploy behind:
  - `TRUSTED_IP_HEADER` is set (for example `fly-client-ip`, `cf-connecting-ip`, `x-real-ip`): use that header's single value. A value holding more than one address → `null`.
  - Otherwise use `X-Forwarded-For`, taking the entry `TRUSTED_PROXY_HOPS` from the **right**. Fewer entries than hops → `null`. The leftmost entry is attacker-controlled and is **never** used. There is no fallback to any other header.
  - In test mode only (§7.2), `x-test-client-ip` overrides both.
- Normalise with `ipaddr.js` `process()`, so IPv4-mapped IPv6 becomes IPv4. An invalid or missing IP gives `ip_unknown`.
- **CIDR rules** (`parseCidr()`, applied on input): syntax error or an IPv4-mapped v6 prefix → `cidr_invalid`; IPv4 prefix shorter than /16 or IPv6 shorter than /32 (this includes `/0`) → `cidr_too_broad`; a network address whose `ipaddr.js` `range()` is `unspecified`, `broadcast`, `multicast`, `linkLocal`, `loopback`, `private`, `carrierGradeNat` or `uniqueLocal` → `cidr_not_public` (behind a proxy the server only ever sees public egress addresses). Documentation ranges (`reserved`, e.g. `198.51.100.0/24`, `2001:db8::/32`) are accepted because the fixture uses them.
- For IPv6, allowlist the office prefix (for example `/64` or `/48`), because each phone gets its own address. Admins must add **both** the v4 egress and the v6 prefix if the Wi-Fi has IPv6.
- The IP is checked at **scan, enrol (options and verify), punch (options and punch), and every kiosk request**. A ticket does not carry "IP ok" forward.
- `GET /api/client-ip` → `{ip}` (the address as the server sees it, or `null`). It helps the admin fill networks and lets AC-36 and AC-39 prove that spoofed headers are ignored.
- Deployment rules (OD-1): the app port must be reachable **only** through the proxy, and the proxy must **overwrite** `TRUSTED_IP_HEADER` (and XFF) on every request, never pass a client-sent value through. AC-39 checks both from outside.

### 2.3 Identity (Auth.js + Google)
- Sessions are JWT (required by Auth.js Credentials, which the test provider uses) with `maxAge` 12 h. **Every request reloads member role and status from the DB**, so suspend and revoke take effect immediately.
- Both providers are normalised to one `Claims {sub, email, email_verified, hd}` in `src/lib/identity.ts` before the policy runs: Google from `profile`, `test-login` from its `authorize()` result. There is one `signIn` policy for every provider, evaluated in order:
  0. No org exists yet: allow only `lower(email) === lower(BOOTSTRAP_OWNER_EMAIL)` with `email_verified`, else `not_allowlisted`. Skip steps 2–4.
  1. `email_verified === true`, else `email_unverified`
  2. org `allowed_google_hd` set: `hd === allowed_google_hd`, else `domain_not_allowed`. The `hd` auth param is only a UI hint, so enforcement is here.
  3. A member with `lower(email)` exists with status INVITED or ACTIVE. Otherwise `not_allowlisted` (`suspended` for SUSPENDED or REMOVED).
  4. First login stores `google_sub`. Later logins must match it, else `account_mismatch`, which catches a reassigned Workspace email.
- Rejection redirects to `/signin?error=<code>` and creates no session.
- After sign-in: INVITED members get `profile_incomplete` from `/api/webauthn/*` and `/api/punch*` until onboarding. SUSPENDED or REMOVED get `suspended` from every API. Admin routes need role admin or owner and status ACTIVE. They do not need a completed profile.
- The test provider (`test-login`) replaces **only the identity proof**. It runs through the same callbacks and policy.

### 2.4 Passkeys (@simplewebauthn, server and browser)
| Step | Settings |
|---|---|
| Registration options | Member ACTIVE, live ticket, allowed IP. `rpID=WEBAUTHN_RP_ID`, `userID` = per-member random 32 bytes (never the email), `attestationType:'none'`, `authenticatorSelection:{authenticatorAttachment:'platform', residentKey:'required', userVerification:'required'}`, `excludeCredentials` = member's PENDING+APPROVED, timeout 60 s. Challenge row bound to member + `register` + ticket |
| Registration verify | Live ticket + allowed IP again. `requireUserVerification:true`, exact `expectedOrigin=WEBAUTHN_ORIGIN`, `expectedRPID`. The library's UV failure → `uv_required`; any other verify failure → `assertion_invalid`. Store id, publicKey, counter, transports, aaguid, deviceType, `backup_eligible` (= multiDevice), `backup_state`, client-reported attachment, reg IP/UA/site/ticket, `status=PENDING`; in the same transaction move an older PENDING to REJECTED (`superseded`) |
| Synced policy | If `orgs.allow_synced_passkeys = false` and BE=1, fail with `synced_not_allowed`. Warn the admin in the UI that this blocks almost every iPhone and Android phone. |
| Punch options | Body `{kind}`. Runs §2.5 steps 1, 2, 3, 5 (binds the ticket) and 6. `userVerification:'required'`, **empty `allowCredentials`** (discoverable), so the server, not the browser, decides which credential is acceptable. Challenge row bound to member + `punch` + ticket + kind |
| Punch verify | The challenge row is looked up by the `challenge` inside `clientDataJSON` and passed as `expectedChallenge`. The credential is looked up by `response.id` (unknown → `assertion_invalid`). `requireUserVerification:true`. `userHandle` must equal the member's `webauthn_user_id` and the credential must belong to the member (`credential_other_user`). Status must be `APPROVED`: PENDING → `credential_pending`, REVOKED or REJECTED → `credential_revoked`. |
| Counter | If stored > 0 or new > 0, new must be > stored, else `counter_regression` plus audit `credential.counter_regression`. Catch the library's counter error and map it to this code. It must not surface as `assertion_invalid`. |
| Challenges | Server-side rows, `WEBAUTHN_CHALLENGE_TTL_SECONDS` (60). Consumed atomically: `UPDATE … SET used_at=:now WHERE id=:id AND used_at IS NULL AND expires_at>:now RETURNING`. Unknown, other member, other purpose, other ticket than the cookie's, or other kind than the body's → `challenge_invalid`; reuse → `challenge_used`; late → `challenge_expired`. |
| Credential states | approve: only PENDING, member ACTIVE, approver ≠ owner of the credential, `confirmCode` matches; reject: only PENDING; revoke: only APPROVED. Wrong state → `invalid_state`, own credential → `forbidden_self_action`, wrong code → `confirm_code_mismatch` |
| Confirm code | `base32(HMAC-SHA256(QR_SIGNING_SECRET, "confirm:" + credential_id))`, first 6 chars. Only the credential's owner sees it (`/api/me/state`, `/enroll` waiting screen). No admin API returns it. |
| Invariants | At most **one APPROVED** and **one PENDING** credential per member (partial unique indexes) |

`authenticatorAttachment` is a request hint and the reported value is unsigned, so it is recorded but not relied on. The signed UV flag is the real control.

### 2.5 Punch: ALL checks must pass, in this exact order (stable error codes for tests)
| # | Check | Fail code |
|---|---|---|
| 1 | `Origin` header present and equal to the `AUTH_URL` origin; JSON content type | `bad_origin` / `bad_request` |
| 2 | Session valid, member ACTIVE, profile complete | `unauthenticated` / `suspended` / `profile_incomplete` |
| 3 | Rate limit (member, from step 2) | `rate_limited` |
| 4 | Consume the WebAuthn challenge (§2.4: purpose `punch`, this member, the cookie's ticket, the body's kind) | `challenge_invalid` / `challenge_used` / `challenge_expired` |
| 5 | Scan ticket present, unexpired, unused, bound to this member, site ACTIVE | `ticket_missing` / `ticket_expired` / `ticket_used` / `ticket_other_user` |
| 6 | Current client IP is in the ticket site's CIDRs | `ip_not_allowed` / `ip_unknown` |
| 7 | Assertion verifies with UV; counter check | `assertion_invalid` / `uv_required` / `counter_regression` |
| 8 | Credential belongs to member (+ `userHandle`) and is APPROVED | `credential_other_user` / `credential_pending` / `credential_revoked` |
| 9 | Inside the step-10 transaction: recompute state; transition valid, then ≥ 60 s since the state row | `already_in` / `not_in` / `too_soon` |
| 10 | Same transaction: consume ticket (guarded `UPDATE`), append chained event, update counter + last_used, update chain head | `ticket_used` |

Steps 9 and 10 are one `commitPunch()` in `src/lib/punch.ts`: a **synchronous** better-sqlite3 transaction with no `await` inside, so two parallel punches cannot both pass the state check (AC-41).
Time comes from the **server only** (`now()` in `src/lib/clock.ts`). Any client-sent time field is ignored. PUNCH rows get `effective_at = recorded_at = now()`.
State = the kind of the member's latest non-voided IN/OUT row (greatest `effective_at`, ties broken by `seq`), across all sites; none counts as OUT. An IN older than its site's `max_shift_hours` (16) counts as OUT for the state, so a forgotten check-out never blocks the next day's check-in; that IN stays open in reports (OD-9). `already_in`/`not_in` take precedence over `too_soon`.

### 2.6 Tamper-evident attendance log
- `attendance_events` is **append-only**. There is no update or delete API. DB triggers abort DELETE and every UPDATE except setting `ip`/`ua` to NULL (retention, OD-5). SQLite: `BEFORE DELETE → RAISE(ABORT)`, `BEFORE UPDATE OF <every column except ip, ua> → RAISE(ABORT)`, `BEFORE UPDATE OF ip, ua WHEN (NEW.ip IS NOT NULL AND NEW.ip IS NOT OLD.ip) OR (NEW.ua IS NOT NULL AND NEW.ua IS NOT OLD.ua) → RAISE(ABORT)`. Postgres: the same as a trigger function. `audit_log` gets the same treatment, with only `ip` nullable.
- `seq` increases monotonically per org (unique `(org_id, seq)`). `chain_heads(org_id, seq, hash)` is updated in the same transaction.
- `hash = HMAC-SHA256(LOG_CHAIN_KEY, prev_hash + canonicalJSON({seq, org_id, member_id, site_id, kind, source, effective_at, recorded_at, credential_id, ticket_id, corrects_seq, reason, actor_member_id}))`. The genesis `prev_hash` is 64 zeros. The key lives in the deploy env, **never in the DB file or its backups**.
- `ip` and `ua` sit **outside** the hash, so they can be purged under the retention policy without breaking the chain.
- **Tail cut:** `chain_heads` is in the same DB, so deleting the newest rows and rewinding `chain_heads` needs no key and passes a plain verify. `verifyChain(rows, key, anchor?)` therefore also fails, at `anchor.seq`, when an anchored `{seq, hash}` is missing or differs. Real anchors are OD-6.
- Corrections are new rows with `source=ADMIN` and a `reason` of 3–500 chars and `actor_member_id`. Kind VOID needs `corrects_seq` pointing at a non-voided IN/OUT row of the same org; a VOID, a voided row or an unknown seq → `bad_request`. Kind IN/OUT needs `effective_at ≤ now()` (future → `bad_request`). The original row never changes. No self-correction (`forbidden_self_action`).
- CSV export: any cell that starts with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` (formula injection through employee-typed names).
- `GET /api/admin/attendance/verify` returns `{ok, firstBadSeq}`. Optional daily external anchoring of the head hash: OD-6.

### 2.7 Web hardening
- Cookies: the Auth.js session cookie and `scan_ticket` are HttpOnly, SameSite=Lax and Secure, with `Path` = `BASE_PATH` or `/`. Over https they use the `__Host-` prefix when `BASE_PATH` is empty and `__Secure-` otherwise. Tests find cookies by name suffix. The kiosk cookie is HttpOnly and lasts 180 days, and its token is stored hashed.
- CSRF: Auth.js covers its own routes. Every other state-changing route (except `/api/test/*`) needs an `Origin` equal to the `AUTH_URL` origin. A **missing** Origin is `bad_origin` too, because browsers always send it on POST. It also needs a JSON content type (`bad_request`). E2E helpers send `Origin` explicitly. Never relax the check to make a test pass.
- Headers: `Referrer-Policy: no-referrer` (QR tokens live in URLs), `X-Content-Type-Options: nosniff`, HSTS in production, and a CSP set in `src/proxy.ts` (Next 16's middleware) with a per-request nonce: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'` (+ `'unsafe-eval'` only when `NODE_ENV=development`, which `next dev` needs)`; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com`. A CSP that breaks hydration turns every E2E test red, so the oracle catches it.
- Rate limits are a DB fixed window (`rate_limits`):

| Route | Key | Limit |
|---|---|---|
| `/s/*`, `/api/client-ip`, sign-in | IP | 30/min from IPs outside every site CIDR; 600/min from inside (an office NAT puts everyone behind one address) |
| `/api/kiosk/pair` | IP | 10/min |
| `/api/punch/options`, `/api/punch`, `/api/webauthn/*`, `/api/profile` | member | 10/min |
| admin writes | member | 60/min |

- Own origin: serve the app on its own origin (for example `attendance.<domain>`). With `BASE_PATH` on a shared host, every other app on that host is inside the trust boundary: its scripts are same-origin, pass the Origin check and share the WebAuthn RP ID (TH-25, OD-1).

## 3. Threat table

| ID | Threat | Attack | Mitigation | Residual risk |
|---|---|---|---|---|
| TH-01 | Remote check-in | Open the scan URL or `/punch` from home | Ticket only issued with a valid QR and allowed IP; IP re-checked at enrol and punch; rotating token ≤ 60 s | **Low** (rotating). **Medium** (static + VPN, see TH-04) |
| TH-02 | Forwarded QR photo | Colleague on site sends a photo or screenshot | Rotating: dead within 60 s and still needs office IP. Static: IP gate only | Rotating **Low**. Static **High** within Wi-Fi range (car park, shared building Wi-Fi) |
| TH-03 | Buddy punching | B hands A an unlocked phone plus passcode, or A uses B's phone | Passkey tied to B's member record and Google `sub` + one APPROVED credential + UV required | **High.** Software cannot see who holds an unlocked phone. Needs a camera or supervisor (OD-7) |
| TH-04 | VPN / proxy into the office | Corporate VPN that egresses via the office IP, or a proxy box left on office Wi-Fi | Allowlist **only the Wi-Fi egress** (VPN egress must differ); rotating QR needs a live view of the kiosk; kiosk tokens only go to office IPs | **Medium.** VPN plus an accomplice streaming the kiosk screen beats both |
| TH-05 | Header spoofing | `X-Forwarded-For: <office IP>`, `X-Real-IP: …`, `x-test-client-ip: …` | Only `TRUSTED_IP_HEADER` or XFF Nth-from-right, no fallback; proxy overwrites the header; test header only in test mode (AC-02, AC-36); spoof check from outside (AC-39) | **Low** if the origin is firewalled behind the proxy. **High** if the app port is public (AC-39 fails the deploy) |
| TH-06 | Replay | Re-send a captured punch, an old QR token or a used ticket | Single-use 60 s challenges bound to member + purpose + ticket + kind; single-use member-bound tickets consumed in the commit transaction; QR windows; counter check when > 0 | **Low** |
| TH-07 | Lost / new phone | Passkey gone, or an attacker claims "new phone" | New credential PENDING; in-person approval with the confirm code from the enrolling phone; old one REVOKED atomically; manual correction for gaps | **Low.** Costs admin effort. Synced passkeys move to new phones without re-approval |
| TH-08 | Stolen phone | Thief who knows the passcode punches as the victim | Needs UV + office IP + live QR + Google session; employee reports, admin revokes or suspends, takes effect on next request | **Medium** until reported |
| TH-09 | Passcode fallback | UV satisfied by the device PIN instead of a fingerprint | Signed UV flag required; nothing stronger exists for web | **Accepted.** "Fingerprint only" cannot be enforced from a web app |
| TH-10 | Google takeover / email reassignment | Attacker signs in as the victim and enrols their own passkey | Enrolment only from the office network; new passkeys PENDING with device evidence; approval needs the confirm code shown on the enrolling phone; `google_sub` pinned and never editable (`account_mismatch`) | **Medium.** Social engineering of the admin. Rule: approve in person only |
| TH-11 | Admin abuse | Fake punches, approving a friend's device, deleting rows, escalating roles | No delete API; triggers; corrections need reason + actor and show in the employee's `/me`; no self-approve, self-correct or self role/status change; only the owner grants admin (AC-43); `audit_log`; optional external anchor (OD-6); optional step-up (OD-8) | **Medium.** An owner with DB access **and** `LOG_CHAIN_KEY` can rebuild the chain. Only external anchoring detects that |
| TH-12 | Clock tampering | Change the phone or kiosk clock to punch "earlier" | Server clock only; client time ignored; the kiosk only displays server-minted tokens and hides them by the server clock | **Low** (server NTP) |
| TH-13 | Direct DB tampering | Edit, delete or reorder rows in the DB file, or cut the newest rows and rewind `chain_heads` | HMAC chain with a key outside the DB; verify endpoint (AC-29); triggers (AC-28); anchored verify catches a tail cut (AC-06) | **Low** for edits without the key. **Medium** for a tail cut until OD-6 anchors exist |
| TH-14 | Test-mode bypass leaks to prod | `test-login` provider, `x-test-client-ip` or `/api/test/*` live in prod | `isTestMode()` = `AUTH_TEST_MODE==='1' && NODE_ENV!=='production'`, where `next build` inlines `production`; `npm start` refuses to boot with the flag set; prod-build check (AC-36) in T06, T15 and before every deploy; staging smoke (AC-39) | **Low.** Remaining case: someone runs `next dev` in prod, which the deploy loop forbids |
| TH-15 | Kiosk compromise | Steal the kiosk cookie and display the QR elsewhere | Kiosk can only fetch display tokens, only from an office IP; pairing only from an office IP; hashed, revocable, site-bound | **Low.** A stolen cookie is useless off the office network |
| TH-16 | Session theft / CSRF | Steal a cookie, cross-site POST | HttpOnly/Secure/SameSite=Lax, `Origin` required (AC-33), 12 h JWT + DB re-check | **Low** |
| TH-17 | Flooding / brute force | Hammer scan, options, punch or kiosk pairing | Rate limits with a higher allowance for office IPs so 9:00 arrivals behind one NAT are not blocked (AC-34); 40-bit single-use pairing codes; constant-time token compare | **Low** |
| TH-18 | Shared phone | Several employees enrol passkeys on one phone | The credential must belong to the session member (`credential_other_user`, `userHandle`) | **Medium.** Same root cause as TH-03 |
| TH-19 | Admin widens the network gate | Adds `0.0.0.0/0`, a private range, or their home `/32` | `cidr_too_broad`, `cidr_not_public` (AC-03); every network change audited (AC-31) | **Medium.** A narrow home address still passes. Only review of `network.add` (OD-6 can push it to the owner) catches it |
| TH-20 | Ghost employee | Admin invites a fake member, enrols it on a second phone and Google account, approves it, punches daily | Invite and approval are both audited with the actor; the confirm code only proves some phone was present | **High** in a one-admin org. Four-eyes (approver ≠ inviter) is OD-10 |
| TH-21 | Double punch race | Two tabs or a scripted client punch in parallel | State check + ticket consumption + chain append in one synchronous transaction (AC-41); unique `(org_id, seq)` | **Low** |
| TH-22 | Missed check-out | Forgotten OUT blocks the next day's IN | An IN older than `max_shift_hours` counts as OUT for the state (AC-07); it stays open for the admin (OD-9) | **Low** |
| TH-23 | CSV formula injection | Employee sets their name to `=HYPERLINK(…)` and the admin opens the export | Leading `= + - @` tab CR escaped (AC-30) | **Low** |
| TH-24 | Admin weakens the QR | Rotation 3600 s, or a static QR with a 10-year TTL | Bounds: rotation 10–120 s, grace 0–2 (AC-31), static TTL ≤ 30 d (AC-15) | **Low** |
| TH-25 | Same-origin neighbour app | Another app on the same host (via `BASE_PATH`) runs script that calls the attendance API | Own origin recommended (OD-1); CSP; HttpOnly cookies | **High** on a shared host, **Low** on its own origin |

## 4. Data model (Drizzle; SQLite for dev and test, Postgres-ready)

| Table | Key columns | Statuses / invariants |
|---|---|---|
| `orgs` | id, name, allowed_google_hd?, allow_synced_passkeys (default true), created_at | one org per deployment in v1 |
| `sites` | id, org_id, name, timezone, qr_mode, rotation_seconds (30), grace_windows (1), qr_key_version (1), max_shift_hours (16), status | qr_mode `rotating`/`static`; status `ACTIVE`/`DISABLED`; rotation 10–120, grace 0–2 |
| `site_networks` | id, site_id, cidr (normalised), label, created_by, created_at | IPv4 or IPv6, public unicast only (§2.2) |
| `members` | id, org_id, email (unique, lower), employee_code?, role, status, google_sub? (unique), webauthn_user_id (32 B, unique), full_name?, phone?, profile_completed_at?, created_by, created_at, last_login_at | role `owner`/`admin`/`employee`; status `INVITED`→`ACTIVE` (onboarding), `ACTIVE`⇄`SUSPENDED`, any→`REMOVED` (terminal); `google_sub` never editable via API |
| `credentials` | id, member_id, credential_id (b64url, unique), public_key, counter, transports, aaguid, device_type, backup_eligible, backup_state, attachment, reg_ip, reg_ua, reg_site_id, reg_ticket_id, status, decided_by?, decided_at?, decision_note?, created_at, last_used_at? | `PENDING`→`APPROVED`/`REJECTED` (incl. `superseded`); `APPROVED`→`REVOKED`. Partial unique: one APPROVED and one PENDING per member |
| `webauthn_challenges` | id, member_id, purpose, challenge (unique), ticket_id?, kind?, expires_at, used_at? | purpose `register`/`punch`; single-use; TTL 60 s |
| `scan_tickets` | id (128-bit random), site_id, source, qr_window?, static_qr_id?, ip, ua, created_at, expires_at, bound_member_id?, used_at?, event_id? | source `rotating`/`static`; TTL 300 s; bound on first use; consumed by one punch |
| `static_qr_codes` | id, site_id, label, issued_by, issued_at, expires_at, status | `ACTIVE`/`REVOKED`; `expires_at − issued_at` 1 h – 30 d |
| `kiosks` | id, site_id, name, token_hash?, pairing_code_hash?, pairing_expires_at?, status, last_seen_at?, created_by | `PAIRING`→`ACTIVE`→`REVOKED` |
| `attendance_events` | id, org_id, seq (unique per org), member_id, site_id?, kind, source, effective_at, recorded_at, credential_id?, ticket_id?, corrects_seq?, reason?, actor_member_id?, prev_hash, hash, ip?, ua? | kind `IN`/`OUT`/`VOID`; source `PUNCH`/`ADMIN`; **append-only (triggers)**, only ip/ua may be nulled |
| `chain_heads` | org_id (pk), seq, hash | updated in the same tx as the insert |
| `audit_log` | id, org_id, actor_member_id?, action, target_type, target_id, detail_json, ip, at | **append-only (triggers)**, only ip may be nulled. Actions: `org.setup/update`, `member.add/update`, `site.add/update`, `network.add/remove`, `qr.static.mint/revoke`, `kiosk.create/pair/revoke`, `credential.approve/reject/revoke/counter_regression`, `attendance.correct` |
| `rate_limits` | key, window_start, count | pk (key, window_start); upsert `count = count + 1 RETURNING count` |

Times are stored as UTC ISO or epoch ms. Reports render in `sites.timezone`.

## 5. Routes & API

### 5.1 Pages
| Path | Who | Purpose |
|---|---|---|
| `/s/[siteId]?t=` | public (IP + QR) | scan entry: check IP, then token, create ticket, 303 to `/punch` |
| `/signin` | public | Google button; shows `?error=<code>` |
| `/onboarding` | employee | profile: name, employee code, phone |
| `/enroll` | employee + ticket | register a passkey (first time or new device); waiting screen with `data-confirm-code` |
| `/punch` | employee + ticket | current state + the one valid action; "new phone" link |
| `/me` | employee | own history, including corrections and reasons |
| `/admin`, `/admin/setup`, `/admin/members`, `/admin/sites/[id]`, `/admin/sites/[id]/qr/[qrId]` (print), `/admin/kiosks`, `/admin/credentials`, `/admin/attendance` | admin/owner | dashboard |
| `/kiosk/pair?code=`, `/kiosk` | kiosk cookie | pairing + rotating QR display (`data-token`, `data-url` attributes for tests; QR element absent when hidden) |

### 5.2 API (route handlers, JSON; errors are `{ "error": "<code>" }`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/health` | public | `{"ok":true}` |
| GET | `/api/client-ip` | public | `{ip}` as the server sees it, or `null` (§2.2) |
| * | `/api/auth/[...nextauth]` | Auth.js | Google (+ `test-login` in test mode only) |
| GET | `/api/me/state` | employee | member, credential status (+ own pending `confirmCode`), punch state, ticket {site, expiresAt} |
| POST | `/api/profile` | employee | onboarding |
| POST | `/api/webauthn/register/options` · `/verify` | employee + ticket + IP | §2.4 |
| POST | `/api/punch/options` | employee + ticket + IP | body `{kind}` |
| POST | `/api/punch` | employee + ticket + IP | body `{kind, response}`, checks in §2.5 order |
| GET | `/api/me/events` | employee | own events |
| POST | `/api/kiosk/pair` | pairing code + site IP | sets kiosk cookie |
| GET | `/api/kiosk/token` | kiosk cookie + site IP | `{token, url, window, expiresAt, serverNow}` |
| POST/PATCH | `/api/admin/setup`, `/api/admin/org` | bootstrap email while no org exists / owner | org settings (hd, synced policy) |
| GET/POST, PATCH | `/api/admin/members`, `/api/admin/members/[id]` | admin (role grants: owner) | allowlist (POST takes one member or an array), role, status, code, email |
| POST, PATCH | `/api/admin/sites`, `/api/admin/sites/[id]` | admin | qr_mode, rotation, grace, timezone, status, key-version bump |
| POST, DELETE | `/api/admin/sites/[id]/networks`, `…/networks/[nid]` | admin | CIDRs |
| POST | `/api/admin/sites/[id]/static-qr`, `/api/admin/static-qr/[id]/revoke` | admin | static QR with TTL |
| POST | `/api/admin/kiosks`, `/api/admin/kiosks/[id]/revoke` | admin | pairing code |
| GET | `/api/admin/credentials?status=PENDING` | admin | approval queue (no confirm code) |
| POST | `/api/admin/credentials/[id]/approve` · `reject` · `revoke` | admin | approve body `{confirmCode}`; no self-approval |
| GET | `/api/admin/attendance`, `…/export.csv`, `…/verify` | admin | log, CSV, chain verify |
| POST | `/api/admin/attendance/corrections` | admin | VOID / IN / OUT + reason |
| POST | `/api/test/reset` · `login` · `clock` · `qr` · `tamper` | **test mode only, else 404** | §7.2 |

### 5.3 Error codes → HTTP
| HTTP | Codes |
|---|---|
| 400 | `bad_request`, `cidr_invalid`, `cidr_too_broad`, `cidr_not_public`, `ttl_too_long`, `code_mismatch`, `reason_required`, `qr_invalid`, `challenge_invalid`, `assertion_invalid` |
| 401 | `unauthenticated`, `kiosk_unauthorized` |
| 403 | `forbidden`, `forbidden_self_action`, `bad_origin`, `not_allowlisted`, `email_unverified`, `domain_not_allowed`, `account_mismatch`, `suspended`, `profile_incomplete`, `ip_not_allowed`, `ip_unknown`, `uv_required`, `credential_pending`, `credential_revoked`, `credential_other_user`, `synced_not_allowed`, `ticket_other_user`, `confirm_code_mismatch` |
| 409 | `already_in`, `not_in`, `too_soon`, `challenge_used`, `ticket_used`, `counter_regression`, `invalid_state` |
| 410 | `qr_expired`, `qr_revoked`, `ticket_expired`, `challenge_expired` |
| 428 | `ticket_missing` |
| 429 | `rate_limited` |

HTML error pages (`/s/…`, `/signin`) render `<main data-error="<code>">`, so tests assert codes and not copy.

## 6. Stack

### 6.1 Packages (pin the exact versions installed in T01)
| Concern | Choice |
|---|---|
| Framework | `next` 16 (App Router, TypeScript strict; middleware lives in `src/proxy.ts`), `react` |
| Auth | `next-auth@5` beta (Auth.js): Google provider + Credentials `test-login` (test mode only); JWT sessions |
| Passkeys | `@simplewebauthn/server`, `@simplewebauthn/browser` |
| DB | `drizzle-orm` + `better-sqlite3`, `drizzle-kit`. "Postgres-ready" means no SQLite-only SQL outside migrations. Porting the schema to `pg-core` is a separate task if OD-1 picks Postgres |
| IP / CIDR | `ipaddr.js` |
| Validation | `zod` |
| QR render | `qrcode` |
| Unit | `vitest` |
| E2E | `@playwright/test`, Chromium project only (CDP WebAuthn, `page.clock`) |
| E2E env | `dotenv-cli` |

### 6.2 Layout (`apps/attendance/`)
```
src/app/…                 pages + route handlers (§5)
src/proxy.ts              CSP nonce + security headers (§2.7)
src/auth.ts               Auth.js config + signIn policy (§2.3)
src/db/schema.ts, src/db/index.ts, drizzle/ (migrations incl. custom trigger migration)
src/lib/{clock,test-mode,identity,ip,qr,tickets,webauthn,punch,punch-state,chain,ratelimit,origin,audit}.ts
src/lib/test-seed.ts      fixture for /api/test/reset (§7.3)
src/instrumentation.ts    logs + throws if prod && AUTH_TEST_MODE
scripts/assert-prod-env.mjs, scripts/check-prod-no-test-mode.sh, scripts/check-ac-coverage.sh, scripts/smoke-remote.sh
tests/unit/*.test.ts      tests/helpers/db.ts (fresh in-memory DB + migrations)
e2e/*.spec.ts             e2e/helpers/{api,webauthn,ceremony}.ts
.env.example  .env.e2e (committed, dummy secrets)  playwright.config.ts  vitest.config.ts  drizzle.config.ts
```
Library functions take keys, clock and DB as parameters; only thin wrappers read `process.env`. That keeps unit tests free of env setup.

### 6.3 npm scripts
| Script | Command |
|---|---|
| `dev` | `next dev` |
| `dev:test` | `dotenv -e .env.e2e -- sh -c "npm run db:migrate && NEXT_DIST_DIR=.next-e2e next dev -p ${E2E_PORT:-3100}"` (migrate added in T03; own dist dir so `next build` never clobbers it) |
| `build` / `start` | `next build` / `node scripts/assert-prod-env.mjs && next start` |
| `lint` / `typecheck` | `eslint .` / `tsc --noEmit` |
| `test` | `vitest run` |
| `e2e` | `playwright test` (baseURL `http://localhost:3100`, workers 1, retries 0, `forbidOnly`, trace `retain-on-failure`, reporters `list` + `json` → `test-results/e2e.json`) |
| `check` | `npm run lint && npm run typecheck && npm run test` |
| `db:generate` / `db:migrate` | `drizzle-kit generate` / `drizzle-kit migrate` |

### 6.4 Environment (`.env.example`)
| Var | Example | Notes |
|---|---|---|
| `AUTH_URL` | `http://localhost:3000` | public origin (+ `BASE_PATH`); its origin is the expected `Origin` |
| `AUTH_SECRET` | `openssl rand -base64 32` | Auth.js |
| `AUTH_TRUST_HOST` | `true` | behind a proxy |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | — | Google OAuth client (human creates it, OD-2) |
| `BOOTSTRAP_OWNER_EMAIL` | `owner@company.com` | first owner, only while no org exists |
| `DATABASE_URL` | `file:./.data/dev.db` | SQLite path |
| `BASE_PATH` | *(empty)* / `/attendance` | Next `basePath`; empty is recommended (own origin, §2.7) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | `localhost` / `Attendance` / `http://localhost:3000` | rpID = registrable domain of the deploy |
| `WEBAUTHN_CHALLENGE_TTL_SECONDS` | `60` | |
| `QR_SIGNING_SECRET` | 32+ random bytes | key derivation for `K_site` and the confirm code |
| `SCAN_TICKET_TTL_SECONDS` | `300` | |
| `STATIC_QR_MAX_TTL_DAYS` | `30` | |
| `LOG_CHAIN_KEY` | 32+ random bytes | **never in the DB** |
| `TRUSTED_IP_HEADER` | *(empty)* / `fly-client-ip` / `cf-connecting-ip` / `x-real-ip` | set (overwritten) by our proxy only |
| `TRUSTED_PROXY_HOPS` | `1` | used when `TRUSTED_IP_HEADER` is empty |
| `AUTH_TEST_MODE` | *(empty)* | `1` only in `.env.e2e`. **Prod refuses to boot if set** |
| `NEXT_DIST_DIR` / `E2E_PORT` | `.next-e2e` / `3100` | e2e dev server only |

`.env.e2e` sets `AUTH_URL` and `WEBAUTHN_ORIGIN` to `http://localhost:3100` and `WEBAUTHN_RP_ID=localhost` (Playwright's `webServer.env` repeats them).
`assert-prod-env.mjs` exits non-zero if `AUTH_TEST_MODE` is set or any of `AUTH_SECRET`, `QR_SIGNING_SECRET`, `LOG_CHAIN_KEY`, `WEBAUTHN_RP_ID` or `WEBAUTHN_ORIGIN` is missing.

## 7. Automated test oracle (this is what lets the loop run without humans)

### 7.1 Fingerprint / Face ID without a human: CDP virtual authenticator (`e2e/helpers/webauthn.ts`)
```ts
export async function addAuthenticator(page: Page, opts: { uv?: boolean; synced?: boolean } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: opts.uv ?? true, automaticPresenceSimulation: true,
      defaultBackupEligibility: opts.synced ?? false, defaultBackupState: opts.synced ?? false,
    },
  });
  return { cdp, authenticatorId };
}
// AC-18: Chrome refuses a UV-REQUIRED ceremony client-side when isUserVerified:false, so the server never
//        sees it. ceremony.ts therefore overrides userVerification:'discouraged' on the client; the
//        authenticator signs with UV=0 and the SERVER must answer uv_required.
// AC-23 counter: getCredentials → removeCredential → addCredential(same privateKey, signCount 0) → next assertion
// AC-26 "passkey deleted / new phone": new browser context + new empty authenticator, same email
// inspect: cdp.send('WebAuthn.getCredentials', {authenticatorId})
```
`e2e/helpers/ceremony.ts` drives the API directly from the page (for abuse cases the UI hides), for both registration and punch. It fetches options, optionally mutates them (the UV override above), calls `PublicKeyCredential.parseCreationOptionsFromJSON`/`parseRequestOptionsFromJSON` → `navigator.credentials.create/get` → `credential.toJSON()`, POSTs the result with an `Origin` header and returns `{status, body}`. It needs Chromium ≥ 129, which ships with Playwright.
Kiosk timers: the kiosk page runs under Playwright `page.clock` (install, then `fastForward`) so its poll and hide timers advance without real sleeps; the server side moves with `setClock`.

### 7.2 Test-only surfaces: all behind `isTestMode()`, and nothing else reads `AUTH_TEST_MODE`
`isTestMode() = process.env.AUTH_TEST_MODE === '1' && process.env.NODE_ENV !== 'production'`.
`next dev` always runs with `NODE_ENV=development`, so requiring `=test` would make E2E impossible. Vitest runs with `test`. The real guarantee is that `next build` **inlines `NODE_ENV='production'`**, which turns test mode into dead code in every prod bundle, plus the boot guard.

| Surface | Purpose |
|---|---|
| Credentials provider `test-login` | `{email, sub?, emailVerified?=true}`: replaces Google's identity proof only. `hd` = email domain unless `gmail.com`, mirroring Google |
| Header `x-test-client-ip` | sets the client IP (v4 or v6); helpers set it per context with `setExtraHTTPHeaders` |
| `POST /api/test/reset` | `{fixture?: 'default' \| 'empty'}`: wipe all tables, clear the test clock, load the §7.3 fixture (`empty` = no org, for AC-37 and AC-42). Call in `beforeEach` |
| `POST /api/test/login` | `{email, sub?, emailVerified?}`: session cookie via `test-login` (goes through the §2.3 policy); a rejection answers 403 `{error:<code>}` and sets no cookie |
| `POST /api/test/clock` | `{offsetMs}` shifts `now()`, `{fixedMs}` freezes it, `{}` clears it (stored on `globalThis`, never in a module-level variable) |
| `POST /api/test/qr` | `{siteId, atMs?}`: mint a rotating token for any time (expired-QR tests) |
| `POST /api/test/tamper` | `{seq, field, value}`: drops the trigger, updates the row and recreates the trigger, to simulate DB tampering |

Every other route returns **404** when test mode is off. `/api/test/*` are exempt from the Origin check; every other test request sends `Origin: <baseURL>`.

### 7.3 Fixture (`src/lib/test-seed.ts`)
| Entity | Value |
|---|---|
| Org | `Acme`, `allowed_google_hd` null, `allow_synced_passkeys` true |
| Site HQ | id `site_hq`, `rotating`, 30 s / grace 1, `max_shift_hours` 16, tz `UTC`, networks `198.51.100.0/24`, `2001:db8:10::/48` |
| Site WH | id `site_wh`, `static`, network `192.0.2.0/24` |
| Members | `owner@acme.test` (owner, ACTIVE), `admin@acme.test` (admin, ACTIVE), `emp1@acme.test` (employee, code `E001`, INVITED), `emp2@acme.test` (employee, `E002`, INVITED) |
| Not allowlisted | `stranger@acme.test`, `someone@gmail.com` |
| IPs | inside `198.51.100.23` and `2001:db8:10::23`; outside `203.0.113.9` |
| Helpers | `reset(fixture?)`, `loginAs(ctx, email)`, `setClock({offsetMs}\|{fixedMs})`, `mintQr(site, atMs?)`, `scan(page, site, ip)`, `onboardAndEnroll(page, email)` (returns the confirm code), `approve(adminCtx, credId, confirmCode)` |

The empty fixture uses `BOOTSTRAP_OWNER_EMAIL=owner@acme.test` from `.env.e2e`.

### 7.4 Prod guard (`scripts/check-prod-no-test-mode.sh`, AC-36)
1. Run `npm run build` with `AUTH_TEST_MODE` unset, against a temp SQLite DB with migrations applied, and dummy values for every var `assert-prod-env.mjs` requires.
2. `AUTH_TEST_MODE=1 npm start` must **exit non-zero** within 30 s (boot guard).
3. Then `AUTH_TEST_MODE=1 npx next start -p 3200`, which deliberately bypasses the guard. Expect: every `/api/test/*` returns 404, `/api/auth/providers` has no `test-login`, and `GET /api/client-ip` with `x-test-client-ip: 198.51.100.23` does **not** return `198.51.100.23`. The instrumentation throw (§6.2) makes a plainly bypassed server answer 500, so D-001 (OPEN, holder decides) sets how this step gets past it. Until it is answered the loop applies D-001 option A: inject the flag after `register()` and also assert that a plain bypassed start serves no 2xx.
4. Kill the server (a `trap` frees port 3200 on every exit path). Exit 0 only if every check passed.

### 7.5 Oracle rules (the loop must not cheat)
- Every AC has at least one test whose title starts with its id: `test('AC-13 wrong IP rejected', …)`. Script ACs (AC-36, AC-39) instead need their script to exist and contain the id.
- `scripts/check-ac-coverage.sh [AC-NN …]` (AC-40): with ids, checks those ids; without, checks every AC in §8 except AC-39 (verified by the deploy task). It reads the ids from this spec (override with `SPEC=`; test dirs with `TEST_DIRS=`) and always fails on `.skip(`, `.only(`, `.fixme(`, `test.todo`, `xit(`, `xdescribe(`, `test.fail(` or `passWithNoTests` anywhere in `tests/`, `e2e/` or the test configs.
- Every task's `done when` starts with the coverage check for its own ACs, so a task with several ACs cannot go green with one of them untested. E2E tasks then run the **whole** E2E suite, so a regression in an earlier AC turns the task red.
- A task's `done when` must **fail before** the work and **pass after**.
- Never delete, `skip`, `only` or `fixme` an AC test, and never weaken an assertion to go green. Changing an AC means editing this spec first and adding a decision entry.
- Tests assert **error codes**, never message text. They do not sleep in real time. Any test near a window or TTL boundary freezes the server clock with `setClock({fixedMs})` and never assumes how much real time passes between two requests. Each test starts from `reset()`. Run serially (1 worker, shared SQLite).
- Stand-ins are explicit: `test-login` replaces Google and the virtual authenticator replaces the phone. Real Google sign-in and a real phone passkey are never exercised by the oracle; a human checks them once on staging (§9).
- Failure evidence for the review loop lives in `apps/attendance/test-results/e2e.json` and Playwright traces.

## 8. Acceptance criteria

| AC | Criterion | Test (file › title prefix) |
|---|---|---|
| AC-01 | `GET /api/health` → 200 `{"ok":true}` | `e2e/smoke.spec.ts` › AC-01 health |
| AC-02 | `clientIp()`: `TRUSTED_IP_HEADER` when set (a multi-value header → null); otherwise XFF entry `TRUSTED_PROXY_HOPS` from the right (fewer entries than hops → null); spoofed leftmost XFF ignored; no fallback header; `x-test-client-ip` ignored outside test mode; garbage → null | `tests/unit/ip.test.ts` › AC-02 client ip extraction |
| AC-03 | `ipAllowed()` matches v4 and v6 CIDRs, normalises IPv4-mapped v6, rejects out-of-range; `parseCidr()`: bad syntax → `cidr_invalid`; `/0`, v4 < /16, v6 < /32 → `cidr_too_broad`; `10.0.0.0/8`, `192.168.1.0/24`, `127.0.0.0/8`, `100.64.0.0/10`, `fd00::/8`, `fe80::/10` → `cidr_not_public`; `198.51.100.0/24` and `2001:db8:10::/48` accepted | `tests/unit/ip.test.ts` › AC-03 cidr matching |
| AC-04 | Rotating token accepted in windows w and w-1; w-2 → `qr_expired`; w+1, wrong site, path site ≠ token site, bad signature, old key version, or a static token on a rotating site → `qr_invalid` | `tests/unit/qr.test.ts` › AC-04 rotating windows |
| AC-05 | Static token valid before `exp`, `qr_expired` after, `qr_invalid` if tampered or presented to a rotating site | `tests/unit/qr.test.ts` › AC-05 static ttl |
| AC-06 | `verifyChain()` ok on an intact chain; returns the first bad seq for a modified, deleted (not newest) or reordered row; wrong key fails at seq 1; with an anchor `{seq, hash}`, cutting the newest rows fails at the anchored seq | `tests/unit/chain.test.ts` › AC-06 chain verify |
| AC-07 | State machine: IN from none/OUT ok; IN after IN → `already_in`; OUT from none/OUT → `not_in`; < 60 s → `too_soon`, but `already_in`/`not_in` win when both apply; VOIDed rows ignored; equal `effective_at` → higher seq wins; an IN older than `max_shift_hours` counts as OUT | `tests/unit/punch-state.test.ts` › AC-07 transitions |
| AC-08 | `isTestMode()` is true only when the flag is set and NODE_ENV≠production; inside `src/`, `AUTH_TEST_MODE` appears only in `src/lib/test-mode.ts` and `src/instrumentation.ts`; `scripts/assert-prod-env.mjs` exits 1 when it is set | `tests/unit/test-mode.test.ts` › AC-08 gate |
| AC-09 | Rate limiter allows N per window, rejects N+1, resets in the next window (injected clock) | `tests/unit/ratelimit.test.ts` › AC-09 fixed window |
| AC-10 | Non-allowlisted account via `test-login` → rejected with `not_allowlisted` (`/api/test/login` 403 body; `/signin?error=not_allowlisted` renders `data-error`); `/api/auth/session` stays empty | `e2e/auth.spec.ts` › AC-10 non-allowlisted rejected |
| AC-11 | Allowlisted verified email signs in; unverified → `email_unverified`; org hd set + other domain → `domain_not_allowed`; same email with a different `sub` → `account_mismatch` | `e2e/auth.spec.ts` › AC-11 sign-in policy |
| AC-12 | Valid rotating QR + inside IP (v4 and v6) → 303 with `Location` ending `/punch` (no `t=`) and an HttpOnly `scan_ticket` cookie | `e2e/scan.spec.ts` › AC-12 valid scan |
| AC-13 | Valid QR from an outside IP → `ip_not_allowed`, no ticket cookie | `e2e/abuse.spec.ts` › AC-13 wrong IP rejected |
| AC-14 | With the server clock frozen mid-window: token 2 windows old → `qr_expired`; 1 window old → accepted | `e2e/abuse.spec.ts` › AC-14 expired QR rejected |
| AC-15 | Static QR accepted before TTL; `qr_expired` after (clock); `qr_revoked` after admin revoke and on a DISABLED site; minting with TTL > 30 d → `ttl_too_long` | `e2e/scan.spec.ts` › AC-15 static QR |
| AC-16 | Onboarding requires name, phone and code; wrong code → `code_mismatch`; `/enroll` or `/punch` before onboarding → redirect to `/onboarding` | `e2e/enroll.spec.ts` › AC-16 onboarding |
| AC-17 | Passkey registration → credential `PENDING` with aaguid, BE/BS, UA, IP, site and ticket stored (read through the admin queue); without a ticket → `ticket_missing`; from an outside IP → `ip_not_allowed`; a second registration moves the first PENDING to REJECTED | `e2e/enroll.spec.ts` › AC-17 register pending |
| AC-18 | Registration signed with UV=0 (client-side `discouraged` override, §7.1) → `uv_required`, nothing stored; replayed registration → `challenge_used` | `e2e/enroll.spec.ts` › AC-18 uv required |
| AC-19 | Member whose only passkey is PENDING completes the ceremony → `credential_pending`, no event row | `e2e/abuse.spec.ts` › AC-19 pending credential cannot check in |
| AC-20 | Admin approve with the right `confirmCode` → APPROVED + audit row; wrong or missing code → `confirm_code_mismatch`; the queue response contains no confirm code; reject → REJECTED; approving a non-PENDING credential → `invalid_state`; approving one's own credential → `forbidden_self_action`; employee → `forbidden` | `e2e/approval.spec.ts` › AC-20 approvals |
| AC-21 | Approved employee: IN, then OUT after +61 s (frozen clock) → 2 rows, consecutive seq, verify ok, both listed in `/me` | `e2e/punch.spec.ts` › AC-21 in and out |
| AC-22 | Second IN without OUT (fresh ticket + challenge) → `already_in` | `e2e/abuse.spec.ts` › AC-22 double check-in rejected |
| AC-23 | Re-POST of a successful punch body → `challenge_used`; assertion after +61 s → `challenge_expired`; challenge from options `{kind:'IN'}` posted with `kind:'OUT'` → `challenge_invalid`; a re-added credential with a lower sign counter → `counter_regression` + audit row | `e2e/abuse.spec.ts` › AC-23 replayed challenge rejected |
| AC-24 | Ticket reused → `ticket_used`; ticket cookie copied into another member's session → `ticket_other_user` (at options or punch); no ticket → `ticket_missing` | `e2e/abuse.spec.ts` › AC-24 ticket single-use |
| AC-25 | IP switched to outside between scan and punch → `ip_not_allowed` | `e2e/abuse.spec.ts` › AC-25 ip rechecked at punch |
| AC-26 | Same Google account, new context + empty authenticator → enrol → PENDING; punch with it → `credential_pending`; after approval new punches ok and the old passkey → `credential_revoked` | `e2e/reregister.spec.ts` › AC-26 new device |
| AC-27 | `recorded_at` = server clock (with test offset); time fields in the client body or headers are ignored | `e2e/punch.spec.ts` › AC-27 server time only |
| AC-28 | UPDATE of any hashed column, or DELETE, on `attendance_events` / `audit_log` aborts at DB level; `UPDATE … SET ip=NULL, ua=NULL` succeeds; setting `ip` to a new value aborts | `tests/unit/db-append-only.test.ts` › AC-28 append-only |
| AC-29 | After `/api/test/tamper`, verify → `{ok:false, firstBadSeq:n}`; untampered → `{ok:true}` | `e2e/abuse.spec.ts` › AC-29 tampered log row detected |
| AC-30 | Correction without reason → `reason_required`; VOID and ADMIN IN create new rows, original unchanged, visible in `/me` and CSV; VOID of a VOID or of a voided row, or a future `effective_at` → `bad_request`; self-correction → `forbidden_self_action`; a name starting with `=` is exported as `'=` | `e2e/admin.spec.ts` › AC-30 corrections |
| AC-31 | Admin adds and edits sites (rotation outside 10–120 or grace outside 0–2 → `bad_request`; DISABLED status), adds and removes CIDRs (`cidr_invalid` / `cidr_too_broad` / `cidr_not_public`); each write audited; employee → `forbidden` on every `/api/admin/*` | `e2e/admin.spec.ts` › AC-31 sites and networks |
| AC-32 | Paired kiosk shows a QR whose `data-token` changes after +30 s (server `setClock` + `page.clock.fastForward`) and whose `data-url` scans fine; pairing or token fetch from an outside IP → `ip_not_allowed`; unpaired or revoked kiosk → 401 `kiosk_unauthorized`; after revoke the QR element disappears once `expiresAt` passes | `e2e/kiosk.spec.ts` › AC-32 kiosk rotation |
| AC-33 | State-changing request with a foreign or missing `Origin` → `bad_origin` | `e2e/abuse.spec.ts` › AC-33 csrf origin |
| AC-34 | 11th `/api/punch/options` within 60 s → `rate_limited`; 31st `/s/*` request within 60 s from an outside IP → `rate_limited`, while 31 from an inside IP are not | `e2e/abuse.spec.ts` › AC-34 rate limit |
| AC-35 | BE=1 passkey stored with the synced flag when the org allows it; `synced_not_allowed` when the org forbids it | `e2e/enroll.spec.ts` › AC-35 synced policy |
| AC-36 | Prod build: the boot guard refuses `AUTH_TEST_MODE=1`; even when bypassed, `/api/test/*` 404s, there is no `test-login` provider and `/api/client-ip` ignores the test IP header | `scripts/check-prod-no-test-mode.sh` |
| AC-37 | Journey from the `empty` fixture: bootstrap owner setup → site + network → member → kiosk pair → scan the kiosk's `data-url` → sign in (`test-login` stands in for Google) → onboard → enrol (UI) → approve with the code read from the phone page → IN → +61 s → rescan → OUT → CSV has both → verify ok. Admin steps via `/api/admin/*`, employee steps via the UI | `e2e/journey.spec.ts` › AC-37 full journey |
| AC-38 | Session and `scan_ticket` cookies HttpOnly + SameSite=Lax; `Referrer-Policy: no-referrer` and a CSP with `frame-ancestors 'none'` present | `e2e/abuse.spec.ts` › AC-38 cookies and headers |
| AC-39 | Staging over HTTPS: health ok, HSTS present, `/api/test/*` 404, no `test-login` provider; `/api/client-ip` sent with spoofed `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` / `Fly-Client-IP` = `198.51.100.23` does not return that address; the app port (`ORIGIN_PORT`, default 3000, `none` on PaaS) is not reachable directly | `scripts/smoke-remote.sh <url>` |
| AC-40 | `check-ac-coverage.sh`: exits 0 when every requested AC has a titled test; non-zero for a missing id, for any skip/only/fixme/todo marker and for `passWithNoTests` (run against temp fixture dirs via `SPEC=` / `TEST_DIRS=`) | `tests/unit/ac-coverage.test.ts` › AC-40 coverage guard |
| AC-41 | `commitPunch()`: two commits with the same ticket → the second `ticket_used`; two commits of IN with different tickets → the second `already_in`; a failed commit leaves no event, no used ticket and an unchanged chain head; seqs stay consecutive and the chain verifies | `tests/unit/punch-commit.test.ts` › AC-41 atomic punch commit |
| AC-42 | From the `empty` fixture: only `BOOTSTRAP_OWNER_EMAIL` can sign in (others → `not_allowlisted`); `/api/admin/setup` creates org + owner + first site; a second setup → `forbidden` | `e2e/admin.spec.ts` › AC-42 bootstrap |
| AC-43 | Members: admin adds one member or an array, edits code/status/email; admin granting `admin`/`owner` → `forbidden` (owner may); changing one's own role or status → `forbidden_self_action`; demoting, suspending or removing the last ACTIVE owner → `invalid_state`; `google_sub` is not writable; a member suspended by an admin gets `suspended` at the next sign-in and on the next API call; each write audited | `e2e/admin.spec.ts` › AC-43 member rules |

## 9. Open decisions (only the loop holder decides; mirrored into `loop/decisions.md`)

| ID | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| OD-1 | Deploy target, client-IP source, staging origin | A) VPS + Caddy (auto-TLS, overwrites `X-Forwarded-For`), SQLite file, XFF hops=1, app port firewalled · B) Fly.io (`fly-client-ip`), SQLite on a volume · C) Vercel + Postgres (`x-real-ip`; needs a schema-port task). Plus: own subdomain vs `BASE_PATH` on a shared host | **A** on its **own subdomain** (`BASE_PATH` empty): one box, no DB service, the simplest IP story to explain on stage, and no same-origin neighbours (TH-25) | T16 |
| OD-2 | Google OAuth client + domain restriction | A) any Google account, allowlist only · B) restrict to one Workspace domain (`allowed_google_hd`) | **A** for the demo, **B** for real customers. Human action: create the OAuth client with redirect `https://<staging>/api/auth/callback/google` and put the secrets in the deploy env | T16 |
| OD-3 | Default QR mode for new sites (+ rotation) | A) rotating kiosk, 30 s, grace 1 · B) static printed with a TTL | **A**; allow B with a max TTL of 30 days (enforced) and a "weaker" warning | — |
| OD-4 | Allow synced passkeys (BE=1)? | A) allow + flag in the approval UI · B) reject (blocks nearly all iPhones and Androids) | **A** | — |
| OD-5 | Data retention | events / IP+UA / tickets+challenges+rate_limits / audit | events 24 mo · IP+UA nulled after 90 d (the triggers allow exactly this) · tickets etc. purged after 7 d · audit 24 mo. The purge job is a later task | — |
| OD-6 | External anchoring of the log head hash | A) none · B) daily head hash (events + audit) and every `network.*` / `credential.approve` change posted to an external channel (Telegram / email / object-lock bucket) | **B**: cheap, makes owner-level rewrites and tail cuts detectable, and shows the owner TH-19/TH-20 activity | — |
| OD-7 | Buddy-punch control beyond software | A) accept the documented residual · B) kiosk camera snapshot at punch · C) supervisor spot checks | **A** for v1; B as a later venture | — |
| OD-8 | Admin step-up (own passkey UV) for approve, revoke and correct | A) no · B) yes | **B**, as a v1.1 task after T15 | — |
| OD-9 | Missed check-out | A) leave open + flag in the report (state treats it as OUT after `max_shift_hours`) · B) auto-close at site midnight | **A**; the admin corrects with a reason | — |
| OD-10 | Four-eyes for approvals | A) none · B) approver ≠ the member's inviter, owner exempt · C) B + network changes need a second admin | **B** once the org has 2+ admins; until then TH-20 stays **High** | — |

Human touchpoints, the complete list: answer OD-1..OD-10, create the Google OAuth client and its secrets, own DNS and the domain, do one real-phone check on staging (real Google sign-in + real passkey + approve + IN/OUT, because the oracle only uses stand-ins), and approve promotion beyond staging. Everything else is loop-owned.
