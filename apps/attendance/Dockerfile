# Production image for the attendance app (T16, specs/prod-loop.md §3).
#
# Build it from a clean export of one commit, never from the working tree. Then the image holds exactly the code
# its GIT_SHA names, and the team can accept that specific version. loop/deploy/ship.sh does this. By hand:
#
#   sha=$(git rev-parse <ref>); tmp=$(mktemp -d)
#   git archive "$sha" apps/attendance | tar -x -C "$tmp"
#   docker build --build-arg GIT_SHA="$sha" -t "loop-lab-attendance:${sha:0:12}" "$tmp/apps/attendance"
#
# `docker build apps/attendance` builds whatever the working tree holds, committed or not. Never label such an
# image with a commit sha, and never ship it.
#
# The image is built on loop-runner and shipped to apps-host. Runtime config (secrets, AUTH_URL, WebAuthn,
# TRUSTED_*) comes from the host's env, never from this file. AUTH_TEST_MODE is never set here: `npm start`
# refuses to boot with it (scripts/assert-prod-env.mjs, spec TH-14).

# ---- deps: every package, from the lockfile ------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# --ignore-scripts: no package install script runs at build time. better-sqlite3 ships N-API prebuilds
# (prebuilds/linux-x64.node), so it needs no compiler; only dev-only esbuild has a postinstall.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---- build: next build in production mode, then drop dev deps -------------------------------------------
FROM deps AS build
COPY . .
# The build DB is a throwaway file inside this stage. It never reaches the runtime image.
# After the build: drop dev deps, plus what prune keeps but the server never loads (Playwright is an optional
# peer of next; the musl SWC binary is dead weight on this glibc base).
RUN unset AUTH_TEST_MODE \
 && NODE_ENV=production BASE_PATH="" DATABASE_URL="file:/tmp/build-db/attendance.db" \
    node node_modules/next/dist/bin/next build \
 && npm prune --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf .next/cache node_modules/@playwright node_modules/playwright node_modules/playwright-core \
    node_modules/@next/swc-*-musl

# ---- runtime: only what `npm start` needs, run as the non-root node user (uid 1000) -----------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/attendance.db

COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# migrations: the server applies them when it first opens the DB (src/db/index.ts)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/assert-prod-env.mjs ./scripts/assert-prod-env.mjs

# /data holds the SQLite file (the host mounts its storage here). The app code stays root-owned and read-only
# for the runtime user; only /data and Next's cache dir are writable.
RUN mkdir -p /data /app/.next/cache && chown node:node /data /app/.next/cache

ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

USER node
EXPOSE 3000
# npm start = node scripts/assert-prod-env.mjs && next start
CMD ["npm", "start"]
