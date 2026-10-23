# 관리자 콘솔 Preview — 미게시 코드 및 합성 검증

이 문서는 PR #20의 전체 적용 완료를 선언하지 않는다. 전용 Supabase `xdeygntepdjhwdiropwr`는 이전 INACTIVE 확인 이후 재개/연결하지 않았다. migration 004의 존재와 과거 문서 문구는 실제 적용 증거가 아니며 PR 설명과의 불일치가 남아 있다. 운영 migration history/schema를 확인하기 전 적용됐다고 가정하지 않는다.

## 현재 코드

- `/admin/views.html`: 기존 개인 bearer 또는 선택한 서버 세션으로 View 조회/계획/명시 적용.
- `/admin/index.html`: 개인 bearer로 세션 연결 또는 기존 cookie 재개, 별도 관리 capability로 범위가 허용된 사용자·역할·키 metadata 및 감사 표시.
- 서버 cookie는 Secure/HttpOnly/Strict `__Host-` 형식이며 최대 15분/원본 proof 만료에 묶인다. 현재 신원 버전·역할·ACL을 확인하고 서버 logout 시 폐기한다. POST는 동일 Origin/CSRF를 검증한다.
- 관리 쓰기는 별도 관리 authority의 작업 capability, 전체 기존/신규 대상 Project 범위, 역할 상한, scope와 현재 Project 권한, expectedVersion, operationId를 확인한다. Project Admin 역할만으로 관리 권한을 얻지 못한다.
- 사용자 metadata 생성은 실제 OAuth 신원 또는 team/resource grant를 생성하지 않는다. 역할 metadata 변경도 실제 ACL 조작이 아니다. 모의 키는 `synthetic-only-` 형식으로 실제 OAuth 인증에 사용할 수 없다.
- 키 원문은 모의 최초 성공 응답의 일회성 출력에만 있고 저장 metadata/감사/재호출 결과에 없다. 숨김·30초·세션 만료·오류·logout/pagehide·탭 숨김 시 지운다. 응답 유실은 불확실 상태로 표시하고 새 mutation을 막는다. 목록/감사를 확인한 뒤 별도 결과 확인 버튼으로만 새 작업을 허용한다.
- public MCP/REST는 공통 operator resolver로 개인 버전/현재 ACL을 검증하며 cookie를 bearer 대체물로 받지 않는다. View apply는 각 mutation 직전에 다시 검증한다. 기존 비-View mutation의 세부 단계마다 이 hook을 확대하는 작업은 이번 범위가 아니다.

## 기본 거부와 활성화 제한

`GYP_ADMIN_CONSOLE_ENABLED=true`, `GYP_ADMIN_SESSION_BRIDGE_ENABLED=true`, `VERCEL_ENV=preview`가 모두 필요하다. 관리 경로는 추가로 `GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED=true`와 서버가 주입한 management adapter 및 별도 AdminPolicy를 요구한다. flag만으로 authority나 실제 DB adapter가 생기지 않는다. 실제 환경 설정은 변경하지 않았다.

현재 배포 entrypoint에는 management adapter/authority가 주입되지 않는다. 따라서 flag를 켜도 관리 adapter가 없으면 503이고, 별도 authority가 없으면 403이다. Production과 누락 flag는 404다. 정적 HTML을 볼 수 있는 것과 API 권한은 별개다. 실제 공유 세션 저장소가 없으면 memory fallback하지 않는다.

`MemoryAdminManagementStore`는 주입 전용 합성 double이다. 실제 발급 adapter는 구현하지 않았으며 shared store의 키 발급도 거부한다. SQL engine/원자성/내구성 검증을 이 double의 통과로 대체할 수 없다.

## PR #20 대비 포함/미포함

| 기능 | 코드 상태 | 실제 연동 상태 |
| --- | --- | --- |
| 관리자 로그인·세션·logout | 개인 OAuth 신원 바인딩 방식으로 대체, 폐기 가능한 공유 세션 adapter 및 CSRF/TTL/회전 | 개인 로그인/토큰 발급 및 실제 Redis 미검증 |
| 공유 관리자 비밀번호 | 단독 권한 부여 방식을 포팅하지 않음 | 새 비밀번호/secret 설정 없음 |
| 사용자 생성·역할/Project/활성 metadata 변경 | 모의 adapter, 전체 범위·별도 권한·버전/중복 검사 및 UI | DB 사용자 생성/ACL grant/실제 권한 변경 없음 |
| 키 발급·폐기·최초 1회 표시 | 합성 키 전용 adapter/UI, 응답 유실·재호출 원문 비노출 | 실제 자격증명 발급/폐기 및 DB transaction 미구현 |
| 관리 감사 화면 | 검증된 actor와 전체 Project 범위로 필터링된 모의 감사, mutation과 double transaction | 실제 DB 감사/RPC transaction 미검증 |
| managed credential OAuth code/refresh | 현재 subject+credentialId 검증 주입 계약은 있음. DB resolver/발급 경로 연결은 미구현 | migration/credential-team 연결/실제 OAuth 검증 필요 |
| View 화면·공통 Core 연결 | BFF/public MCP/REST 연결, 최신 권한 hook 및 실패/중복 방지 | 실제 GitHub View 시각 결과 미검증 |
| 정적 자산/CSP/모바일 | 외부 JS/CSS, textContent, 브라우저 저장소 미사용 | 로컬 Chromium 검증만, Vercel edge/보호 계층 미검증 |
| migration 004/운영 배포 | 계획·위험 문서화만 | 적용 사실 미확인, 실행 안 함 |

## 실제 DB 연결 전 필요한 계약

모의 callback transaction은 로컬 의미 검증용이며 DB RPC 구현 자체가 아니다. 실제 adapter는 검증된 actor subject/credential, 작업 capability/전체 대상 범위, 기대 버전과 operationId를 RPC에 전달하고 SQL transaction 안에서 현재 identity/team/resource 권한을 다시 검증해야 한다. service-role 연결만으로 actor 범위를 보장한다고 가정하면 안 된다. 사용자 생성은 principal 연결과 명시적 grant 검증 전에는 로그인할 수 없어야 한다.

mutation+감사+operation receipt를 같은 transaction에 넣고, 동시/응답 유실 재호출에는 키 원문을 복구하거나 다시 발급하지 않아야 한다. 만료·폐기·역할/범위 변경 중 토큰 교환/갱신/기존 세션이 거부되는지 실제 SQL 엔진과 폐기 가능한 테스트 환경에서 검증해야 한다. 순수 코드 단계에서는 wire DTO와 주입 계약을 구체화할 수 있지만, 실제 권한 부여는 그 계약의 검증을 대신하지 못한다.

DB 재개·migration 실행, 실제 OAuth 로그인/토큰·키 발급, 자격증명 설정, 사용자/역할·grant 변경, 실제 View 변경 및 배포는 별도 승인 후에만 진행한다. 현 실행은 이를 하지 않았다. 상세 파일/검증 기록은 `MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md`와 `/tmp/gyuniverse-admin-management-validation/`를 참조한다.
