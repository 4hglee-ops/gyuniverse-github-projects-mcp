# MCP Views · 관리자 콘솔 통합 진행 기록

기준일: 2026-10-23 (Asia/Seoul)

## 1단계: main / develop 호환 기반선

- 브랜치: `integration/mcp-views-admin`; PR 대상은 `develop`.
- 시작점: 원격 `develop`의 `fb63ee48cd20686f01596b477a1339d8bc6bb09a`.
- 가져온 `main`: `10888e8ae36710cc06a1e3a9f6ee66f3c979ada2`.
- 공통 조상: `d7428351a50e3244f80cfcb6a624c2d5fd6e4413`.
- `develop`에만 15개, `main`에만 4개 커밋. `main`을 통합 브랜치에 병합하며 양쪽 이력을 보존했다.
- 텍스트 충돌은 없었다. 양쪽에서 수정한 `src/core/policy/write-policy.ts`와 `src/mcp/build-server.ts`의 동작을 회귀 검증했다.
- 사용자 제공 `Gyuniverse_MCP_Codex_Integration_Plan.md`를 요구사항으로 읽었다. 해당 원본은 사용자가 추가한 로컬 파일이며 이번 PR에 포함하지 않는다.

### 보존한 동작과 변경 파일

| 범위 | 파일 | 결과 |
| --- | --- | --- |
| 기존 OAuth + 추가 사용자 | `.env.example`, `docs/PERMISSIONS.md`, `src/core/identity/oauth-identity-registry.ts`, `src/core/identity/oauth-identity-registry.test.ts` | 기존 ENV와 추가 ENV를 함께 읽고 중복 자격증명을 거부하는 #21 유지 |
| WBS 권한 | `src/core/policy/write-policy.ts` | #22의 `configure_project_fields`를 M12의 Project별 권한 검사와 결합 |
| WBS 서비스 | `src/project-foundation/wbs-field-setup.ts`, `src/project-foundation/wbs-field-setup.test.ts` | Project #3 전용 경계와 기존 필드 보존 유지 |
| 전체 항목 조회 | `src/github/projects.ts`, `src/github/projects.test.ts` | #24의 페이지네이션·중복/커서 검증 유지 |
| Snapshot·상위 읽기 | `src/core/snapshots/snapshot-service.ts`, `src/core/snapshots/snapshot-service.test.ts`, `src/core/reads/high-level-read-service.ts`, `src/mcp/high-level-read-tools.ts` | coverage와 500개까지의 요청 범위 유지 |
| MCP 도구 구성 | `src/mcp/build-server.ts` | Provider 경유 읽기, Admin 진단, WBS 도구를 함께 등록 |
| 담당자 지정 | `src/workflow/assignee-update.ts`, `src/workflow/assignee-update.test.ts` | #23의 유효한 GraphQL 응답 선택 유지 |
| 통합 회귀 | `src/mcp/integration-compatibility.test.ts`, `src/core/policy/write-policy.test.ts` | MCP 전체 경로와 신규 WBS 작업의 M12 권한 경계 검증 추가 |
| 진행 기록 | `docs/MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md` | 이 문서 |

위 표의 19개 파일이 최신 `develop` 대비 PR 변경 범위다. 승인 목록의 `src/http/mcp-sse-lifecycle.integration.test.ts`는 최신 `develop`에 이미 있어 그대로 보존되며, PR diff에 추가 변경은 없다. 잠금 파일과 의존성 버전은 변경하지 않았다.

`develop`의 M11 Provider/resource model, M12 팀 ACL/DB 읽기 경계, 기존 MCP 진단·전송·Preview 회귀 코드는 유지했다. 미병합 실험 PR #13과 관리자 Draft PR #20은 가져오지 않았다. 이 기반선 전체를 향후 릴리스에 포함할지는 별도 검토 대상이다.

### 실행한 검증

