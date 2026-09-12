# 아키텍처

## 1. 목표

`gyuniverse-github-projects-mcp`는 GitHub 전체 API를 다시 구현하는 서버가 아니라, **GitHub Projects v2의 팀 상태와 업무 흐름을 AI가 안전하게 읽고 변경할 수 있도록 만드는 MCP 서버**입니다.

Repository code, Issue, Pull Request, Actions 자체는 기존 GitHub 도구를 그대로 사용하고, 이 프로젝트는 다음 영역에 집중합니다.

- Project / field / item 조회
- 현재 상태 정규화와 분석
- Status / Priority 등 고수준 변경
- parent / sub-issue / dependency 관계 조회·변경
- checkpoint / delta
- bulk Preview → Approval → Apply
- durable audit
- Viewer / Member / Admin 및 capability 기반 권한 제어

## 2. 전체 구조

```text
ChatGPT / Claude / MCP Client
              │
        OAuth / Remote MCP
              │
              ▼
        MCP / REST Adapter
              │
              ▼
          Shared Core
      ┌───────┼─────────┐
      │       │         │
    Read    Write   Governance
      │       │         │
      │       │         ├─ Checkpoint / Delta
      │       │         ├─ Durable Audit
      │       │         └─ Bulk Plan
      │       │
      └───────┴──────────────► GitHub GraphQL API
                                  │
                                  ▼
                           GitHub Projects v2
```

핵심 원칙은 **MCP와 REST/GPT Actions가 서로를 호출하지 않고 같은 Shared Core를 사용한다는 것**입니다.

## 3. 진입점

### Local stdio

```text
Local AI Client
      │
      │ stdio
      ▼
src/mcp/stdio.ts
      │
      ▼
buildMcpServer()
```

### Remote MCP

```text
ChatGPT / Claude / Remote Client
      │
      │ OAuth Bearer Token
      ▼
src/http/router.ts
      │
      ├─ OAuth discovery / register / authorize / token
      │
      ▼
src/http/remote-mcp.ts
      │
      ▼
Shared Core / MCP Server
      │
      │ server-side GitHub credential
      ▼
GitHub GraphQL API
```

### GPT Actions / REST

GPT Actions용 REST/OpenAPI adapter도 MCP와 동일한 Shared Core, authorization, verification, audit 경계를 사용합니다.

## 4. Credential 분리

클라이언트가 받는 OAuth token과 서버가 GitHub에 접근할 때 사용하는 credential은 완전히 분리합니다.

```text
Client credential
= MCP OAuth access token
= projects:read / projects:write scope

Server credential
= GITHUB_TOKEN
= GitHub GraphQL 호출에만 사용
= 클라이언트에 반환하지 않음
```

Public endpoint에 접속할 수 있다고 해서 GitHub Project 접근 권한이 생기지 않습니다.

```text
Publicly reachable
      ≠
Publicly authorized
```

## 5. Authorization 흐름

인증된 요청은 다음 경계를 모두 통과해야 합니다.

```text
OAuth identity + scope
        ↓
Owner allowlist
        ↓
Project allowlist
        ↓
Identity Project membership
        ↓
Operation capability
        ↓
Global write gate
        ↓
Precondition / preflight
        ↓
GitHub mutation
        ↓
Re-read verification
        ↓
Durable audit
```

역할(role)은 기본 권한 묶음이고, 실제 runtime 판단은 capability를 기준으로 합니다.

## 6. Read / Analysis 계층

읽기 계층은 GitHub Projects의 원본 상태를 모델이 다루기 쉬운 형태로 정규화합니다.

대표 기능:

- Project / field / item 조회
- Project snapshot 생성
- missing Status / assignee 탐지
- PR merge 상태와 Project Status 불일치 탐지
- 현재 사용자 작업 조회
- parent / sub-issue / blocks / blocked-by 조회
- checkpoint와 현재 상태 비교

분석 결과는 가능한 한 원본 Issue/PR URL, item ID, field 값, assignee 등 근거를 함께 유지합니다.

## 7. Guarded Write

AI가 직접 raw GraphQL node ID를 조합해 mutation하는 방식보다 **의미 기반 고수준 도구**를 우선합니다.

예를 들어 Status 변경은 다음 순서로 처리됩니다.

```text
owner + Project + item + "In Progress"
        ↓
Project 접근 권한 확인
        ↓
Status field / option 정확히 resolve
        ↓
현재 값과 Project membership 확인
        ↓
이미 같은 값이면 no-op
        ↓
GitHub mutation
        ↓
다시 조회하여 실제 반영 확인
        ↓
검증 결과 + audit 기록
```

