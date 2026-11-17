# attendance

On-site check-in with QR + office Wi-Fi + passkey. Spec: `specs/attendance.md`. Backlog: `loop/backlog-attendance.md`.

| Command | What |
|---|---|
| `npm run dev` | dev server on :3000 (uses `.env.local`, linked by `loop/secrets.sh link attendance`) |
| `npm run dev:test` | test-mode dev server on :3100 with `.env.e2e` (dummy secrets, `AUTH_TEST_MODE=1`) |
| `npm run check` | lint + typecheck + unit tests (the global gate) |
| `npm run e2e` | Playwright (Chromium), starts `dev:test` itself |
