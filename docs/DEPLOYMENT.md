# 배포와 Runtime

## 1. Production 구조

Maintainer가 운영하는 Production은 다음 구조를 사용합니다.

```text
GitHub Repository
      │
      ▼
   Vercel
      │
      ├─ MCP / OAuth / REST runtime
      │
      └─ Upstash Redis
            ├─ OAuth replay protection
            ├─ checkpoint
            ├─ write audit
            └─ bulk plan
```

Vercel Functions가 HTTP runtime을 담당하고, 여러 Function instance가 함께 써야 하는 상태는 Upstash Redis에 저장합니다.

## 2. Runtime adapter

Vercel과 Node HTTP adapter는 서로 다른 business logic을 갖지 않습니다.

```text
Vercel Request -> api/index.ts -> src/http/vercel.ts ----+
                                                         +-> handleRemoteHttpRequest()
node:http ------> src/http/node-server.ts ---------------+
```

둘 다 같은 provider-neutral router와 Shared Core를 사용합니다.

## 3. 주요 endpoint

```text
/health
/mcp
/openapi.json
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
/oauth/register
/oauth/authorize
/oauth/token
```

`/mcp`에 인증 없이 접근했을 때 `401`과 정상적인 Bearer/OAuth challenge가 반환되는 것은 정상 동작입니다.

## 4. Durable replay protection

Production에서는 OAuth authorization code의 one-time semantics를 위해 shared replay store가 필요합니다.

```dotenv
MCP_OAUTH_REPLAY_STORE=upstash
```

authorization code는 raw 값 자체를 Redis key로 저장하지 않고 SHA-256 digest를 사용합니다.

Upstash 연결은 다음 계열을 지원합니다.

```dotenv
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Vercel Marketplace가 제공하는 `KV_REST_API_*` 계열 변수도 runtime에서 지원할 수 있습니다.

Production에서 durable replay store가 필요한데 설정이 없거나 사용할 수 없으면 memory로 조용히 fallback하지 않고 fail closed합니다.

## 5. Governance state

M10 governance는 다음 상태를 durable store에 둘 수 있습니다.

- checkpoint baseline
- bounded write audit
- bulk plan

OAuth replay와 같은 Upstash deployment를 사용하더라도 namespace를 분리합니다.

`M10_GOVERNANCE_STORE`로 별도 선택을 명시할 수도 있습니다.

## 6. Hosted instance

Maintainer-operated endpoint는 실제 배포된 이 repository의 인스턴스입니다.

하지만 공개 URL이라는 이유로 누구나 임의의 GitHub Project에 접근할 수 있는 것은 아닙니다.

```text
Public endpoint
    ≠
Open GitHub access
```

Hosted instance는 maintainer가 등록한 identity, owner, Project, capability 범위에서만 동작합니다.

## 7. Self-hosting

자신의 GitHub Projects를 연결하려는 사용자는 self-hosting을 권장합니다.

최소 구성 예시는 다음과 같습니다.

```dotenv
GITHUB_TOKEN=
GITHUB_PROJECTS_ALLOWED_OWNERS=
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=
GITHUB_PROJECTS_WRITE_ENABLED=false

PUBLIC_BASE_URL=
MCP_OAUTH_SIGNING_SECRET=
MCP_OAUTH_IDENTITIES_JSON=
MCP_OAUTH_REPLAY_STORE=upstash

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

MCP_OAUTH_WRITE_ENABLED=false
```

정확한 전체 변수 목록은 `.env.example`을 기준으로 확인하세요.

## 8. 권장 초기 설정

처음부터 write를 열지 않는 것을 권장합니다.

```text
1. GitHub read permission
2. owner / Project allowlist 지정
3. identity membership 지정
4. read smoke test
5. 필요한 capability만 허용
6. 단건 write 검증
7. 필요한 경우에만 remote write 활성화
```

## 9. Local 개발

stdio MCP:

```bash
pnpm mcp:stdio
```

Node HTTP runtime:

```bash
pnpm mcp:http
```

기본 검증:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

## 10. 환경 분리

실제 secret은 deployment provider의 secret/environment store에만 둡니다.

가능하면 다음 환경은 서로 분리합니다.

- local development
- preview
- Production

특히 다음 credential을 여러 trust boundary에서 습관적으로 재사용하지 않는 것이 좋습니다.

- OAuth signing secret
- access code
- GitHub credential
- GPT Actions confidential client secret
- Redis credential

## 11. 현재 Production 상태

Public repository migration 이후 Production Vercel Project는 새 sanitized repository의 `main`에 연결되어 있습니다.

검증된 상태:

- `/health` → 200
- `/mcp` unauthenticated → 정상 401 challenge
- OAuth protected resource → 200
- OAuth authorization server metadata → 200
- `/openapi.json` → 200
- 5xx runtime response 없음

현재 배포와 authorization 구조의 보안 경계는 [`SECURITY.md`](SECURITY.md)를 참고하세요.