| 검증 | 결과 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 통과; 잠금 파일 변경 없음 |
| `pnpm typecheck` | 통과; 일반 소스와 Vercel API 타입 검사 |
| `pnpm test` | 내부 `pnpm build` 통과; 전체 307개 통과, 실패/취소/건너뜀 0개 |
| 실제 MCP 요청 통합 회귀 | 메모리 transport로 도구 목록, 합성 153개 항목·snapshot 조회, WBS preview, 권한 거부 확인 |
| WBS 권한 회귀 | Viewer/Member, 전역 write gate, allowlist, Project별 field/write 권한 축소 시 거부 확인 |

### 원격 검증 증거

- [Draft PR #25](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/pull/25), 대상 `develop`, 미병합.
- 코드 통합 커밋: `6d5958c655dfcdc48b8986ad1c79ed3545d359e7` (부모: `fb63ee4`, `10888e8`).
- [GitHub CI](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/actions/runs/39923959339/job/120315677206): Node.js v22.23.3에서 타입 검사·빌드·307개 테스트 통과.
- [전체 이력 Gitleaks](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/actions/runs/39923959399/job/120315677468): 통과.
- [Vercel Preview](https://gyuniverse-github-projects-mcp-git-int-edb109-skn-34-2nd-5-team.vercel.app): GitHub Vercel 상태에서 배포 완료 확인. 실제 OAuth/관리자 로그인/Project API 검증 완료를 뜻하지 않는다.
- 위 CI 링크는 코드 통합 커밋의 결과다. 이후 문서만 갱신한 커밋의 최신 CI는 PR Checks에서 별도 확인한다.

153개는 테스트에서 생성한 합성 항목 수다. 실제 Project #3의 137개 T-* 작업/16개 상위 이슈/상세 필드/담당자/Status를 재조회해 검증했다는 의미가 아니다. GitHub, DB, Redis 및 Production의 데이터나 환경변수에 쓰지 않았다.

## 후속 단계와 위험

| 단계 | 상태 | 필요한 작업 |
| --- | --- | --- |
| 호환 기반선 | 로컬 구현·검증 완료 | Draft PR의 CI·보안 스캔 확인 후 리뷰 |
| 공통 Project View API | 2단계 로컬 구현·합성 검증 | 아래 로컬 결과 참조. Push/새 PR/CI/외부 검증은 미실행 |
| 관리자 #20 안전 포팅 | 미착수 | 사용자·키·OAuth 호환, allowlist 기반 Project 선택, 팀 ACL 연결, 인증·세션·CSRF·CSP 강화 |
| 관리자 View 화면 | 미착수 | 조회 → 템플릿 비교 → 명시적 적용 → 재조회 결과·수동 항목 표시 |
| 보호된 Preview 실측 | 미검증 | 로그인, 키 폐기·권한 축소 즉시 반영, OAuth 클라이언트 연결, 타임아웃, View API 지원 범위 |
| Production 활성화 | 미승인 | Preview 완료와 별도 사용자 승인 필요 |

- `operating-foundation.ts`는 Project #2와 Status 다섯 개에 고정되어 있다. Project #3에 그대로 적용하지 않는다. 기존 View·Status·Part·필드와 Issue는 삭제·재생성·재분류하지 않는다.
- GraphQL View 수정 범위와 REST 생성 시 정수 필드 ID를 구분해야 한다. 그룹·정렬·Roadmap 날짜 배치를 미검증 상태에서 성공으로 간주하지 않는다.
- #20의 CSP는 인라인 CSS와 충돌한다. 공유 비밀번호, 세션 폐기, 일회성 키 화면 정리와 실제 브라우저 보안 검증이 필요하다.
- M12 `enforce` 모드의 팀 grant와 #20의 관리형 사용자 기록은 자동으로 연결된다고 가정할 수 없다. 권한 교집합과 기존 ENV 자격증명을 함께 보존해야 한다.
- 외부 인증·운영 데이터 보존의 실측과 Preview 배포는 이번 로컬 테스트에 포함되지 않는다.

### DB 마이그레이션 의존성

1. 기존 `001_team_acl_foundation.sql`: 팀/사용자/연결/리소스/grant 구조.
2. 기존 `002_team_acl_secure_snapshot_rpc.sql`: 001 이후 RLS·권한 제한·snapshot RPC.
3. 기존 `003_restrict_automatic_rls_function.sql`: 대상 환경에 해당 자동 RLS 함수가 존재하는지 확인한 후 검토.
4. #20의 `004_admin_console_credentials.sql`: M12 구조 이후 관리형 사용자·키 해시·감사/RPC. 아직 이 통합 브랜치에는 포함하지 않았다.

#20의 PR 본문은 004 미적용, 브랜치 문서는 적용 완료라고 기록한다. 실제 전용 DB 상태는 미확인이다. migration 파일만으로 적용 여부를 추정하거나, 기존 Flowin/Discord DB에 적용하지 않는다. 이번 단계에서는 어떤 migration도 실행하지 않았다.

### 안전한 검토와 롤백

- 이 단계의 PR은 `develop`만 대상으로 하며, 아직 자동 병합하지 않는다. 기존 `main`과 로컬 `develop` 브랜치 포인터는 유지한다.
- Preview·DB·Project 데이터 변경이 없어 현재 단계의 운영 데이터 롤백은 필요하지 않다. 검증 실패 시 PR을 미병합 상태로 두고 같은 통합 브랜치에서 수정한다.
- 향후 병합 후 되돌려야 하면 실제 병합 방식과 커밋을 확인한 뒤 `develop` 대상 revert PR을 만든다. 보호 브랜치 reset/force-push는 사용하지 않는다.
- 다음 단계의 파일 경로·내용·이유·영향을 설명하고 승인받은 뒤 해당 범위만 수정한다.

## 2단계 제안 승인 범위: 공통 Project View API

아래 25개 파일은 제안 당시의 승인 범위다. 이후 코드 수정·로컬 브랜치 생성·합성 테스트·타입 검사·빌드까지만 진행하도록 제한된 사용자 승인 질문/응답이 전달되었다. 이 제한으로 `codex/project-view-api` 브랜치에서 로컬 구현했다. Push/새 PR/배포는 현재 범위에서 제외하며 #25와 #20은 병합하지 않는다.

목적은 Project #2에 고정된 기존 View 코드를 다른 허용 Project에서도 안전하게 사용하도록 하는 것이다. `list_project_views`, `preview_project_view_setup`, `apply_project_view_setup`, `update_project_view`를 MCP와 REST가 같은 Core로 호출하게 한다. 템플릿은 #2의 기존 보기와 #3의 WBS/Status/Part/내 작업/마감/Roadmap 구성을 지원 가능한 범위로 나눈다.

쓰기 기능은 Admin 전용 Project별 capability, owner/Project allowlist, 기존 OAuth write scope·write gate를 모두 통과해야 한다. Preview는 외부 쓰기 없이 planId/digest/TTL을 발급하며, 명시적으로 승인된 계획만 현재 상태 재검증·동시 실행 방지·중복 생성 방지·재조회·감사를 거쳐 적용한다. 지원하지 않는 그룹·정렬 수정과 Roadmap 날짜 선택은 수동 항목으로 반환한다. 삭제 API는 노출하지 않는다.

### 정확한 파일 경로와 변경 내용

모든 경로는 현재 승인 요청의 대상이다. 이 표 밖의 추가 파일이 필요하면 먼저 알린다.

| 절대 경로 | 생성/수정 내용과 이유 |
| --- | --- |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\github\project-views.ts` | 공통 View 조회·페이지네이션, 공식 API 생성·부분 수정, REST 필드 ID 매핑 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\github\project-views.test.ts` | 요청 형식·페이지네이션·필드 ID·오류 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\project-view-service.ts` | ACL, preview/apply/update, 상태 재검증·부분 실패·감사 연결 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\project-view-service.test.ts` | 0 writes, 권한 거부, stale 계획, 충돌, 실패·재시도·재실행 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\view-plan.ts` | 불변 계획·digest·만료·지원/수동 항목 분류 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\view-plan.test.ts` | 계획 변조·만료·분류 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\view-plan-store.ts` | 로컬/Upstash 계획 저장과 원자적 상태 전환; 기존 Redis와 별도 namespace |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\view-plan-store.test.ts` | 재시작 보존 계약·동시 실행 거부·저장 실패 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\views\view-plan-store-factory.ts` | 기존 governance persistence 설정에 따른 저장소 구성 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\project-foundation\view-templates.ts` | 팀별 재사용 가능한 #2/#3 View 템플릿 정의 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\project-foundation\operating-foundation.ts` | 공통 View 조회·ID 매핑 재사용; 기존 #2 전용 CLI 경계 유지 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\project-foundation\operating-foundation.test.ts` | #2의 기존 계획·생성·재조회 동작 회귀 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\identity\principal.ts` | Admin 전용 View 쓰기 capability 추가; Viewer/Member의 기존 권한 유지 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\identity\principal.test.ts` | 역할 기본 권한과 override 축소 규칙 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\policy\write-policy.ts` | View 작업을 Project별 capability·기존 write gate에 연결 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\core\policy\write-policy.test.ts` | cross-team/cross-Project와 쓰기 권한 거부 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\mcp\project-view-tools.ts` | 네 가지 View 도구 등록 및 입력 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\mcp\project-view-tools.test.ts` | MCP 입력·Shared Core 호출·권한 경계 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\mcp\build-server.ts` | 공통 View 도구 구성 연결 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\http\rest-api.ts` | 인증된 View REST 경로를 같은 Core에 연결 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\http\rest-api.test.ts` | OAuth scope·ACL·REST/Core 동작 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\http\openapi.ts` | 새 경로·계획 승인·지원 제한의 API 계약 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\src\http\openapi.test.ts` | OpenAPI 경로·계약 검증 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\docs\PERMISSIONS.md` | View 권한·기존 팀 호환 설명 |
| `D:\dev\03_PersonalProjects\gyuniverse-github-projects-mcp\docs\MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md` | 구현·테스트·제한·PR·롤백 기록 갱신 |

### 기존 기능에 미칠 수 있는 영향과 검증 범위

- MCP 도구 목록과 REST/OpenAPI에 View 기능이 추가된다. Admin 기본 capability가 늘어나므로 기존에 명시적으로 축소한 capability와 팀별 교집합이 확장되지 않는지 검증한다.
- Project #2 기존 CLI 동작을 보존하며, GitHub item/Issue/필드 옵션/Status 변경 API를 View 작업에서 호출하지 않는지 검증한다.
- Upstash 사용 시 계획·동시 실행 상태만 별도 namespace에 기록하도록 구현한다. 기존 OAuth replay·bulk·감사 namespace와 DB 구조는 수정하지 않는다.
- 제안 당시에는 CI·별도 Draft PR까지 포함했지만, 최신 제한 승인은 위 파일의 로컬 코드 작성·합성 테스트·타입 검사·빌드까지만 허용한다. Push/새 PR/배포, 실제 Project View·DB 변경, 로그인/실제 토큰 발급, 기존 사용자·팀 권한 변경과 관리자 #20 포팅은 포함하지 않는다.

## 2단계 로컬 실행 결과

위 제안에 있던 CI/별도 Draft PR 생성은 **최신 제한 승인에서 제외**되었다. 현재 작업 범위는 로컬 코드·합성 검증까지이며, 브랜치는 `codex/project-view-api`, 시작 HEAD는 `34624bd9dbb5f455004b8a7b038e3894f0e027fb`다. 커밋·Push·새 PR·CI·배포를 하지 않았다. 기존 원격 PR #25의 통과 기록을 이 코드의 CI 통과로 사용하지 않는다.

### 구현한 동작

- 공통 GraphQL View/필드 페이지네이션과 완전성 검증, Node ID → 정수 REST field ID 매핑을 구현했다. 기존 Project #2 foundation은 같은 조회·매핑을 재사용하며 정확한 대상·Status·Priority·기존 View 보존 경계를 유지한다.
- `operating-v1`, `wbs-v1` 템플릿을 read → persisted preview → explicit apply → re-read/verify → audit로 연결했다. 저장 계획은 digest/15분 TTL/target/kind를 검증한다.
- MCP 네 도구와 REST/OpenAPI가 같은 Core 서비스를 호출한다. 삭제는 노출하지 않는다. Viewer/Member, read-only OAuth scope, Project별 capability 축소, 타팀/타Project, GitHub 쓰기 권한 철회를 거부한다.
- Project별 잠금은 같은 계획과 다른 계획의 동시 적용을 막는다. 부분 실패·응답 유실·감사 실패·최종 저장 실패를 구분하며 같은 계획을 재호출해 mutation을 반복하지 않는다.
- 실제 사용자 grant나 scope는 변경하지 않았다. Admin의 새 capability는 코드 정의만 추가했고 기존 explicit 권한 축소와 팀 교집합은 유지했다.

### 최종 검사와 미실행 범위

설치된 동일 TypeScript/Node 실행 파일을 직접 사용했다. pnpm 실행기의 registry 조회나 실행 권한 확대를 요구하지 않는다. 다음 명령은 package script의 타입 검사·빌드·테스트와 같은 로컬 프로그램을 실행한다.

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.vercel.json
node node_modules/typescript/bin/tsc
node --test "dist/**/*.test.js"
```

- 마지막 실행 코드 수정 뒤 일반/Vercel 타입 검사와 빌드: 통과.
- 전체 테스트: **341개 실행, 340개 통과, 1개 실패, 취소/skip/todo 0개**. 추가한 34개 테스트는 모두 통과했다. 전체 suite를 통과로 표시하지 않는다.
- 실패: 기존 `src/http/node-server.test.ts`의 실제 loopback 소켓 테스트. `fetch`가 `connect EACCES 127.0.0.1`로 거부된다. 이 파일이나 `node-server.ts`는 수정하지 않았다.
- 프로젝트를 import하지 않는 inline `node:http` 임시 서버 → `127.0.0.1` fetch → close 최소 재현도 동일 실행환경에서 `EACCES`를 반환했다. 따라서 환경 차단 근거는 프로젝트 코드와 독립적으로 확인했다. 방화벽/권한/네트워크 설정은 변경하지 않았다.
- 합성 검증: 역할·Project별 두 capability 교집합/다른 Project 차단, read-only OAuth, 계획 변조/digest/만료/최종 읽기 중 만료/stale state, 동일/다른 계획 동시 적용, 중간 실패·응답 유실·감사/최종 저장 실패 후 무중복 재실행, Project #2 foundation 회귀.
- Redis는 계약 double로만 검증했다. 실제 Redis/Lua, 실제 GitHub API, Supabase, 브라우저/OAuth 로그인, 실제 토큰 발급, 외부 CI/Gitleaks/Preview 검증은 실행하지 않았다. REST 인증 테스트의 bearer는 메모리 안의 합성 서명 fixture이며 로그인/토큰 발급 endpoint를 호출하지 않는다.

### 제한과 다음 단계

- `Parent issue` 열과 Roadmap 날짜 설정은 명시적인 수동/미검증 항목이다. 생성 API의 그룹·정렬은 공식 REST 계약에 맞췄으나 실제 Project에서의 시각 결과는 미검증이다. [REST View 문서](https://docs.github.com/en/rest/projects/views), [GraphQL View 문서](https://docs.github.com/en/graphql/reference/projects#updateprojectv2view).
- 새 템플릿 생성은 조직 소유 Project만 지원한다. REST 필드가 100개로 꽉 차면 Link header를 읽지 못하는 기존 client 제약 때문에 생성 계획을 차단한다.
- 결과가 불확실한 mutation/작업자에는 Project 잠금을 자동 해제하지 않는다. 공유 Redis 연결·소유권·감사 및 실제 상태를 확인한 별도 운영 승인 절차가 필요하다. View upstream 요청의 10초 응답 제한이 원격 요청 자체의 취소를 보장하지는 않으므로 잠금을 유지한다.
- 로컬 memory는 단일 프로세스용이다. Preview/Production 배포에서 공유 Upstash가 없으면 새 View 계획을 차단한다. 기존 MCP 초기화/다른 기능은 View store를 지연 생성하므로 보존한다.
- 이번 승인 범위의 안전한 로컬 작업은 완료했다. 외부 게시·CI·Preview 실측은 별도 승인 전 대기한다. 관리자 PR #20 포팅/인증 강화/팀·Project UI는 별도 파일 범위 승인 전 미착수다.
- 사용자 브라우저는 사용하지 않았다. 기존 사용자 원본 `docs/Gyuniverse_MCP_Codex_Integration_Plan.md`는 기존 untracked 상태로 두며 이번 변경 파일에 포함하지 않는다.

### 최종 파일 대조와 작업 트리

`view-plan-store-factory.ts`와 해당 테스트의 마지막 수정까지 포함해 일반/Vercel 타입 검사·빌드·전체 테스트를 다시 실행했다. 최종 수치는 위의 **341 실행 / 340 통과 / 1 EACCES 실패 / skip 0**이며 그 뒤 실행 코드는 변경하지 않았다. 이후 변경은 이 결과 문서 기록뿐이다.

승인 표의 절대 경로 25개를 Git의 tracked diff와 신규 파일 목록에 대조했다. **기존 수정 13개 + 신규 12개 = 25개**, 승인 범위 밖 0개, 승인 목록 중 누락 0개다. 사용자가 추가한 원본 계획서 1개는 별도 기존 untracked 파일로 제외했다. `git diff --check`도 통과했다. HEAD와 기존 통합 브랜치는 모두 `34624bd9dbb5f455004b8a7b038e3894f0e027fb`이며 2단계 변경은 미커밋 상태다.

`git status --short`:

```text
 M docs/MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md
 M docs/PERMISSIONS.md
 M src/core/identity/principal.test.ts
 M src/core/identity/principal.ts
 M src/core/policy/write-policy.test.ts
 M src/core/policy/write-policy.ts
 M src/http/openapi.test.ts
 M src/http/openapi.ts
 M src/http/rest-api.test.ts
 M src/http/rest-api.ts
 M src/mcp/build-server.ts
 M src/project-foundation/operating-foundation.test.ts
 M src/project-foundation/operating-foundation.ts
?? docs/Gyuniverse_MCP_Codex_Integration_Plan.md
?? src/core/views/
?? src/github/project-views.test.ts
?? src/github/project-views.ts
?? src/mcp/project-view-tools.test.ts
?? src/mcp/project-view-tools.ts
?? src/project-foundation/view-templates.ts
```

`git diff --name-only` (tracked 파일만 출력):

```text
docs/MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md
docs/PERMISSIONS.md
src/core/identity/principal.test.ts
src/core/identity/principal.ts
src/core/policy/write-policy.test.ts
src/core/policy/write-policy.ts
src/http/openapi.test.ts
src/http/openapi.ts
src/http/rest-api.test.ts
src/http/rest-api.ts
src/mcp/build-server.ts
src/project-foundation/operating-foundation.test.ts
src/project-foundation/operating-foundation.ts
```

신규 구현 파일 (`git ls-files --others --exclude-standard`에서 기존 사용자 원본 계획서만 제외):

```text
src/core/views/project-view-service.test.ts
src/core/views/project-view-service.ts
src/core/views/view-plan-store-factory.ts
src/core/views/view-plan-store.test.ts
src/core/views/view-plan-store.ts
src/core/views/view-plan.test.ts
src/core/views/view-plan.ts
src/github/project-views.test.ts
src/github/project-views.ts
src/mcp/project-view-tools.test.ts
src/mcp/project-view-tools.ts
src/project-foundation/view-templates.ts
```
