# MCP Views · 관리자 콘솔 통합 진행 기록

기준일: 2026-10-23 (Asia/Seoul)

**최신 상태:** 공통 View API와 열 순서 수정은 [PR #26](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/pull/26)으로 `integration/mcp-views-admin`에 병합됐다. 병합 SHA는 `86d62b0a1d00076d61cb0e7daad3be0b1daf87a3`다. 관리자 View 화면 후속 변경은 `codex/admin-view-integration`에 미커밋 상태로 보존하며, 아래 **3단계**가 최신 검증 기록이다. 앞선 1·2단계의 미커밋/미Push 기록은 당시 실행 이력이며 현재 원격 상태를 뜻하지 않는다. 관리자 PR #20 전체 통합과 실제 연동 검증은 완료되지 않았다.

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
| 공통 Project View API | 통합 브랜치 병합 완료 | #26, 일반/Vercel 타입 검사·빌드·347개 테스트·원격 CI/Gitleaks 통과. 실제 API/화면 미검증 |
| 관리자 #20 안전 포팅 | 전체 관리 기능 미반영 | 사용자·키·관리형 OAuth/DB 기능과 관리자 세션 강화는 별도 후속 범위 |
| 관리자 View 화면 | 3단계 로컬 구현·합성 검증 | 허용 Project → 조회 → 계획 비교 → 명시적 적용 → 재조회/오류 표시. 미커밋·미Push |
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

## 3단계: 관리자 View 화면 연결 — 로컬 검증, 게시 전 대기

### 병합된 기반선과 이번 범위

- #26의 최종 head: `b2806ca6953bd48cd33dffca94f47380f91957d0`; 검증된 열 순서 수정 6개 파일만 별도 커밋했다.
- 원격 CI와 전체 이력 Gitleaks, Vercel 검사가 성공하고 충돌·차단 리뷰·미해결 리뷰 스레드가 없는 상태에서 일반 PR 병합했다. 대상 브랜치는 추가 보호 규칙이 없는 것으로 확인했고, 보호 규칙 우회는 사용하지 않았다.
- [CI](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/actions/runs/39968269846), [Gitleaks](https://github.com/4hglee-ops/gyuniverse-github-projects-mcp/actions/runs/39968269900)는 위 최종 head의 결과다. **미커밋인 이번 3단계 코드의 원격 검사 결과가 아니다.** Vercel 검사 성공은 실제 인증·View 화면 검증 완료를 뜻하지 않는다.
- 후속 브랜치: `codex/admin-view-integration`; 시작 HEAD는 병합 SHA `86d62b0a1d00076d61cb0e7daad3be0b1daf87a3`다. `main`과 `develop`에는 병합하지 않았다.
- 이번 후속 구현 승인은 아래 12개 파일의 로컬 코드·합성 검증·문서 정리까지다. commit/push/새 PR/병합 전에 결과를 보고하고 멈춘다. 실제 서비스·사용자·권한·DB·자격증명은 변경하지 않는다.
- 클라우드 체크아웃과 상위 작업공간에 `AGENTS.md`/`.agents/skills`는 없었다. `CONTRIBUTING.md`의 검증 및 보안 불변식을 적용했다.

| 파일 | 변경 내용 |
| --- | --- |
| `src/core/views/project-view-catalog.ts` | 인증된 사용자/팀의 read capability와 서버 owner/Project allowlist 교집합의 ID만 조회. Project 선택 정보와 참고용 쓰기 가능 여부 반환 |
| `src/core/views/project-view-catalog.test.ts` | 다른 Project/owner·읽기 권한 축소·쓰기 scope/role/capability·응답 위조/누락·상한·오류 비노출 검증 |
| `src/http/rest-api.ts` | 기존 OAuth 및 팀 ACL 처리 뒤 GET `/api/v1/project/catalog` 연결. View 쓰기는 기존 Core 경계 유지 |
| `src/http/rest-api.test.ts` | 실제 브라우저 컨트롤러 → REST → Core 합성 연결, 응답 유실 후 재조회/새 계획, 권한 철회·ACL 오류 차단 검증 |
| `src/http/openapi.ts` | 인증된 Project 선택 API와 참고용 `canWriteViews` 계약 추가 |
| `src/http/openapi.test.ts` | read scope와 적용 시 권한 재검증 설명 확인 |
| `public/admin/views.html` | 허용 Project 선택, 현재 View/열 순서, 템플릿 및 이름/필터/레이아웃 수정 계획, 승인, 결과 화면 |
| `public/admin/views.js` | 기존 bearer를 메모리에서만 사용. 입력/대상 변경 시 계획 무효화, 전송 전 계획 소진, 재조회 및 불확실 결과 표시 |
| `public/admin/views.css` | 외부 스타일과 반응형 화면·키보드 포커스 표시 |
| `src/admin/view-console.test.ts` | 컨트롤러·DOM 합성 흐름, 명시적 승인, 중복/만료/부분 실패/재조회 실패/연결 교체·해제, 자격증명 비저장, CSP 계약 검증 |
| `vercel.json` | `/admin/*`에 외부 self 스크립트/스타일만 허용하는 CSP 및 no-store·no-referrer 등 헤더 정의. 배포는 미실행 |
| `docs/MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md` | 현재 상태·이력·#20 비교·검증과 미검증 범위 기록 |

### 화면 동작과 권한 경계

진입 파일은 `/admin/views.html`이다. **기존에 발급된 개인 OAuth 액세스 토큰을 입력하는 연결 화면**이며 #20의 관리자 비밀번호 로그인 화면은 아니다. 이 화면은 OAuth 로그인·등록·토큰 발급·갱신을 구현하거나 호출하지 않는다. 현재 ENV identity registry/추가 사용자 및 legacy read-only 팀 토큰은 기존 REST 인증 경로를 그대로 사용한다. 토큰 입력란은 연결 직전에 비우고, 원문은 브라우저 메모리에만 둔다. localStorage/sessionStorage/cookie/로그/URL에 저장하지 않으며 연결 해제·페이지 이탈 시 메모리와 표시 데이터를 지운다. 연결 해제는 원격 OAuth 토큰 폐기를 의미하지 않는다.

1. 인증 확인과 catalog를 읽어 **허용된 Project만** 표시한다. owner 전체를 나열하지 않고 이미 허용된 Node ID를 해석한다. 유실·위조·중복 응답은 실패하며, 접근 불가/다른 owner의 Project는 제외한다.
2. 현재 View·필터·그룹·정렬·설정된 표시 열 순서를 조회한다. 템플릿 계획 또는 선택한 View의 이름/필터/레이아웃 수정 계획을 만든다. 표시 열의 순서는 조회로 보여주며, 직접 열을 재배치하는 UI는 이번 범위에 없다.
3. Project/계획/수동 항목/digest/만료를 표시한다. 대상이나 수정 입력을 바꾸면 이전 계획과 승인을 무효화한다. 별도 승인 체크 후 정확한 planId/digest/target과 `approved=true`로 적용한다.
4. `canWriteViews`는 화면 안내용이다. 실제 적용은 매 요청의 OAuth scope·현재 identity·팀 ACL·서버 write gate/allowlist·Admin 및 Project별 두 쓰기 capability·GitHub 권한을 다시 통과해야 한다. DB enforce 오류 시 legacy로 되돌아가지 않는다.
5. 적용 전 UI 계획을 소진해 중복 클릭·네트워크 오류·부분 실패 때 같은 계획을 자동 재전송하지 않는다. 성공/partial/applying 결과와 수동 항목을 표시하고 현재 View를 재조회한다. 재조회 실패 시 적용 결과는 남기고 현재 데이터는 비운다. 결과 유실 시 직접 재조회한 뒤 새 계획을 만들어야 하며, 미확정 mutation의 Core 잠금은 그대로 유지된다.

### PR #20 포함/미포함 비교 및 충돌

검토한 #20 head는 `ff1d03b082c3683d16682cd4dc22346915fa804c`다. #20의 변경 12개 파일 중 새 관리자 파일 6개(`src/admin/console.ts`, `managed-auth.ts`, `console.test.ts`, `public/admin/index.html`, 004 migration, M13 문서)는 기반선에 없었다. 기존 파일의 관리형 OAuth/라우팅 변경도 반영되지 않았다. 이번에는 이를 통째로 병합하거나 중복 복사하지 않았다.

| 기능 | PR #20 | 이번 후속 구현 |
| --- | --- | --- |
| 관리자 로그인/세션/로그아웃 | 공유 관리자 비밀번호, 서명 cookie, Origin/CSRF, Redis 로그인 제한 | **미포함**. 기존 OAuth bearer 연결/로컬 연결 해제만 제공 |
| 사용자 등록/목록/역할·Project·활성 상태 관리 | Supabase `mcp_admin_users`와 관리 RPC | **미포함**. 권한 변경 API 없음 |
| 접근 키 발급/목록/폐기·최초 1회 원문 표시 | 해시 저장과 관리 API/UI | **미포함**. 새 키·토큰 생성/폐기 없음 |
| 관리형 OAuth 접근 코드·토큰 연결/DB 폐기 검사 | `managed-auth.ts`와 OAuth/remote-MCP/REST 변경 | **미포함**. 기존 ENV/추가 identity·legacy 인증 경로 보존 |
| 관리자 감사 목록 | `mcp_admin_audit`/overview | **미포함**. 기존 Core View 변경 감사만 수행하고 적용 결과를 표시 |
| 허용 Project 선택·View API 계획/승인/결과 | 미구현 | **이번에 구현**. 현재 권한 교집합으로 선택·적용 |
| 브라우저 CSP | 인라인 script 허용, style은 self여서 인라인 CSS와 충돌 | 외부 JS/CSS, self만 허용. 헤더의 실제 브라우저 동작은 미검증 |
| DB schema/RPC | `004_admin_console_credentials.sql` 필요 | **미포함·미적용**. 기존 M12 enforce 모드를 선택한 환경은 기존 ACL DB 의존성 유지 |

따라서 **View 화면 연결만 완료했으며 관리자 UI 전체 통합은 완료하지 않았다.** #20의 `/api/admin/v1/*` 관리 API와 `/admin/index.html`은 이 브랜치에 없다. 후속 포팅 때 `rest-api.ts`의 관리형 principal 처리와 이번 catalog/View 연결, `vercel.json`의 같은 `/admin/*` CSP 규칙을 함께 검토해야 한다. 현재 CSP를 그대로 적용하면 #20의 인라인 script/style이 차단되므로 그 UI도 외부 자산으로 분리해야 한다.

#20의 세션에는 Project 작업자의 subject/capability가 없다. 이를 그대로 Admin Project 권한으로 승격해서는 안 된다. 관리형 사용자 기록과 M12 팀 grant도 자동 연결된다고 가정할 수 없다. 서버 측 세션 폐기, 키 원문 DOM 정리(기존 #20 로그아웃은 JS 변수만 비움), 개별 작업자 감사 등은 전체 관리자 포팅 때 별도 검증이 필요하다.

### 검증 결과와 남은 위험

Linux/Node `v24.19.0`, 기존 고정 의존성으로 다음을 수행했다. 테스트는 메모리 데이터·서명 fixture·가짜 GraphQL/REST/DOM 응답만 사용했으며 실제 로그인·토큰 endpoint나 DB·GitHub를 호출하지 않는다.

- 일반 타입 검사, Vercel 타입 검사, 빌드, `node --check public/admin/views.js`, `git diff --check`: 통과.
- 전체 **362개 통과 / 실패·취소·skip·todo 0개**. 병합된 347개에 신규 catalog/클라이언트 테스트 15개가 추가됐다. 기존 REST/OpenAPI 테스트도 확장했다.
- 기존 실제 loopback 소켓, Project #2 foundation, MCP·REST, View digest/TTL/잠금·부분 실패/응답 유실 회귀를 보존했다.
- 단위 테스트의 DOM은 double이다. 별도의 실제 Chromium + 로컬 모의 API 검증은 아래 기록 참조. 실제 GitHub API/시각 결과, 실제 Redis/Lua, 보호된 Preview 및 OAuth 로그인·갱신/폐기, 전체 접근성 검증은 미실행이다. #26의 CI 통과를 이 변경의 CI 통과로 표시하지 않는다.
- `xdeygntepdjhwdiropwr`는 이전 확인에서 INACTIVE였다. #20 PR 본문은 004 미적용, 브랜치 문서는 적용 완료라 충돌한다. 이번에는 DB에 접속·재개·migration을 하지 않았고 실제 적용 여부는 미확인이다. 현재 환경 상태를 단정하지 않는다.
- Preview/Production의 View 계획에는 기존 Core가 요구하는 공유 Upstash 저장소가 필요하다. 실제 배포 설정/계획·감사 내구성은 확인하지 않았다. ACL enforce 모드라면 기존 M12 전용 DB가 정상이어야 하며 오류 시 차단된다.
- 이번 결과는 12개 파일의 미커밋 로컬 구현이다. **commit/push/새 PR/병합·수동 배포는 하지 않았다.** 다음 최소 단계는 변경 검토 후 게시 범위를 확정하는 것이다. 전체 관리자 #20 포팅과 실제 연동·배포는 별도 남은 작업이다.

### 실제 로컬 브라우저 검증

Chromium `154.0.8037.57`와 환경에 설치된 Playwright Core로 **10개 시나리오 그룹이 통과**했다. `public/admin/views.html/js/css` 실제 파일을 loopback 서버에서 제공하고 `vercel.json`의 헤더 값을 그대로 붙였다. API는 메모리 모의 서버이며, bearer는 테스트 프로세스에서 고정된 합성 signing 값으로 만든 fixture다. `.env` 로딩, 실제 OAuth endpoint, 실제 GitHub/DB/Redis 연결은 하지 않았다.

| 실제 브라우저 확인 | 결과 |
| --- | --- |
| 허용 Project 선택 → 조회 → 수정 계획 → 승인 체크 → 적용 → 재조회 → 연결 해제 | 통과. 승인 전 쓰기 0회, 적용 후 변경 1회, 토큰 입력란·연결 해제 후 표시 데이터 비움 |
| 미허용 Project를 선택 요소에 삽입하거나 계획 생성 후 입력 변경 | 차단/계획 무효화, 쓰기 0회 |
| 템플릿 계획·명시적 적용·수동 Roadmap 항목 | 통과 |
| 적용 버튼 이중 클릭 | 적용 요청 1회, 합성 변경 1회 |
| 응답 헤더 전 연결 단절 | Chromium이 같은 POST를 전송 계층에서 재전송하는 것을 관찰. HTTP 적용 요청 2회, 동일 계획의 합성 변경 1회 |
| 적용 후 응답 본문 유실 | 오류와 계획 소진 확인. 직접 재조회·새 skip-compatible 계획 후에도 합성 변경은 1회 유지 |
| stale/partial 결과 | 자동 재적용 없음. 오류/부분 결과 표시 및 적용 버튼 비활성화 |
| 적용 성공 뒤 재조회 실패 | 성공 결과는 유지하고 현재 데이터는 비움. 명시적 재조회로 복구 |
| 조회 전용 사용자가 DOM의 적용 버튼을 강제로 활성화 | 클라이언트 권한 검사로 차단, 적용 요청 0회. 실제 서버 권한 경계는 별도 REST/Core 합성 테스트가 검증 |
| 390px/360px 모바일 폭과 CSP | 단일 열, 가로 overflow 없음, 한국어 표시 육안 확인. 외부 self JS/CSS 로드, 인라인 script/style은 각각 CSP 차단 |

앱 페이지의 외부 주소 요청 시도 0건, 미처리 page error 0건이다. 브라우저 console에는 의도적으로 주입한 본문 유실/409/503/CSP 차단 오류만 있었다. localStorage/sessionStorage/cookie의 토큰 저장은 없었다. 최초 실행의 주소 차단 규칙이 loopback까지 차단한 문제는 테스트 도구 설정에서 수정했으며 **앱 실행 코드는 변경하지 않았다**. 헤더 전 단절 때 발생한 native POST 재전송은 UI의 자동 재시도와 구분한다. 전송 횟수 1회만을 안전 조건으로 삼을 수 없으며, 기존 Core의 plan claim/완료 결과 재사용/불확실 잠금 유지가 계속 필요하다.

증거는 클라우드 `/tmp/gyuniverse-admin-browser-validation/`에 보존했다: 재실행 가능한 `browser-check.mjs`, `report.json`, `browser-run.log`, desktop/mobile/partial PNG. 브라우저 API는 모의 서버이므로 실제 API 권한·GitHub mutation·Redis/Lua가 검증됐다는 의미가 아니다. 로컬 헤더 검증은 Vercel edge의 실제 헤더 적용이나 보호된 Preview HTTPS 인증 검증을 대체하지 않는다. 실행 코드가 그대로이므로 기존 **362/362** 결과가 유지되는 동일 코드 스냅샷이다. 이번 단계의 저장소 수정은 이 문서뿐이다.

## 관리자 PR #20 포팅 계획 — 전체 36개 파일의 미완료 계획

아래 표는 최초 설계의 전체 범위다. 이후 부분 구현 상태는 이 문서 마지막의 신원·세션 연결 기록을 따른다. 표에 경로가 있다는 이유로 해당 기능이 구현되거나 실제 적용됐다고 간주하지 않는다.

이 계획은 현재 View 화면을 전체 관리자 콘솔과 연결하기 위한 검토 범위다. 현재 승인된 12개 파일 밖의 코드 포팅, SQL 작성/적용, 설정·사용자·grant 변경은 이번에 수행하지 않았다. 원격 #20을 통째로 병합하지 않고 아래 단계별 diff와 합성 증거를 먼저 만든다. 실제 파일 수정·게시 범위는 이 계획 검토 뒤 별도로 확정한다.

### 작업자 신원과 세션 설계

1. **비밀번호와 작업자 권한을 분리한다.** #20의 공유 관리자 비밀번호는 Preview 진입을 제한하는 추가 확인일 뿐이다. 로그인 요청 본문의 `subject/role/projectIds`나 기존 `{exp, nonce}` cookie를 Project 권한으로 사용하지 않는다. 먼저 기존 OAuth bearer의 서명·audience·만료·scope를 검증하고, 그 `sub`로 최신 ENV/추가 identity 또는 credentialId에 묶인 관리형 identity를 조회한다. legacy 공용 팀 토큰은 현재 viewer 범위를 유지하며 관리자로 승격하지 않는다.
2. **불투명하고 서버에서 폐기 가능한 세션을 제안한다.** 서버 저장소에 세션 ID의 해시, 검증된 subject, identity 출처/버전 또는 관리형 credentialId, 원본 OAuth scope/만료, CSRF 바인딩, 자체 만료/폐기 상태만 둔다. bearer·access code·비밀번호·키 원문은 저장하지 않는다. cookie는 `__Host-` 규칙에 맞춰 Secure/HttpOnly/SameSite=Strict/Path=/, Domain 없음으로 제한한다. 기존 bearer REST는 cookie를 인증으로 받지 않으며 cookie 사용은 별도 admin BFF 경로에서만 허용한다. 세션 만료는 원본 OAuth 만료와 짧은 관리자 TTL 중 이른 시각으로 제한하고, 재인증 없이 cookie만 연장하지 않는다.
3. **매 요청의 권한은 다시 계산한다.** 세션 폐기/만료 → 원본 identity/credential 활성 상태 → 현재 역할·명시적 capability → M12 현재 팀/리소스 grant → 서버 owner/Project allowlist → scope·write gate 순으로 검증한다. 권한 교집합만 사용하고 DB/Redis 장애는 차단한다. 저장된 관리자 role/Project 배열을 현재 권한의 대체값으로 사용하지 않는다. 로그아웃은 서버 세션도 폐기하고 모든 화면·일회성 키 DOM을 비운다.
4. **ENV 코드 교체와 기존 bearer의 관계를 명시한다.** 현재 bearer에는 ENV 발급 자격증명 버전이 없다. 따라서 코드 문자열 교체만으로 이미 발급한 bearer의 즉시 폐기를 보장한다고 말할 수 없다. 권장안은 신규 개인 토큰에 서버 HMAC 기반 `identityVersion`을 단계적으로 넣고 관리자 세션은 버전이 확인된 개인 proof만 받는 것이다. HMAC은 access code의 단순 공개 해시가 아니며, raw access code나 그 추측 검증용 해시를 JWT에 노출하지 않는다. 기존 MCP/REST bearer 호환은 유지하고, 버전 없는 토큰을 관리자 권한으로 조용히 승격하지 않는다. 실제 재인증/추가 토큰 발급은 별도 승인 후 검증할 부분이다.
5. **Project Admin과 계정 관리자를 구분한다.** `project.view.write`나 역할 이름 `admin`만으로 사용자 생성·키 발급 권한을 주지 않는다. 검증된 subject별 별도의 관리 capability/범위/역할 상한 정책을 제안하며, 신뢰된 관리 authority가 없으면 기본 거부한다. 정책 설정을 코드로 준비하는 것과 실제 운영자 등록·권한 부여는 별개다. 다른 팀 또는 자신이 관리할 수 없는 Project가 섞인 사용자/키 기록은 overview와 변경 양쪽에서 차단한다. 부분적으로만 보이는 사용자의 전체 Project 배열을 덮어쓰지 않는다.
6. **장시간 apply 중 권한 회수도 별도 다룬다.** 현재 Core는 요청 시점의 principal snapshot을 사용한다. 포팅 때 각 mutation 직전에 원본 proof 만료와 최신 identity/ACL을 다시 확인하는 비동기 권한 검증 경로를 MCP/REST/admin BFF에 공통으로 연결한다. 첫 변경 뒤 권한을 회수하면 후속 mutation이 멈추는 테스트를 추가한다. Project 잠금·15분 계획 TTL·digest·결과 검증은 그대로 유지한다.

### 파일별 순수 코드 포팅 범위

아래 파일은 **향후 생성/수정 제안**이며 이번 브라우저 검증에서 변경하지 않았다. 테스트 파일도 개별 경로로 명시한다.

| 단계 | 파일 | 구체 작업과 합성 검증 |
| --- | --- | --- |
| A 인증 | `src/http/operator-auth.ts` (신규) | bearer 검증, ENV/관리형 identity 출처, 현재 팀 ACL·scope·만료를 묶은 공통 verified operator resolver. 신원 주장은 요청 본문에서 받지 않음 |
| A 인증 | `src/http/operator-auth.test.ts` (신규) | 기존/추가 ENV·legacy viewer 호환, 관리형 credential 필수, 위조 sub/버전/권한 축소·저장소 오류 차단 |
| A 인증 | `src/core/identity/oauth-identity-registry.ts` | 원문 비노출 identity version 도출 계약과 현재 principal 조회. 권한 override는 계속 축소만 허용 |
| A 인증 | `src/core/identity/oauth-identity-registry.test.ts` | 코드 교체/사용자 제거/역할·Project 축소 및 기존 추가 사용자 호환 |
| A 세션 | `src/admin/session-store.ts` (신규) | memory double/공유 저장소 계약, 별도 namespace, 짧은 TTL·원자적 폐기·로그인 제한. 배포에서 memory fallback 금지 |
| A 세션 | `src/admin/session-store.test.ts` (신규) | 재구성 후 유지·동시성·폐기·TTL·저장 실패. 실제 Redis/Lua는 별도 gate |
| A 정책 | `src/admin/admin-policy.ts` (신규) | 별도 관리 capability와 team/Project/부여 role 상한. 기본 거부, 클라이언트 ID로 권한 생성 금지 |
| A 정책 | `src/admin/admin-policy.test.ts` (신규) | Project Admin의 계정관리 승격 거부, 타팀 기록 차단, 범위 확장·역할 상향 거부 |
| B 관리 | `src/admin/console.ts` (#20 선택 포팅) | 기존 세션 handler를 verified operator·공유 세션 store·정책에 연결. Origin/CSRF, 서버 logout, scoped overview 및 요청 크기/오류 비노출 |
| B 관리 | `src/admin/console.test.ts` (#20 선택 포팅) | 비밀번호만으로 로그인 거부, 세션/CSRF/권한 회수, scoped 사용자·키·감사와 저장 실패, 일회성 응답 계약 |
| B 관리 | `src/admin/managed-auth.ts` (#20 선택 포팅) | server-only 관리형 DB adapter, 엄격한 응답 검증·폐기/활성 검사, 새 관리 권한 자동 부여 금지 |
| B 관리 | `src/admin/managed-auth.test.ts` (신규) | credentialId/subject 결합, 잘못된 role/capability·DB 오류 거부, legacy 경로 보존 |
| B View | `src/admin/view-adapter.ts` (신규) | cookie+CSRF admin BFF를 같은 catalog/ProjectViewService에 연결. 새 bearer를 만들어 REST로 우회 호출하지 않음 |
| B View | `src/admin/view-adapter.test.ts` (신규) | 동일 identity/scope/grant에 MCP/REST/BFF 결과가 같고, 잘못된 scope·다른 Project가 거부되는 계약 |
| B 라우팅 | `src/http/router.ts` | `/api/admin/v1/*`를 명시적 opt-in Preview gate 아래 연결. 기본/Production은 닫힘 |
| B 라우팅 | `src/http/router.test.ts` | flag·환경·method·인증 경계와 기존 MCP/REST 경로 보존 |
| B 라우팅 | `src/http/remote-mcp.ts` | 공통 operator resolver와 관리형 폐기 검사 연결. 기존 transport/진단 보존 |
| B 라우팅 | `src/http/remote-mcp.test.ts` | 기존 OAuth/legacy JSON 흐름과 폐기·권한 축소·오류 거부 |
| B 라우팅 | `src/http/rest-api.ts` | 같은 resolver로 catalog/View/기존 REST의 최신 권한 검증 유지 |
| B 라우팅 | `src/http/rest-api.test.ts` | 모든 기존 endpoint 호환, 세션이 public bearer API 권한을 대체하지 않는지 검증 |
| B OAuth | `src/oauth/stateless.ts` | credentialId/identityVersion 타입·구조 검증. 암호 검증과 현재 권한 검증의 책임 분리 |
| B OAuth | `src/oauth/individual-identity.test.ts` | 구형 개인/추가 사용자·legacy token 호환과 신규 개인 version/관리형 binding 검증 |
| B OAuth | `src/oauth/endpoints.ts` | #20 관리형 코드/refresh 경로를 선택 포팅하고 교환 전 현재 credential/version 확인. 기존 PKCE/DCR 협상 보존 |
| B OAuth | `src/oauth/endpoints.test.ts` | 모의 adapter로 폐기·만료·버전 불일치 거부. 실제 토큰 endpoint 호출은 하지 않음 |
| B Core | `src/core/views/project-view-service.ts` | 각 mutation 직전 비동기 최신 권한 확인 hook. 계획/잠금/검증/감사 불변식 유지 |
| B Core | `src/core/views/project-view-service.test.ts` | 첫 mutation 뒤 identity/ACL 회수·원본 proof 만료 시 후속 변경 0회 및 부분 결과/재시도 방지 |
| B Core | `src/mcp/build-server.ts` | 원격 operator의 재검증 hook을 Core에 전달. 로컬/기존 도구 초기화 호환 유지 |
| C 화면 | `public/admin/index.html` (#20 선택 포팅) | 사용자·역할·키·감사 화면과 View 화면 링크, 검증된 현재 작업자/범위 표시. 인라인 JS/CSS 제거 |
| C 화면 | `public/admin/console.js` (신규) | scoped overview·명시적 관리 변경, 서버 logout, 일회성 키 표시/숨김/만료/401/pagehide 시 DOM 비움. 자동 발급 재시도 금지 |
| C 화면 | `public/admin/console.css` (신규) | 외부 스타일, 모바일·키보드 동작. #20 인라인 자산과 현재 CSP 충돌 해소 |
| C 화면 | `public/admin/views.html` | 관리자 화면으로의 이동과 세션 연결 상태 안내. 현재 bearer 진입 경로 유지 |
| C 화면 | `public/admin/views.js` | 고정된 same-origin admin BFF session transport+CSRF 추가. 기존 bearer는 credentials=omit 유지, 실패 시 몰래 다른 인증으로 fallback하지 않음 |
| C 화면 | `src/admin/view-console.test.ts` | bearer/session 동등성, 인증 회수·일회성 DOM 정리, 실패/중복·권한 축소 회귀 |
| C 헤더 | `vercel.json` | admin rewrite와 통일된 self CSP. 기존 View/API rewrite 보존, 수동 배포 없음 |
| C 기록 | `docs/M13_ADMIN_CONSOLE_PREVIEW.md` (#20 선택 포팅) | 실제와 다른 004 적용 완료 문구 교정, 미검증/활성화 gate/rollback 명시 |
| C 기록 | `docs/MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md` | 단계별 파일/검증/원격·실제 적용 증거와 미완료 상태 기록 |

A→B→C를 각각 검증 가능한 코드 단계로 분리한다. B의 관리 DB 호출은 먼저 주입 가능한 메모리 adapter로 검증하고, 실제 schema/RPC가 미확인인 상태에서 해당 기능을 운영에 켜지 않는다. 전체 관리자 포팅이 끝나기 전 현재 View UI를 관리자 전체 완료로 표시하지 않는다.

### DB/RPC 준비와 실제 운영 조작의 분리

| 구분 | 순수 코드/로컬로 준비할 것 | 별도 승인과 실제 증거가 필요한 것 |
| --- | --- | --- |
| 기존 004 | #20의 `db/migrations/004_admin_console_credentials.sql`을 읽어 필요한 테이블/RPC 차이를 검토. 원본 파일이 있다는 이유로 적용됐다고 간주하지 않음 | 전용 DB의 실제 migration history/schema 대조. INACTIVE 재개는 별도 승인 필요 |
| 후속 schema 파일 | 적용 이력이 확인된 뒤 CLI가 생성하는 `db/migrations/<timestamp>_admin_console_actor_scope.sql` 범위를 확정. 지금 임의 번호로 파일을 만들거나 기존 적용 이력을 덮어쓰지 않음 | 실제 migration 실행·rollback 검증. 기존 Flowin/Discord DB는 대상 아님 |
| 사용자/팀 연결 | 관리형 subject와 `team_principals.id`의 동일성 계약 및 현재 grant의 교집합을 코드로 검증. 사용자 metadata 생성이 팀/리소스 grant를 자동 생성하지 않게 설계 | 실제 사용자 등록/역할·team/resource grant 변경은 별도 명시 승인. 관리형 신규 사용자는 연결·권한이 검증되기 전 접근 불가 |
| scoped 관리 RPC | actor subject/작업 범위/기대 버전/operationId를 서버가 전달하고 DB에서도 현재 팀·리소스 권한을 재확인. overview에 actor 범위 밖 사용자/키/감사·secret_hash를 반환하지 않음 | SQL/RLS/권한/경쟁 상태는 JS double로 입증 불가. 폐기 가능한 로컬 Postgres 검증 후 전용 환경 실제 검증 필요 |
| 감사·중복 방지 | 관리 mutation과 감사 insert를 같은 DB transaction에 묶고 고유 operationId로 중복 적용 방지. 감사 actor는 검증된 개인 subject이며 과거 `console-admin` 행을 임의 개인에게 귀속시키지 않음 | 실제 RPC transaction/unique 제약·실패 rollback·동시 호출 검증 |
| 키 최초 1회 표시 | 원문은 한 응답에만 둔다. 같은 operationId 재호출 시 새 원문을 발급한 척하지 않고 메타데이터/불확실 상태만 반환. 유실한 원문을 복구하려 저장하지 않음 | 합성 테스트 후 실제 테스트 키 발급/폐기·기존 OAuth 거부는 별도 승인 필요 |
| 세션·배포 설정 | 설정 parser/기본 거부·서로 다른 namespace와 mocked store를 구현. secret/service-role 값은 브라우저/로그에 보내지 않음 | 실제 세션/로그인 제한 저장소 연결, 비밀 생성·설정, 운영자 관리 권한 등록·변경, Preview HTTPS cookie/CSP·보호 계층, 최종 배포는 별도 단계 |

서비스 역할은 RLS가 자동으로 작업자 범위를 보장한다고 가정하지 않는다. 현재 004는 backend service role RPC이므로 서버 정책과 RPC 내부의 actor/범위 검사 둘 다 필요하다. 임의 `SECURITY DEFINER` 추가나 public/anon/authenticated에 관리 RPC 권한을 열어 오류를 해결하지 않는다. 실제 SQL 구현 시 최신 Supabase 문서·CLI 계약을 먼저 확인하고, 이번 계획만으로 DB 보안 검증 완료라고 표시하지 않는다.

### 합성 검증 gate와 실제 연동 gate

- **합성으로 확인 가능:** subject/scope/version 검증, legacy/추가 identity 호환, 세션 TTL·폐기 계약·CSRF, 역할/Project/team 교집합, scoped UI 목록, 변경 상한, mutation 직전 최신 권한 hook, 응답 유실/중복 operationId 계약, 일회성 키 DOM 정리, local browser/CSP/모바일, 일반/Vercel 타입·전체 회귀.
- **실제 또는 격리된 SQL 엔진 검증 필요:** migration 적용 이력, SQL/RLS/service-role/RPC transaction, 실제 Redis 원자성·재시작 내구성, DB/Redis 시간 제한·장애, 개인 OAuth 재인증/갱신/폐기, 실제 권한 회수 중 동작, Vercel Preview의 HTTPS cookie·CSP·보호 계층, 실제 GitHub View의 시각 결과.
- **현재 미승인·미실행:** DB 재개/적용, 실제 사용자/권한·키·토큰 생성/설정, 실제 View 변경, 운영 보안 설정과 수동 배포. 이번에는 브라우저 검증과 계획 문서만 추가했고, 검증 전 포팅 코드를 병합하지 않았다.


## 2026-10-23 신원·세션 HTTP/View UI 부분 연결 — 로컬 검증, 미게시

기준 브랜치는 `codex/admin-identity-foundation`, HEAD는 `2a2ab74747645e42f9a5a6fbd8cf26c5ead004c6`이다. 기존 8개 신원 기반 파일을 포함하여 현재 **24개 파일**을 변경했다. 커밋·push·PR·병합·배포는 하지 않았다. 위 36개 파일 표는 여전히 전체 미완료 포팅 계획이며, 다음 부분만 구현됐다.

| 범위 | 현재 코드 및 검증 |
| --- | --- |
| A 신원·세션·별도 관리 정책 | 검증된 개인 proof, 현재 registry/team ACL 및 서버 범위의 교집합. 별도 사용자/키 관리 capability는 기본 거부이며 HTTP 관리 기능에 연결하지 않음 |
| B OAuth | 개인 authorization code/access/refresh에 HMAC identityVersion 전달. 바인딩된 코드/refresh는 현재 코드 교체·삭제 시 거부. 기존 버전 없는 토큰은 호환하되 관리자 세션으로 승격하거나 refresh 때 새 버전을 붙이지 않음. 기존 signing key가 32자 미만이면 신규 privileged binding을 만들지 않음 |
| B 세션 저장소 | Redis NX+TTL 생성, 원자적 폐기/로그인 횟수 Lua 계약, 별도 namespace, 오류 시 거부. deployed 경로에 memory fallback 없음. 실제 Redis/Lua 실행은 미검증 |
| B HTTP | `console.ts`에서 서버 개인 신원 바인딩, 세션 회전·폐기·만료, Origin/CSRF, 중복 cookie 거부, 입력 제한, 오류 비노출. `view-adapter.ts`/router에서 동일 catalog/View Core 사용 |
| B Core | 세션 BFF는 apply 시작과 각 mutation 직전에 현재 신원/ACL/scope/write gate 및 계획 TTL 재확인. 첫 mutation 뒤 회수되면 후속 변경 중단·부분 결과 유지. 기존 public MCP/REST에 이 재검증 hook을 연결하는 포팅은 미완료 |
| C View 화면 | 기존 bearer 진입 유지, 선택 가능한 same-origin session bootstrap/resume/logout 및 cookie+CSRF transport. bootstrap 뒤 bearer를 지우며 저장소에 저장하지 않음. 인증 실패 시 UI 초기화·다른 인증으로 자동 fallback 없음 |
| C 헤더 | admin BFF rewrite 추가. 기존 self CSP 유지, 외부 JS/CSS 로딩 검증 |

**기본 비활성:** `GYP_ADMIN_CONSOLE_ENABLED=true`, 신규 `GYP_ADMIN_SESSION_BRIDGE_ENABLED=true`, `VERCEL_ENV=preview`를 모두 만족해야 BFF가 열린다. 하나라도 누락되거나 Production이면 404이며 store 생성도 하지 않는다. 기존 #20 flag 하나만으로 신규 세션 인증이 켜지지 않는다. 공유 store/충분한 기존 binding key/현재 개인 Admin/현재 ACL이 없으면 요청을 거부한다. 실제 환경 변수·자격증명·관리 authority 설정은 변경하지 않았다. 이 경로는 #20 공유 비밀번호 로그인 대신 기존 개인 OAuth proof를 요구하며, 비밀번호만으로 세션을 만들지 않는다.

### 검증 결과와 증거

- 일반 타입 검사, Vercel 타입 검사, build, JS 문법 검사, diff whitespace 검사 통과.
- 전체 **395/395 통과, 실패 0, skip 0**. 초기 테스트 double override의 반환 타입 오류를 수정한 뒤 전체 재검증했다. 테스트 skip이나 입력 schema 완화는 하지 않았다.
- 실제 Chromium의 합성 HTTPS origin에서 **6개 브라우저 검증 그룹 통과**: HttpOnly/Secure/Strict host cookie와 token DOM 삭제, Project/View 계획·명시 적용·중복 클릭/CSRF 거부, reload 뒤 cookie resume, 서버 logout/replay 거부, 역할 축소 UI/서버 거부, CSP 및 모바일 390px 가로 넘침 없음. 모든 요청은 로컬 intercept로 처리했고 외부/OAuth endpoint 요청·브라우저 storage·미처리 JS 오류는 0개다. 합성 View mutation은 1회였다.
- 증거 경로: `/tmp/gyuniverse-admin-session-validation/`의 `full-test.log`, `build.log`, `typecheck.log`, `typecheck-vercel.log`, `browser-session.mjs`, `browser-session-report.json`, `session-mobile.png`, 최종 manifest 및 patch. 브라우저는 실제 console/View handler에 Redis/GraphQL 계약 double을 주입했다. 실제 TLS 서버/Vercel edge/실제 Redis 내구성·Lua 실행을 확인한 것이 아니다.

### 미포함 및 다음 단계

PR #20 전체 관리자 UI는 통합되지 않았다. 사용자/역할 CRUD, 키 발급·폐기 및 최초 1회 표시, 관리형 DB OAuth adapter, scoped 관리 RPC, 관리자 audit 목록 화면, 관리 화면 index/console.js/css, public MCP/REST/build-server의 새 resolver/hook 연결 및 M13 운영 문서는 미완료다. Project Admin과 별도 사용자/키 관리 권한은 합치지 않았고 관리 endpoint는 404다. 기존 View write 감사는 공통 Core를 사용하지만 관리자 관리행위 DB 감사의 구현을 뜻하지 않는다.

실제 연동 없이 다음에 가능한 작업은 public MCP/REST resolver/hook 회귀 연결과, 주입 가능한 모의 관리 adapter를 통한 사용자·키·감사 UI 코드 포팅이다. 실제 관리형 DB adapter를 활성화하기 전에는 actor/credential와 team principal 연결 및 RPC 내부 범위 검사 계약을 확정해야 한다. 운영 작업 권한을 새로 설정할 필요 없이 코드·합성 테스트를 계속 준비할 수 있다.

별도 승인·실제 증거가 필요한 항목은 DB 재개·migration 적용, 실제 OAuth 로그인/토큰·grant·키 발급 및 자격증명 설정, 사용자/역할·운영 권한 변경, 실제 서비스 연결·View 변경과 배포다. Supabase `xdeygntepdjhwdiropwr`는 이전 INACTIVE 확인 이후 재조회·재개하지 않았으며, #20 migration 문서/PR 설명의 충돌은 미해결이다. 이번 코드 검증으로 적용 사실을 가정하지 않는다. 새 파일별 승인 요구 문서는 발견되지 않았고 이 실행에서 거부되거나 실행 여부가 불명확한 외부 변경은 없다.


## 2026-10-23 public transport·관리 모의 UI 포팅 — 미게시 검증 단위

이번 단계는 직전 24개 변경 파일을 보존하고 **총 35개 파일**까지 확장했다. 모두 위 36개 계획 표 안의 경로이며, 별도 변경 승인이 필요한 저장소 지침은 발견되지 않았다. 추가 11개는 `src/http/remote-mcp.ts`, `src/http/remote-mcp.test.ts`, `src/http/rest-api.ts`, `src/http/rest-api.test.ts`, `src/mcp/build-server.ts`, `src/admin/managed-auth.ts`, `src/admin/managed-auth.test.ts`, `public/admin/index.html`, `public/admin/console.js`, `public/admin/console.css`, `docs/M13_ADMIN_CONSOLE_PREVIEW.md`다. 직전 기반 파일의 resolver/console/View 연결 테스트도 보강했다. `src/oauth/endpoints.test.ts`는 변경하지 않았으며 개인 version 전파 회귀는 `individual-identity.test.ts`에 있다.

- **public MCP/REST:** 공통 verified operator resolver로 현재 개인 credential version·팀 ACL·scope/서버 범위를 확인한다. admin cookie만으로 public API에 들어갈 수 없다. View Core apply에 mutation 직전 비동기 재검증 hook을 전달했다. 실제 MCP JSON transport와 REST 경로에서 최종 pre-read 중 역할 회수 시 mutation 0회를 확인했다. 기존 비-View 쓰기는 요청 시작 시 현재 resolver를 사용하며 세부 단계마다 View hook을 확대하지 않았다.
- **관리 모의 adapter:** 별도 AdminPolicy, 현재 개인 proof/ACL, 전체 기존/신규 대상 scope·역할 상한, expectedVersion 및 operationId를 확인한다. double transaction 안에서 대기 후와 비동기 policy 조회 후 최신 권한을 재확인한다. mutation·감사·영수증은 함께 저장하며 동일 operation의 동시/응답 유실 재호출은 새 키/감사를 만들지 않고 원문을 반환하지 않는다.
- **사용자·키·감사 UI:** 서버 session bootstrap/resume/logout, 범위별 목록, 사용자 생성/역할·Project·활성 metadata 수정, 합성 키 발급/폐기, 검증된 개인 actor 감사 표시를 구현했다. 생성 metadata가 OAuth 신원·Project grant로 연결되지 않는다. 키는 실제 인증이 불가능한 `synthetic-only-` 형식만 허용하며 최초 응답에서만 표시하고 숨김/30초/세션 만료/오류/logout/pagehide/탭 숨김 시 지운다. 응답 유실은 자동 재시도하지 않고 mutation을 막으며 목록/감사를 본 뒤 명시적 확인 버튼으로만 새 작업을 연다.
- **기본 비활성 유지:** 앞의 session 두 flag+Preview 조건 외에 관리 route는 신규 `GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED=true`가 필요하다. 서버 주입 adapter/authority가 없으면 503/403이며 배포 entrypoint에 이를 설치하지 않았다. flag만으로 관리 권한이나 DB OAuth가 생기지 않는다. shared store의 실제 키 발급은 코드에서 거부한다. 실제 환경 변수는 변경하지 않았다.
- **수정한 호환 결함:** OAuth 발급의 signing key 정규화와 resolver의 identityVersion 검증이 공백 포함 환경 값에서 불일치할 수 있어 동일하게 trim하도록 맞추고 회귀 테스트를 추가했다. 실제 비밀값은 읽거나 출력하지 않았다.

### 최종 검증

전체 **409/409 통과, 실패 0, skip 0**. 일반 타입 검사, Vercel 타입 검사, build, 두 UI JS 문법 검사, tracked/untracked diff 검사를 통과했다. 기존 bearer/OAuth/legacy transport·Project #2·실제 socket 회귀를 skip하거나 약화하지 않았다.

실제 Chromium으로 **신규 관리 화면 8개 그룹 + 기존 View 세션 6개 그룹**을 통과했다. 관리 그룹은 범위 밖 기록 비노출, 명시적 사용자 생성과 중복 클릭 1회 처리, 합성 키 최초 표시/숨김·reload 비복구, 버전 기반 역할 수정·폐기/actor 감사, 발급 응답 유실 시 반복 차단·수동 확인, cookie resume, 권한 축소 UI 초기화·logout, self CSP/모바일390·desktop1280, 외부 요청/OAuth endpoint·브라우저 storage·미처리 JS 오류 0개를 포함한다. 모든 브라우저 요청은 로컬 합성 HTTPS origin에서 intercept하며 실제 console handler와 모의 Redis/management/Core를 실행했다.

증거: `/tmp/gyuniverse-admin-management-validation/`의 `full-test.log`, `typecheck.log`, `typecheck-vercel.log`, `build.log`, `browser-management.mjs`, `browser-management-report.json`, `management-mobile.png`, `browser-session-regression.log`, manifest 및 전체 patch. 이전 View 브라우저 harness/report는 `/tmp/gyuniverse-admin-session-validation/`에 있다. 비밀값이나 cookie/header 원문은 보고서에 기록하지 않았다.

### PR #20 대비 및 남은 작업

상세 기능 표는 `M13_ADMIN_CONSOLE_PREVIEW.md`에 있다. 비교 기준은 로컬 보존 #20 head `ff1d03b082c3683d16682cd4dc22346915fa804c`다. 공유 비밀번호만으로 관리자 권한을 얻는 방식을 포팅하지 않았고, 개인 proof·별도 authority로 대체했다. 사용자/역할/키/감사 화면은 모의 계약 수준에서 포함됐지만 **실제 관리형 DB OAuth와 전체 운영 통합 완료를 뜻하지 않는다**.

순수 코드로 남은 일은 actor/credential/team principal 연결 및 actor-scoped RPC wire DTO를 구체화하고, 기존 004와의 차이를 검토하며 폐기 가능한 SQL/Redis 엔진 테스트를 준비하는 것이다. 현재 callback transaction double은 DB RPC 구현이 아니다. 실제 adapter는 actor·전체 대상 scope/role·기대 버전/operationId를 SQL에 전달하고 transaction 안에서 최신 identity/team/resource 권한과 감사·영수증을 검증해야 한다. 실제 키 발급 adapter 및 OAuth code/refresh 연결은 그 계약/SQL 검증 전에는 활성화하지 않는다.

현재 blocker는 실행 거부가 아니라 실제 연동 검증을 제외한 승인 범위와 미확인 DB 이력이다. 별도 사용자 조치가 필요한 것은 전용 Supabase 상태/004 적용 이력 확인 및 필요 시 재개/migration 승인, 실제 OAuth·세션 저장소·자격증명/별도 관리 authority 설정과 테스트 권한 승인, 마지막으로 Preview 실제 연동/배포 승인이다. `xdeygntepdjhwdiropwr` INACTIVE 및 문서/PR migration 불일치는 여전히 미해결이며 이번에 재조회/재개하지 않았다.

브랜치 `codex/admin-identity-foundation`, 기준 SHA `2a2ab74747645e42f9a5a6fbd8cf26c5ead004c6` 유지. commit/push/PR/병합/배포, 실제 로그인·토큰/키·grant/권한·DB·외부 View 변경은 모두 미실행이다. 이번 실행에서 거부되거나 실행 여부가 불명확한 외부 변경도 없다.


## 최종 게시 전 보안·회귀 검토

동일 35개 파일을 검토하면서 두 경계를 보강했다. 세션 bootstrap은 비동기 저장/이전 세션 회전 뒤 현재 session·개인 proof·역할/ACL을 다시 검증한 후에만 성공 응답을 반환한다. 저장 중 역할 축소/만료는 cookie 활성화 없이 거부하고 생성 record를 폐기한다. 관리 operation receipt도 UUID·actor·digest·엄격한 result schema로 검증하여 예상 밖 secret 필드가 replay 응답에 섞이지 않게 했다.

보강 후 **411/411 통과, 실패/skip 0**, 일반/Vercel 타입·빌드·JS 문법·diff 검사, 관리 브라우저 8개 및 View 세션 6개 그룹을 다시 통과했다. 기존 인증 모드/legacy transport와 cookie의 public bearer 대체 거부, 현재 권한 회수·원본 만료, 역할/Project/서버 범위 교집합을 검토했다. 신규 관리자 기능은 여전히 flag 누락/Production에서 닫히며 router/배포 entrypoint에는 management adapter·authority·managed OAuth DB resolver가 설치되지 않는다. 비밀 원문 로그/브라우저 저장소 추가는 없다.

증거는 `/tmp/gyuniverse-admin-identity-final-review/`에 보존한다. 이전 409개 결과는 앞 단계 스냅샷이며 최종 PR의 검증 수는 411개다. 원격 기준 통합 브랜치는 게시 전 `2a2ab74747645e42f9a5a6fbd8cf26c5ead004c6`였고 같은 head/base PR은 없었다. 이 단계는 검증된 35개 파일의 commit/push/통합 PR 및 검사 후 일반 병합까지 승인된 범위다. main/develop·수동 배포·실제 설정/자격증명/DB/권한/View 변경은 제외한다. 최종 원격 커밋·CI·병합 결과는 PR과 실행 보고를 따른다.

후속 계획은 (1) actor-scoped RPC wire DTO와 identity/credential/team 연결·기대 버전/operationId·감사/영수증 원자성 계약, (2) 폐기 가능한 SQL/Redis engine 검증, (3) 승인 후 전용 환경 실제 연결로 나눈다. 현재 Docker daemon은 읽기 조회에 응답했지만 Postgres/Redis 실행 파일과 cached container image는 없으며 이번에 engine/container를 실행하거나 설치하지 않았다. 후속 코드/격리 엔진 검증은 실제 전용 Supabase 재개·migration·운영 자격증명 변경 없이 준비할 수 있다. 실제 DB 연동은 INACTIVE 상태/004 적용 이력을 먼저 확인하고, 재개·migration·service-role/별도 관리 authority 설정, 실제 OAuth/키·grant/권한 테스트에 필요한 명시 승인과 폐기 가능한 테스트 대상이 필요하다.
