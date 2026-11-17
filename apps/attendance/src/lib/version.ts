/**
 * The deployed version (specs/prod-loop.md PR-04): the commit the production image was built from.
 * The Dockerfile bakes the build arg GIT_SHA into the image env; loop/deploy/ship.sh passes the full sha.
 * Returns its first 12 hex chars, or null when GIT_SHA is unset or not a commit sha (dev, E2E, CI), so
 * /api/health then stays exactly {"ok":true} (AC-01) and a deploy's version check fails closed.
 */
export function deployedVersion(env: Record<string, string | undefined> = process.env): string | null {
  const sha = (env.GIT_SHA ?? "").trim().toLowerCase();
  return /^[0-9a-f]{12,40}$/.test(sha) ? sha.slice(0, 12) : null;
}
