# Security

`attendance` is an **anti-cheat** system: its job is to stop people from checking in when they are not on site.
So a way to cheat it is a vulnerability, even when nothing "crashes". Please report it privately.

## How to report

1. Open the repo's **Security** tab and choose **Report a vulnerability**
   (GitHub private vulnerability reporting: https://github.com/AQaddora/loop-lab/security/advisories/new).
   The report goes only to the repo owner.
2. Include: what you did, what you expected the system to refuse, what it accepted, the commit sha you tested,
   and the exact commands or a failing test that reproduces it against the **local** fixtures.
3. If the reporting button is missing, open an issue with the **Security contact (no details)** template. Its title
   says only "security report: please enable private reporting", and it has no fields for details. Keep it that way.

Never put a bypass, a secret or anyone's personal data in a public issue, a PR, a decision entry or a chat.

## What counts

The design is in `specs/attendance.md` §2, and the threats are in its §3 table (TH-01 … TH-25). Report anything that
breaks a mitigation the spec claims, for example:

- a check-in (punch) that succeeds when one of the ten checks in spec §2.5 should have refused it
- a client IP that can be chosen by the client: a spoofed header honoured, or the test header `x-test-client-ip`
  honoured outside test mode (TH-05)
- any test-only surface reachable in a production build: `/api/test/*`, the `test-login` provider, the fake clock (TH-14, AC-36)
- a QR token, scan ticket or WebAuthn challenge that can be replayed, forged or used by another member (TH-06)
- a passkey that can punch without admin approval, or an approval without the confirm code from the enrolling phone (TH-07, TH-10)
- an edit to the attendance log that `GET /api/admin/attendance/verify` does not catch (TH-13), other than the tail cut below
- a role, status or network change by someone the spec does not allow (TH-11, TH-19, AC-43)

## Known limits (not vulnerabilities)

The spec states these on purpose (§0 and §3). A report that only restates one is not a vulnerability, but a cheaper or
new way to exploit one is welcome.

| Limit | Why | Spec |
|---|---|---|
| A synced passkey works on every device of the same Apple or Google account | iOS and Android sync passkeys; the server can see the sync flags but cannot stop syncing | §0, OD-4 |
| Someone who lends an unlocked phone and its passcode can be "checked in" by a colleague | no web app can see who holds an unlocked phone | TH-03, OD-7 |
| An admin who adds a narrow home address as an "office network" lets that home pass the IP gate | only too-broad and non-public ranges are refused; a review of `network.add` catches it | TH-19 |
| A VPN that leaves through the office network passes the IP gate | the gate proves the network egress, not physical presence | TH-04 |
| The OS passcode can satisfy user verification instead of a fingerprint | the signed UV flag does not say which method was used | TH-09 |
| Cutting the newest log rows is not detected without an external anchor | the chain head lives in the same database | TH-13, OD-6 |
| One admin can invite and approve a ghost employee | four-eyes approval is an open decision | TH-20, OD-10 |

## Test locally, never against production

- **Never test against the production origin**, https://attendance.apps.taqat.academy. It is the production
  loop's deploy target (D-023, `specs/prod-loop.md`). Whether or not it is running when you read this, do not probe it:
  no sign-in attempts, no scans, no punches, no load or flood tests.
- Use the local E2E fixtures instead. `npm --prefix apps/attendance run dev:test` starts a test-mode server on
  http://localhost:3100 with dummy values from `.env.e2e`. `POST /api/test/reset` loads the fixture from spec §7.3:
  the org `Acme`, two sites, four members and documentation-only IP ranges.
- The best report is a failing test. Add it under `apps/attendance/e2e/` or `apps/attendance/tests/unit/`, show that
  it fails on the current commit, and attach it to the private report, not to a public PR.
- [docs/guide/attendance-system.md](docs/guide/attendance-system.md) explains how to run the app and the oracle.

## Secrets

The repo holds no secret by design (`CLAUDE.md` rule 9). `.env.example` lists names only, and `.env.e2e` holds
test-only dummy values. If you find a real secret anywhere in the repo or its history, report it privately the same way.
