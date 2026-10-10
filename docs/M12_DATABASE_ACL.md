# M12 DB ACL 연결 (개발 단계)

M12 2단계는 기존 OAuth 사용자 식별과 기존 Project allowlist를 유지하며 **DB 권한을 추가적인 제한 조건**으로 적용한다. 아직 DB 기반 신규 사용자 등록이나 Jira 운영 인증을 제공하지 않는다.

## 안전한 도입 순서

1. 별도 Gyuniverse MCP Supabase 프로젝트를 준비한다. Flowin 및 기존 프로젝트 DB에 권한 테이블을 혼합하지 않는다.
2. 전용 DB에 `db/migrations/001_team_acl_foundation.sql`과 `002_team_acl_secure_snapshot_rpc.sql`을 순서대로 적용한다.
3. 관리자가 팀, 사용자, 팀 소속, 연결, 리소스, 리소스 grant를 생성한다. 기본적으로 connection/resource는 비활성화다.
4. 서버만 접근할 수 있는 비밀 저장소에 `M12_SUPABASE_URL` 및 `M12_SUPABASE_SERVICE_ROLE_KEY`를 설정한다. 후자는 `sb_secret_` 키 또는 기존 `service_role` JWT를 지원한다. `sb_secret_` 키는 `apikey` 헤더로만 전달하며 JWT처럼 `Authorization: Bearer`에 넣지 않는다. 브라우저에는 절대 전달하지 않는다.
5. 개발/미리보기 환경에서 권한 격리 검증 후에만 `M12_TEAM_ACL_MODE=enforce`로 전환한다.

`M12_TEAM_ACL_MODE=legacy` (기본값)은 기존 ENV 기반 identity 및 Project 권한을 유지한다. `enforce`에서는 DB grant와 기존 principal 권한의 교집합만 허용한다. DB 오류는 기존 권한으로 폴백하지 않고 요청을 거부한다.

주의: 서비스 역할 키를 가진 서버의 `get_team_access_snapshot` RPC 호출은 사용자 제공 subject가 아니라 **검증된 MCP OAuth 토큰의 subject**를 사용해야 한다. 다른 사용자의 접근 정보를 조회할 수 있는 관리자 UI는 별도 인증 및 감사 경계를 갖춰야 한다.

## 아직 구현되지 않은 기능

- 운영 DB 마이그레이션 실제 적용/시드
- 관리자 CRUD API, 변경 감사 로그
- OAuth 신규 사용자 DB 등록 및 접속 코드 폐지
- Jira 공급자 및 다중 연결 credential 관리
- 운영 전환, 키 회전, 관리자 화면

이 문서는 계획이 아닌 현재 구현 경계를 명시한다.
