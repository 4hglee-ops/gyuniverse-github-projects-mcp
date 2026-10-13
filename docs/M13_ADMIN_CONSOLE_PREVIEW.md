# M13 관리자 콘솔 MVP — Preview 전용

## 현재 상태
- 기능 PR #20 (Draft). Production main에는 병합하지 않는다.
- 전용 Supabase Gyuniverse Project Bridge (`xdeygntepdjhwdiropwr`)에 `004_admin_console_credentials.sql` 적용 완료.
- 관리자 API와 화면은 `GYP_ADMIN_CONSOLE_ENABLED=true` 와 `VERCEL_ENV!=production` 조합에서만 활성화된다.
- Preview 코드 검증과 실제 OAuth 사용까지 완료된 것은 아니다. 테스트 계정/운영 자격증명을 자동 생성하지 않는다.
- 기존 `MCP_OAUTH_IDENTITIES_JSON` 과 팀 코드 흐름은 현 상태로 유지한다.

## 구조
- 사용자: `mcp_admin_users` (역할, 프로젝트 허용 목록, 활성 상태)
- 발급 키: `mcp_admin_credentials` (SHA-256 해시, 만료, 폐기 시각)
- 감사: `mcp_admin_audit` (관리 작업 메타데이터만 저장)
- 관리자 RPC는 서비스 역할에서만 접근한다. 비밀 원문은 단 한 번 UI 응답으로 반환한다.
- OAuth 관리형 접근 코드는 `gyp_` 접두사, 무작위 32바이트.
- 발급 코드를 OAuth에서 사용하면 토큰의 credential ID가 고정되고, 토큰의 API 사용·재발급 시마다 DB 폐기/권한 상태를 다시 조회한다.
- 사용자 비활성화와 키 폐기는 토큰의 지속 사용을 막는 설계다. Upstash 유무와 관계없이 관리형 토큰마다 DB 조회가 추가되므로 서비스 SLA를 확인한다.
- GitHub 서버 측 owner/project allowlist와 MCP role/write gate는 기존대로 필요하다.

## 화면
- 정적 화면: `/admin/index.html` (로그인 전 민감 데이터 없음)
- POST `/api/admin/v1/session`: 관리자 로그인
- GET `/api/admin/v1/session`: 세션 유효성
- POST `/api/admin/v1/logout`: 세션 쿠키 초기화
- GET `/api/admin/v1/overview`: 사용자/키 메타데이터/최근 감사
- POST `/api/admin/v1/users`: 사용자 등록
- POST `/api/admin/v1/users/update`: 역할·프로젝트·활성 상태 조정
- POST `/api/admin/v1/credentials`: 랜덤 코드 최초 1회 발급
- POST `/api/admin/v1/credentials/revoke`: 코드 폐기
- POST 관리 변경은 같은 출처 `Origin` 및 세션 바인딩 `X-CSRF-Token` 필요.

## 보안 체크리스트 (활성화 전에 반드시 완료)
1. 관리자 UI 비밀번호 `GYP_ADMIN_UI_PASSWORD` 와 세션 서명값 `GYP_ADMIN_SESSION_SECRET` 를 각기 다른 고엔트로피 비밀(최소 32자)로 생성해 *Preview 브랜치 전용* 암호화 환경변수로 설정한다. 채팅/PR에 값을 공유하지 않는다.
2. `M12_SUPABASE_URL` 과 `M12_SUPABASE_SERVICE_ROLE_KEY` 를 동일 Preview 브랜치에만 설정한다. Flowin, Discord Bridge의 DB/키는 사용하지 않는다.
3. Vercel 프로젝트 Authentication 보호는 유지하고 로그인·키 발급·키 폐기·기존 토큰 거부·권한 축소·다중 실패 로그인 방어를 점검한다.
4. **현재 Draft에는 로그인 rate limit, 관리자 세션 서버 측 강제 폐기, 별도 세밀한 관리자 역할/다중 관리자 승인, 브라우저 CSP/캐시 강화 및 데이터 범위·리소스별 RBAC 등 운영 강화를 추가 검토해야 한다.** 비밀번호만으로 다중 팀용 Production을 공개해서는 안 된다.
5. OAuth 환경변수 기반 기존 방식과 Preview 관리형 방식의 동시 이용, ChatGPT/Claude 재연결, 만료·폐기 시 즉시 401, 취소·시간 제한을 회귀 검증한다.
6. Production에는 `GYP_ADMIN_CONSOLE_ENABLED` 를 설정하지 않는다. 현재 코드 역시 `VERCEL_ENV=production` 이면 관리 API를 404 처리한다.
7. 사용자 키와 GitHub 서버 PAT는 다른 비밀이다. 관리자 UI에서 GitHub PAT를 발급·표시하지 않는다.

## 개발/배포 순서
- CI 및 Draft PR 리뷰 완료
- Preview 브랜치에 전용 비밀 설정
- Preview에만 opt-in 활성화 후 관리자 테스트 사용자 발급
- 실제 Project 읽기만 검증, 변이 없음
- Issue #18 타임아웃 검증과 병행하되 Production 전환 별도 결정
