import { randomBytes } from "node:crypto";

/** 128-bit random id, base64url (22 chars). */
export function randomId(prefix = ""): string {
  return `${prefix}${randomBytes(16).toString("base64url")}`;
}

/** n random bytes, base64url. */
export function randomB64url(n: number): string {
  return randomBytes(n).toString("base64url");
}
