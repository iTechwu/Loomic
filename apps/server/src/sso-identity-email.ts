const SSO_PLACEHOLDER_EMAIL_DOMAIN = "dofe.invalid";

/**
 * Profiles require an email while SSO identities authenticated by phone may
 * legitimately omit one. The reserved domain keeps that local value stable,
 * non-deliverable, and distinct from a verified SSO email.
 */
export function ssoProfileEmail(ssoUserId: string, email?: string): string {
  const normalized = email?.trim();
  return normalized || `sso-${ssoUserId}@${SSO_PLACEHOLDER_EMAIL_DOMAIN}`;
}