즉 API가 성공 응답을 줬다는 사실만으로 완료 처리하지 않고, **변경 후 재조회(re-read verification)** 결과를 기준으로 성공을 판단합니다.

## 8. Relationship

GitHub Issue 관계는 다음을 지원합니다.

- parent / sub-issue 조회
- blocks / blocked-by 조회
- sub-issue 추가·제거
- dependency 추가·제거

관계 변경은 Admin capability가 필요한 bounded single-edge write로 처리하며, mutation 후 reciprocal state를 다시 조회합니다.

무제한 graph mutation이나 임의 reparenting 도구는 제공하지 않습니다.

## 9. Bulk Governance

여러 item을 한 번에 변경할 때는 즉시 mutation하지 않습니다.

```text
Preview
   ↓
Approval
   ↓
Apply
```

주요 안전장치:

- 하나의 Project 단위
- Status / Priority 범위로 제한
- operation 수 제한
- Preview 결과를 digest-bound immutable plan으로 저장
- Apply 전에 권한과 current state를 다시 검사
- stale preflight면 mutation 없이 실패
- Apply는 single-use
- item별 재조회 검증
- planId와 write audit 연결
- 필요 시 `distinct_admin_required` maker-checker 정책 사용

## 10. Durable State

Production에서는 Upstash Redis를 사용해 여러 Vercel Function instance 사이에서도 상태를 공유합니다.

저장 대상:

- OAuth authorization-code replay claim
- Project checkpoint baseline
- bounded write audit
- bulk plan state

저장하지 않는 대상:

- GitHub PAT
- OAuth raw authorization code
- client secret
- Authorization header
- cookie
- credential snapshot

## 11. OAuth / Remote HTTP

주요 route:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
/oauth/register
/oauth/authorize
/oauth/token
/mcp
/health
/openapi.json
```

지원하는 핵심 흐름:

- OAuth discovery
- Dynamic Client Registration(DCR)
- Authorization Code
- PKCE S256
- read / write scope 분리
- request-scoped identity와 capability 적용

Production에서는 process memory replay store로 자동 fallback하지 않고, durable store가 필요한 상황에서 설정이 잘못되면 fail closed합니다.

## 12. 역할과 capability

현재 기본 역할은 Viewer / Member / Admin 세 가지입니다.

- Viewer: 조회·분석
- Member: 조회 + 일반 Status/Priority 및 일부 item operation
- Admin: 생성·할당·generic field·relationship·bulk governance 포함

상세 matrix는 [`PERMISSIONS.md`](PERMISSIONS.md)를 참고하세요.

## 13. 배포 구조

```text
GitHub Public Repository
        │
        ▼
     Vercel
        │
        ├─ MCP / OAuth / REST runtime
        │
        └─ Upstash Redis
              ├─ replay
              ├─ checkpoint
              ├─ audit
              └─ bulk plans
```

현재 maintainer-operated Production은 Vercel Functions + Upstash 구조이며, self-hosting도 가능합니다.

자세한 내용은 [`DEPLOYMENT.md`](DEPLOYMENT.md)를 참고하세요.

## 14. 설계 원칙

1. **Projects-focused** — GitHub 전체 기능을 중복 구현하지 않는다.
2. **Read-first** — 기본 운영은 조회 중심이다.
3. **Credential separation** — MCP OAuth token과 GitHub credential을 분리한다.
4. **Explicit writes** — write는 명시적인 gate를 통과해야 한다.
5. **Least privilege** — identity별 capability를 필요한 범위로 제한한다.
6. **Fail closed** — 권한·storage·precondition이 불확실하면 실행하지 않는다.
7. **No destructive delete tools** — 파괴적인 삭제 기능을 기본 surface에 두지 않는다.
8. **No-op before mutation** — 이미 원하는 상태면 불필요한 write를 하지 않는다.
9. **Verify after mutation** — write 후 실제 GitHub 상태를 다시 확인한다.
10. **Evidence-preserving** — 분석과 변경 결과에 근거가 남도록 한다.
11. **Shared Core** — MCP와 REST가 동일한 business logic과 authorization을 사용한다.
12. **Bounded governance** — audit와 bulk plan을 통제 가능한 범위로 제한한다.

## 15. 현재 상태

v0.2.0 기준으로 M10 Advanced Governance까지 구현·Production 검증되었습니다.

현재 regression suite는 **249 / 249 tests PASS** 상태입니다.

과거 milestone의 설계·검증 과정은 [`history/README.md`](history/README.md)에서 확인할 수 있습니다.
