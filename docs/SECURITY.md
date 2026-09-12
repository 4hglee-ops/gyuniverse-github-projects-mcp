# 보안 모델

## 1. 기본 원칙

Gyuniverse GitHub Projects MCP는 **read-first + fail-closed**를 기본 보안 모델로 사용합니다.

소스 코드와 Production endpoint가 공개되어 있어도 임의의 GitHub Project에 접근할 수 있는 것은 아닙니다.

```text
Publicly reachable
      ≠
Publicly authorized
```

인증된 요청은 OAuth scope, identity, owner/Project allowlist, Project membership, capability, write gate, operation별 검증을 모두 통과해야 합니다.

## 2. Credential 경계

서버가 GitHub에 접근할 때 사용하는 credential과 MCP client가 받는 OAuth token은 서로 다른 자격 증명입니다.

```text
AI Client
  └─ MCP OAuth access token

Server
  └─ GITHUB_TOKEN / GitHub App token
       └─ GitHub GraphQL API 호출에만 사용
```

서버의 GitHub credential을 client-facing OAuth token으로 발급하거나 응답에 포함하지 않습니다.

다음 값은 절대로 repository, issue, PR, screenshot, log에 올리면 안 됩니다.

- GitHub PAT / GitHub App token
- OAuth signing secret
- OAuth access/team code
- GPT Actions client secret
- Upstash credential
- bearer / refresh token
- cookie / Authorization header
- 실제 `.env`

`.env.example`에는 placeholder만 둡니다.

## 3. 권한 결정 흐름

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

역할(role)은 capability의 기본 묶음이고, 실제 runtime authorization은 capability를 기준으로 합니다.

Identity별 `permissions` 설정은 역할 기본 권한을 **좁힐 수만 있고 확장할 수 없습니다.**

## 4. Read 경계

Remote authenticated access에서는 다음 경계를 함께 사용합니다.

- `GITHUB_PROJECTS_ALLOWED_OWNERS`
- `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`
- identity의 `projectIds`
- `project.read` capability

필수 authorization 경계가 비어 있거나 target이 포함되지 않으면 요청은 fail closed합니다.

## 5. Write 경계

Remote write는 `projects:write` scope 하나만으로 허용되지 않습니다.

최소한 다음 조건이 함께 필요합니다.

1. server-side GitHub credential이 필요한 Projects permission을 보유
2. `GITHUB_PROJECTS_WRITE_ENABLED=true`
3. target Project가 explicit allowlist에 포함
4. authenticated identity가 target Project member
5. 해당 operation capability 보유
6. Remote OAuth에서는 `projects:write` scope 보유
7. `MCP_OAUTH_WRITE_ENABLED=true`
8. operation-specific validation / preflight 성공

즉 client가 write scope를 요청했다고 서버의 write gate가 자동으로 열리지 않습니다.

## 6. Guarded Write

고수준 write는 다음 원칙을 적용합니다.

- 정확한 Project / field / option resolve
- Project membership 확인
- 현재 값 확인
- 이미 원하는 값이면 no-op
- mutation 수행
- GitHub에서 다시 조회
- 예상 상태와 일치할 때만 verified success
- audit 기록

이 방식으로 API 호출 성공과 **실제 상태 반영 성공**을 구분합니다.

## 7. Relationship 안전성

parent/sub-issue와 dependency 관계 변경은 bounded single-edge operation입니다.

- Admin relationship capability 필요
- mutation 전 대상 검증
- mutation 후 reciprocal state 재조회
- 무제한 reparenting이나 arbitrary graph mutation 미제공

## 8. Bulk 안전성

Bulk operation은 다음 세 단계로 제한합니다.

```text
Preview
   ↓
Approval
   ↓
Apply
```

주요 보장:

- 하나의 Project 기준
- Status / Priority 중심의 제한된 범위
- operation 수 제한
- digest-bound immutable Preview plan
- explicit approval
- Apply 전 전체 authorization 재검사
- stale-state preflight
- preflight 실패 시 0 writes
- compare-and-set single-use Apply
- item별 re-read verification
- durable `planId` / audit correlation
- 선택적으로 `distinct_admin_required` maker-checker 적용

자동 rollback이나 partial resume는 제공하지 않습니다.

## 9. OAuth 보안

Remote endpoint는 다음을 지원합니다.

- protected-resource discovery
- authorization-server discovery
- DCR(Dynamic Client Registration)
- Authorization Code flow
- PKCE S256
- read/write scope 분리
- request-scoped bearer authorization

Authorization code는 짧은 수명을 가지며 Production에서는 Upstash Redis를 이용해 one-time replay protection을 적용합니다.

Replay state에는 raw authorization code 대신 SHA-256 digest를 사용합니다.

## 10. Durable State

Production에서 Upstash에 저장되는 운영 상태:

- OAuth replay claim
- checkpoint baseline
- bounded write audit
- bulk plan

이 데이터는 운영 증거이지 완전한 compliance/SIEM archive가 아닙니다.

저장하면 안 되는 값:

- PAT / GitHub token
- raw OAuth code
- OAuth/client secret
- cookie
- Authorization header
- credential snapshot

## 11. Hosted endpoint와 self-hosting

Maintainer가 운영하는 endpoint는 공개 URL이지만, maintainer가 설정한 identity와 Project만 사용할 수 있습니다.

자신의 GitHub Projects를 연결하려는 외부 사용자는 self-hosting을 권장합니다.

Self-hosting 시 직접 준비해야 하는 항목:

- GitHub credential
- owner / Project allowlist
- OAuth identity / capability
- write gate
- public base URL
- durable store

## 12. 최소 권한 원칙

권장 순서:

1. GitHub Projects read permission으로 시작
2. Project / field / item / relationship read 검증
3. 필요한 사용자만 identity에 등록
4. 필요한 capability만 허용
5. 실제 mutation이 필요할 때만 GitHub write permission과 server write gate 활성화
6. Remote write가 필요할 때만 OAuth write scope 활성화

## 13. 파괴적 기능

Project나 Project item을 삭제하는 destructive delete tool은 의도적으로 기본 surface에 제공하지 않습니다.

이는 AI의 실수나 잘못된 context가 irreversible operation으로 이어지는 위험을 줄이기 위한 선택입니다.

## 14. Production 검증 상태

M10 Advanced Governance까지 Production validation을 완료했습니다.

현재 공개 저장소 기준 regression suite는 **249 / 249 tests PASS**이며, 별도의 full-history Gitleaks 검사에서도 **0 findings**를 확인했습니다.

세부 개발·검증 과정은 [`history/README.md`](history/README.md)를 참고하세요.

## 15. 취약점 제보

실제 credential, private Project data, active infrastructure exploit detail을 public issue에 올리지 마세요.

GitHub Private Vulnerability Reporting이 활성화되어 있다면 해당 경로를 우선 사용하고, 그렇지 않다면 maintainer에게 비공개로 알려주세요.

공유하는 log와 screenshot에서도 token, cookie, Authorization header, private data를 제거해야 합니다.
