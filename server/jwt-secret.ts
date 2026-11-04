/**
 * Guard for the HMAC secret that signs session and Google Reader API JWTs.
 *
 * fast-jwt has had advisories where an empty or missing key let forged or
 * unsigned tokens verify (GHSA-gmvf-9v4p-v8jc, GHSA-8wpc-h4q6-8fxv). Those are
 * fixed in the pinned fast-jwt, but the server should never get that far:
 * refuse to start rather than sign or verify with a blank secret.
 */

/** HS256 wants at least 256 bits of key material; shorter secrets start with a warning. */
export const RECOMMENDED_JWT_SECRET_MIN_LENGTH = 32

export interface ValidatedJwtSecret {
  secret: string
  /** Set when the secret is usable but shorter than recommended. */
  warning: string | null
}

/**
 * Throws if `secret` is missing, empty or whitespace-only. `source` names where
 * the secret came from, for the error and warning messages.
 */
export function validateJwtSecret(secret: string | undefined | null, source: string): ValidatedJwtSecret {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error(`JWT secret from ${source} is empty or blank`)
  }
  const warning = secret.length < RECOMMENDED_JWT_SECRET_MIN_LENGTH
    ? `JWT secret from ${source} is only ${secret.length} characters; use at least ${RECOMMENDED_JWT_SECRET_MIN_LENGTH} random characters (e.g. \`openssl rand -base64 48\`)`
    : null
  return { secret, warning }
}
