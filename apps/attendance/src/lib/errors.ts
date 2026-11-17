/** Stable error codes and their HTTP status (spec §5.3). Tests assert codes, never message text. */
export const ERROR_STATUS = {
  bad_request: 400,
  cidr_invalid: 400,
  cidr_too_broad: 400,
  cidr_not_public: 400,
  ttl_too_long: 400,
  code_mismatch: 400,
  reason_required: 400,
  qr_invalid: 400,
  challenge_invalid: 400,
  assertion_invalid: 400,
  unauthenticated: 401,
  kiosk_unauthorized: 401,
  forbidden: 403,
  forbidden_self_action: 403,
  bad_origin: 403,
  not_allowlisted: 403,
  email_unverified: 403,
  domain_not_allowed: 403,
  account_mismatch: 403,
  suspended: 403,
  profile_incomplete: 403,
  ip_not_allowed: 403,
  ip_unknown: 403,
  uv_required: 403,
  credential_pending: 403,
  credential_revoked: 403,
  credential_other_user: 403,
  synced_not_allowed: 403,
  ticket_other_user: 403,
  confirm_code_mismatch: 403,
  already_in: 409,
  not_in: 409,
  too_soon: 409,
  challenge_used: 409,
  ticket_used: 409,
  counter_regression: 409,
  invalid_state: 409,
  qr_expired: 410,
  qr_revoked: 410,
  ticket_expired: 410,
  challenge_expired: 410,
  ticket_missing: 428,
  rate_limited: 429,
  not_found: 404,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
