/** Next.js basePath (spec decision: empty in dev, "/attendance" on staging). */
export function basePath(): string {
  return process.env.BASE_PATH ?? "";
}

/** Prefix an app-relative path ("/signin") with the base path, for redirects and links built by hand. */
export function withBase(path: string): string {
  return `${basePath()}${path}`;
}
