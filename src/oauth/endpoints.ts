import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenPayload,
  AUTH_CODE_TTL_SECONDS,
  AuthorizationCodePayload,
  canonicalMcpResource,
  isAllowedRedirectUri,
  normalizeScope,
  nowSeconds,
  oauthTeamCode,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  publicBaseUrl,
  REFRESH_TOKEN_TTL_SECONDS,
  RefreshTokenPayload,
  RegisteredClientPayload,
  remoteWriteOauthEnabled,
  scopeIncludes,
  scopeIsAllowed,
  sha256Base64Url,
  signEnvelope,
  verifyEnvelope,
} from "./stateless.js";
import { MemoryOAuthReplayStore, OAuthReplayStore } from "./replay-store.js";

export const authorizationCodeReplayStore: OAuthReplayStore = new MemoryOAuthReplayStore();

// The remainder of this file intentionally keeps the existing endpoint logic.
// Replay protection now depends on the injectable store contract instead of a
// concrete in-memory implementation, allowing shared stores for deployment.

