// Temporary rejection-only diagnostics. Remove after the hosted DCR failure is identified.
// Never enumerate arbitrary keys: an unknown key name can itself contain a secret.
const metadataFields = [
  "redirect_uris", "token_endpoint_auth_method", "grant_types", "response_types",
  "client_name", "scope", "application_type", "client_uri", "logo_uri", "contacts",
  "tos_uri", "policy_uri", "jwks_uri", "jwks", "software_id", "software_version",
  "software_statement",
] as const;

export type RegistrationRejectionReason =
  | "json_parse_failed"
  | "redirect_uris_missing_or_invalid"
  | "redirect_uri_not_allowed"
  | "unsupported_token_endpoint_auth_method"
  | "unsupported_grant_type"
  | "authorization_code_missing"
  | "unsupported_response_type";

export function logRegistrationRejection(reason: RegistrationRejectionReason, body?: unknown): void {
  try {
    const fields = body !== null && typeof body === "object" && !Array.isArray(body)
      ? metadataFields.filter((field) => Object.hasOwn(body, field))
      : [];
    console.info("oauth_register_rejected", { route: "/oauth/register", reason, fields });
  } catch {
    // Diagnostic failures must not affect registration behavior or leak exceptions.
  }
}
