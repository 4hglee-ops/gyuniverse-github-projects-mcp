# Temporary OAuth DCR rejection diagnostics

Purpose: identify which existing `/oauth/register` rejection branch rejects a real hosted connector request. The instrumentation itself does not change OAuth behavior. The subsequent public-client negotiation change is documented in [OAuth DCR public-client negotiation](OAUTH_DCR_PUBLIC_CLIENT_NEGOTIATION.md).

## Exact log schema

`console.info("oauth_register_rejected", { route, reason, fields })`

- `route`: fixed literal `/oauth/register`, never copied from an incoming URL.
- `reason`: one of the fixed codes below.
- `fields`: present own-property names selected in fixed order from the allowlist below. No values are accessed by the logger. Unknown names are omitted because even a key name could contain a secret.
- Timestamp/level are supplied by the runtime; the application adds no other fields.

| Reason | Existing rejection condition |
| --- | --- |
| `json_parse_failed` | JSON body parsing failed; field list is empty |
| `redirect_uris_missing_or_invalid` | Redirect list is absent, non-array, or empty |
| `redirect_uri_not_allowed` | At least one redirect entry fails the existing allowlist |
| `unsupported_token_endpoint_auth_method` | Truthy auth method other than exact `none`, `client_secret_basic`, or `client_secret_post`; the latter two are negotiated to effective `none` |
| `unsupported_grant_type` | A grant is neither `authorization_code` nor `refresh_token` |
| `authorization_code_missing` | Grant list does not include `authorization_code` |
| `unsupported_response_type` | A response type is not exact `code` |

Allowlisted field names, in order:

```text
redirect_uris, token_endpoint_auth_method, grant_types, response_types,
client_name, scope, application_type, client_uri, logo_uri, contacts,
tos_uri, policy_uri, jwks_uri, jwks, software_id, software_version,
software_statement
```

Exactly one diagnostic is emitted on each deliberate 400 return. First failure wins. Successful registrations emit no rejection event. The logger catches its own failures so observability cannot replace the original response.

No request bodies, redirect values, client IDs/secrets, authorization codes, tokens, cookies, Authorization headers, access codes, unknown key names, metadata values, or raw exception text are emitted.

## Behavior preservation and deferred hardening

The original diagnostics-only patch preserved validation predicates, evaluation order, accepted metadata, status codes, response JSON, and cache headers. The subsequent compatibility patch only expands accepted auth-method requests as described above and records effective `none`. No CSP, discovery, redirect allowlist, token exchange, access-code authentication, relationship tools, or permission changes are included.

JSON `null`, string grant/response lists, and numeric client names can currently throw TypeError. Converting those exceptions into deliberate 400s would change existing failure behavior. That hardening is deliberately deferred to a separate reviewed change; `malformed_metadata_type` is not emitted by this PR. Characterization tests preserve the current behavior.

## Tests and operational use

Tests cover every deliberate rejection reason and exact OAuth error response; accepted Claude-shaped public PKCE metadata; omitted/default/extra fields; absence of successful-registration diagnostics; exclusion of secrets, headers and attacker-controlled key names; and logger failure isolation.

After separate review, merge, and Production deployment approval: retry the Claude hosted connector once and inspect `oauth_register_rejected` at the request timestamp. Use only `reason`, `fields`, and fixed `route` as evidence. This does not establish exact rejected values or a client's negotiation algorithm. Do not collect full request bodies or secret-bearing HAR files.

Remove the temporary instrumentation after identifying the rejection and validating the narrowly scoped fix. No log drain or additional external telemetry destination is introduced. Production remains unchanged until merge/deployment.
