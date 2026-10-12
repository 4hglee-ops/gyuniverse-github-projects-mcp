# External MCP Preview smoke (developer workstation)

This is an opt-in **read-only** check for the fixed `develop` Preview URL. It does not call any GitHub Project read/write tool. Production is never contacted.

## Prerequisites

- Node.js 22+, system curl, and Vercel CLI 48.8+ installed.
- Run `vercel login` using an account authorized for the `skn-34-2nd-5-team` Vercel team.
- Vercel Preview `develop` has `MCP_LEGACY_JSON_TRANSPORT_ENABLED=true`.
- A **separate synthetic Viewer OAuth identity** exists in `MCP_OAUTH_IDENTITIES_JSON` for the `develop` branch with:
  - `subject`: `user:mcp-preview-transport-probe`
  - `role`: `viewer`
  - `projectIds`: `["PVT_PREVIEW_PROBE_ONLY"]`
  - `accessCode`: a long, randomly generated secret known only to the tester.
- The `develop` branch's `PUBLIC_BASE_URL` matches the fixed alias `https://gyuniverse-github-projects-mcp-git-develop-skn-34-2nd-5-team.vercel.app`.

## Run from PowerShell

```powershell
vercel login
$env:GYP_PREVIEW_ACCESS_CODE = Read-Host "Preview synthetic Viewer access code"
node scripts/mcp-preview-external-smoke.mjs
Remove-Item Env:GYP_PREVIEW_ACCESS_CODE
```

The script uses `vercel curl` to bypass Vercel Deployment Protection **without turning it off**. It performs discovery, OAuth public-client registration with S256 PKCE, authorization, token exchange, and legacy `initialize`/`tools/list`/`tools/call get_identity_context`, followed by modern `tools/list`.

A missing access code runs only initial readiness checks. The script emits status, content type, and duration; it never prints authorization credentials, bearer tokens, redirect URLs, raw tool responses, or full request bodies. Share **only redacted PASS/FAIL lines**, not local shell history or debug logs.

**Do not run this against Production.** If the system reports 401 at the protection layer, confirm the Vercel account/team permissions. If a 401 challenge from the MCP app appears, that is expected for unauthenticated requests. A passing synthetic identity smoke does not prove real GitHub Project read/write access. Leave Preview's Vercel Authentication enabled.

Vercel CLI reference: https://vercel.com/docs/cli/curl
