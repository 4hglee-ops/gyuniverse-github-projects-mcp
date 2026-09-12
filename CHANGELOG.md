# Changelog

All notable changes to this project will be documented in this file.

The format follows a simple chronological release log. This project is currently pre-1.0, so interfaces and configuration may still evolve between minor releases.

## [0.2.0] - 2026-09-13

### Added

- Remote HTTP MCP support with OAuth discovery, DCR, and PKCE.
- Shared Core used by MCP and GPT Actions / REST adapters.
- Viewer / Member / Admin role model with capability-based runtime authorization.
- Project state reads, workflow gap detection, and project brief generation.
- Guarded Status / Priority and work-item operations.
- Project checkpoints and state delta comparison.
- Durable write audit backed by Upstash in Production.
- Parent / sub-issue and dependency relationship reads.
- Guarded relationship writes with post-write verification.
- Bulk Preview → Approval → Apply workflow with stale-state preflight.
- Production closeout validation and regression coverage.

### Security

- Explicit owner and Project allowlists.
- Separate client-facing OAuth tokens from server-side GitHub credentials.
- Global write gates and per-operation capabilities.
- Re-read verification after supported mutations.
- No destructive delete tools exposed by default.

### Documentation

- Public-release README guidance.
- Apache-2.0 license.
- Contribution guide, issue templates, and pull request template.
- Updated security and deployment documentation.

## [0.1.0]

Initial GitHub Projects MCP foundation and local development baseline.
