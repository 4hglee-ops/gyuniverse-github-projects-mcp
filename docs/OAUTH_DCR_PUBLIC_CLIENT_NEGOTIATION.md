# OAuth DCR public-client negotiation

Production diagnostics confirmed `unsupported_token_endpoint_auth_method`. They
intentionally did not capture the requested value. The hosted Claude retry remains
necessary to establish whether this compatibility change resolves its full flow.

## Narrow normalization

`POST /oauth/register` accepts exact `none`, `client_secret_basic`, and
`client_secret_post` requests. Every successful registration uses effective
`token_endpoint_auth_method: "none"`; no client secret or secret expiry is issued.
Existing omitted/falsy-method handling is preserved. Other truthy methods still
return the existing 400 `invalid_client_metadata` and bounded rejection diagnostic.
All other registration validation remains unchanged.

[RFC 7591 section 3.2.1](https://www.rfc-editor.org/rfc/rfc7591.html#section-3.2.1)
permits the server to substitute requested metadata and return its effective
values. The client must inspect the response and decide whether it can use the
registered configuration. This does not guarantee every client will accept `none`.

## Stored metadata and security boundary

Registration is stateless: the server signs metadata into the `gyprc` client ID.
New payloads explicitly contain `tokenEndpointAuthMethod: "none"`, never the
requested confidential method. The type allows omission only for compatibility
with previously issued signed registrations.

Authorization selects `public_pkce` for every dynamic client independently of
requested metadata, and signs that mode into the authorization code. Public
authorization still requires an explicit resource and S256 challenge. Token
exchange still requires the matching verifier and rejects client secrets supplied
in either Basic authentication or the form. Refresh tokens preserve `public_pkce`
and continue rejecting client secrets. Replay protection is unchanged.

Only the separately configured GPT Actions client ID selects
`gpt_actions_confidential`; it still requires its configured secret at the token
endpoint. No authorization/token handler, discovery metadata, PKCE enforcement,
CSP, redirect allowlist, access-code authentication, or M10 logic is changed.
Malformed metadata-type hardening remains deferred.

## Regression coverage

- All three requested methods: response and verified stored metadata use `none`,
  no secret is issued, and successful registration emits no rejection diagnostic.
- Full registration/authorization/token/refresh flow, including legacy client IDs.
- Missing challenge, non-S256 or absent challenge method, missing/wrong verifier,
  attempted confidential credentials, and replay remain rejected.
- Both preconfigured GPT Actions secret methods still work without PKCE and still
  reject absent/wrong secrets.
- Unknown methods and all existing bounded-diagnostic tests remain covered.

## Production validation after separate merge/deployment approval

1. Confirm the approved commit is Ready on the Production hostname
   `gyuniverse-github-projects-mcp.vercel.app`, not Preview.
2. Retry the Claude hosted custom connector using the existing authorized flow.
   Confirm registration succeeds, effective method is `none`, and no secret is
   returned; do not save/log client IDs, tokens, codes, headers, or full payloads.
3. Confirm S256 authorization, public token exchange, and a read-only MCP call
   succeed. Record only statuses and sanitized outcomes. Do not perform writes.
4. If registration still fails, retain only the existing fixed reason/field-name
   diagnostic. If registration succeeds but Claude cannot use `none`, investigate
   that separate client negotiation failure without adding confidential DCR.
5. Confirm the existing GPT Actions connection still works. Negative PKCE and
   confidential-credential rejection are automated locally; do not weaken them
   to make a hosted retry succeed.

This PR does not merge or modify Production. Existing bounded diagnostics remain
in place, with no additional logging destinations or sensitive values.
