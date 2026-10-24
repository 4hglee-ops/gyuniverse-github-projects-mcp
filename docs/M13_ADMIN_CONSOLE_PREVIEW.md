# 관리자 콘솔 Preview — 코드 및 합성 검증

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

`MemoryAdminManagementStore`는 주입 전용 합성 double이다. 기존 memory adapter는 합성 전용이며, 아래 후속 코드에서 별도 scoped DB adapter와 발급기를 추가했다. 기본 배포 경로에서는 이를 활성화하지 않는다. SQL engine/원자성/내구성 검증을 이 double의 통과로 대체할 수 없다.

## PR #20 대비 포함/미포함

| 기능 | 코드 상태 | 실제 연동 상태 |
| --- | --- | --- |
| 관리자 로그인·세션·logout | 개인 OAuth 신원 바인딩 방식으로 대체, 폐기 가능한 공유 세션 adapter 및 CSRF/TTL/회전 | 개인 로그인·토큰 발급 및 운영 Redis 서비스 미검증 |
| 공유 관리자 비밀번호 | 단독 권한 부여 방식을 포팅하지 않음 | 새 비밀번호/secret 설정 없음 |
| 사용자 생성·역할/Project/활성 metadata 변경 | 모의 adapter와 actor-scoped SQL command, 전체 범위·별도 권한·버전/중복 검사 및 UI | 운영 DB 사용자 생성·ACL grant·실제 권한 변경 없음 |
| 키 발급·폐기·최초 1회 표시 | 별도 scoped 발급기·SQL adapter·일회성 UI, 응답 유실·재호출 원문 비노출 | 합성 테스트 데이터로만 실행. 실제 서비스에는 미연결 |
| 관리 감사 화면 | 검증된 actor와 전체 Project 범위 필터, mutation·감사·receipt의 SQL transaction | 격리 PostgreSQL에서 검증. 실제 서비스 DB 미연결 |
| managed credential OAuth code/refresh | hash 조회와 subject/credentialId binding, code·access·refresh 연결 및 현재 역할/폐기 검증 | 격리 SQL 연결과 합성 흐름 검증. 운영 적용·실제 OAuth 검증 필요 |
| View 화면·공통 Core 연결 | BFF/public MCP/REST 연결, 최신 권한 hook 및 실패/중복 방지 | 실제 GitHub View 시각 결과 미검증 |
| 정적 자산/CSP/모바일 | 외부 JS/CSS, textContent, 브라우저 저장소 미사용 | 로컬 Chromium 검증만, Vercel edge/보호 계층 미검증 |
| migration 004/운영 배포 | 계획·위험 문서화만 | 적용 사실 미확인, 실행 안 함 |

## 실제 DB 연결 전 필요한 계약

모의 callback transaction은 로컬 의미 검증용이며 DB RPC 구현 자체가 아니다. 실제 adapter는 검증된 actor subject/credential, 작업 capability/전체 대상 범위, 기대 버전과 operationId를 RPC에 전달하고 SQL transaction 안에서 현재 identity/team/resource 권한을 다시 검증해야 한다. service-role 연결만으로 actor 범위를 보장한다고 가정하면 안 된다. 사용자 생성은 principal 연결과 명시적 grant 검증 전에는 로그인할 수 없어야 한다.

mutation+감사+operation receipt를 같은 transaction에 넣고, 동시/응답 유실 재호출에는 키 원문을 복구하거나 다시 발급하지 않아야 한다. 만료·폐기·역할/범위 변경 중 토큰 교환/갱신/기존 세션이 거부되는지 실제 SQL 엔진과 폐기 가능한 테스트 환경에서 검증해야 한다. 순수 코드 단계에서는 wire DTO와 주입 계약을 구체화할 수 있지만, 실제 권한 부여는 그 계약의 검증을 대신하지 못한다.

DB 재개·migration 실행, 실제 OAuth 로그인/토큰·키 발급, 자격증명 설정, 사용자/역할·grant 변경, 실제 View 변경 및 배포는 별도 승인 후에만 진행한다. 현 실행은 이를 하지 않았다. 상세 파일/검증 기록은 `MCP_VIEWS_ADMIN_INTEGRATION_STATUS.md`와 아래 workspace 검증 기록을 참조한다. 과거 `/tmp/gyuniverse-admin-management-validation/` 자료는 환경 재시작 후 보존되지 않았다.


## 키 발급 scoped RPC 전진 초안 — 운영 미적용

이번 보강은 키 발급 한 경로에 한정한다. `docs/drafts/admin-scoped-credential-issue-forward.sql`은 기존 001/002/004가 확인된 환경을 전제로 하는 검토 초안이며 기존 migration을 덮어쓰지 않는다. Supabase CLI가 없어 timestamped migration으로 등록하지 않았다. 실제 DB 적용/이력 확인은 미실행이다.

PR #30 당시의 `ScopedCredentialRpc`는 server-injected transport·현재 개인 proof/ACL·서버 lease를 요구하고 기본 disabled/Preview only다. router/console에는 설치하지 않았으며 실제 자격증명 생성기와 배포용 DB factory는 없다. 아래 후속 코드에서 주입 전용 PostgREST transport, SQL lease 수명주기, 기본 비활성 console factory를 추가했다. 배포 entrypoint에서는 factory를 호출하지 않는다. candidate hash와 metadata만 다루며 원문을 생성/저장/반환하지 않는다. 새 SQL authority/lease에는 enrollment 기본 데이터가 없고 authority는 기본 inactive다.

SQL 초안은 부모 user row lock/credential_generation 갱신 trigger로 기존 004의 COUNT→INSERT 경합과 stale REPEATABLE READ를 막고, metadata 변경 시 version을 갱신한다. 기존 비범위 발급 RPC의 backend execute를 회수하므로 실제 적용은 전환 계획 검토 전에는 금지한다. scoped RPC는 READ COMMITTED만 허용한다. 권한·lease·M12 변경 statement trigger와 발급 RPC가 같은 transaction advisory gate를 사용하므로 service_role에 M12/authority write 권한을 추가하지 않고 DB 안에서 최종 판정한다. 이 관리 gate는 coarse lock으로 처리량에 한계가 있으며 모든 후속 변경 경로의 lock order(관리 gate→target user row)를 유지해야 한다. 임의 외부 row-lock 순서·DB admin의 trigger 우회까지 보장하지 않는다.

서버 attestation→SQL 현재 authority/binding/lease/authEpoch→현재 principal/team/resource/provider/capability 및 전체 target scope→expectedVersion/operationId→키 insert+개인 actor 감사+불변 scope receipt를 한 transaction에서 검증한다. managed actor는 현재 DB 사용자 범위와 키의 발급 당시 역할·Project 범위를 추가로 교차 검증한다. 과거 키의 immutable 발급 범위가 비어 있으면 자동 승격하지 않고 거부한다. 원본·lease·managed credential 만료도 반환 직전 다시 확인하며 실패하면 쓰기 전체가 rollback된다. DB lease/authEpoch가 관리 쓰기의 최종 철회 기준이며 Redis logout과 SQL commit의 분산 원자성을 주장하지 않는다. ENV binding/역할 변경과 DB epoch 동기화는 아래 명시적 준비 프로토콜을 따른다. 운영 실행·자동 동기화·UI logout 연결은 하지 않았다.

`admin-credential-rpc-engine.mjs`는 캐시된 공식 Postgres 17.11 amd64 digest만 사용해 network none/port 비공개/tmpfs 합성 환경에서 정확히 이 SQL 초안과 제품 TS adapter를 psql bridge로 연결해 검증한다. 이전 계약 모형과 달리 제품 SQL/adapter 코드가 연결됐지만 실제 PostgREST·Supabase/RLS deployment·관리형 OAuth·HTTP UI 연결까지 검증된 것은 아니다. 합성 managed-source 성공/metadata-only replay와 폐기·만료·잘못된 사용자 연결·역할/범위 축소 거부도 SQL 엔진에서 검증했다. managed 신원 resolver는 모의 응답이므로 실제 DB OAuth resolver 검증을 대신하지 않는다.

PR #30 시점 합성 lease 등록/폐기는 DB owner fixture였다. 아래 후속 초안은 검증된 서버 세션에서 SQL lease RPC로 연결하고 private lease 테이블의 backend INSERT 및 revoked_at UPDATE를 제한적으로 허용한다. authority 변경은 여전히 backend에 허용하지 않는다. 미등록·다른 actor lease·폐기 후 재호출·15분 초과·ENV proof/DB authority/lease epoch 불일치를 거부하고, 명시적으로 합성 epoch를 맞췄을 때의 정상 경로도 검증했다. 운영 HTTP 등록/폐기 route나 자동 epoch 복구는 없다. 현재 전체 코드 테스트 430/430(신규 8), 실제 PostgreSQL 17.11 검증 22개 그룹, 일반/Vercel 타입·빌드 검사를 통과했다. 테스트 종료 후 임시 컨테이너/합성 데이터는 제거하고 이미지는 보존했다. 당시 PR #30 증거는 해당 결과 디렉터리에 보존하며, 아래 후속 코드 검증 결과와 구분한다. 실제 운영 credential provisioning 및 서비스 연동 검증은 남아 있다. 증거는 `/workspace/gyuniverse-product-rpc-validation-20261024/`에 보존한다.


## DB lease·신원 resolver·console 연결 — 기본 비활성, 운영 미적용

PR #31의 연결 단위는 SQL 초안, scoped RPC adapter, DB 연결 모듈과 테스트, console/session store, 주입 factory와 route 테스트, 엔진 하네스, 문서의 총 10개 파일이었다. 새 환경변수, 실제 credential 생성기, 배포 entrypoint 연결은 추가하지 않았다. DB transport, resolver, lease bridge와 factory는 명시적 서버 opt-in과 Preview를 요구하며 기본 비활성이다.

| 기능 | 코드에 포함된 범위 | 미포함 또는 실제 환경 검증 필요 |
| --- | --- | --- |
| 개인 신원 → 세션 → DB lease | 기존 resolveSessionOperator로 현재 proof와 ACL을 확인하고 서버 session idHash, epoch, policy digest를 바인딩 | 실제 Redis 서비스와 개인 OAuth 로그인 |
| connect·회전·재개 | DB factory를 주입하면 기존 UI의 session route가 세션 저장과 lease 등록을 모두 확인. 이전 세션과 lease를 폐기하고 재개 시 양쪽을 확인 | 배포 entrypoint에서 factory를 호출하거나 활성화하지 않음 |
| 요청·쓰기 직전 재검증 | DB factory를 주입한 console 요청은 현재 세션과 DB lease를 확인. View mutation의 기존 refresh hook도 같은 검증을 사용 | 실제 GitHub mutation 미실행 |
| logout·실패 정리 | 저장된 epoch/digest로 역할 축소 후에도 폐기 가능. 공유 세션과 DB 폐기를 모두 확인해야 성공. 등록 응답 유실도 정리하며 자동 재시도하지 않음 | 양쪽 저장소가 모두 실패하면 폐기를 확정할 수 없어 미확인 오류를 반환. 운영 재조정 절차 필요 |
| lease 수명주기 | 등록·조회·폐기, 원본 세션/proof 기준 최대 15분, 같은 id/expiry만 재호출. 갱신과 폐기 id의 부활을 거부하는 tombstone | 운영 retention 작업 실행 없음 |
| epoch/ENV 동기화 | owner 전용 CAS stage가 inactive, epoch 증가, manifest/binding 갱신, 기존 lease 폐기를 한 SQL transaction으로 처리 | 운영 control-plane 구성과 별도 활성화 절차 실행 없음 |
| DB managed 신원 | 현재 user/key 역할과 발급 당시 범위, M12 교집합 확인. 비활성 provider, 읽기 전용 resource, 중복 context를 거부 또는 축소 | OAuth code/refresh 경로 활성화 및 실제 토큰 발급 없음 |
| PostgREST transport | 고정된 3개 RPC POST, 서버 secret apikey와 기존 service JWT 구분, redirect/cache/retry 금지, 5초·64KiB 제한, 오류 상세 비노출 | 실제 PostgREST 프로세스, Supabase gateway, 운영 역할 매핑 미검증 |
| scoped 발급 | 합성 candidate hash로 정확한 SQL과 연결. 감사·receipt와 발급을 같은 transaction으로 처리하고 재호출은 metadata만 반환 | 아래 후속 코드에 기존 관리 경로용 원문 발급기와 DB adapter를 추가. 실제 배포 경로에는 미설치 |

private lease 테이블의 INSERT와 revoked_at UPDATE는 trusted backend에만 주는 검토 초안 권한이다. private schema는 Data API 노출 대상이 아니며 service_role에는 authority 변경이나 stage 실행 권한이 없다. SECURITY DEFINER는 도입하지 않았다. service backend 자체가 침해된 경우까지 이 RPC가 방어하는 것은 아니다. client body로 actor, epoch, manifest, lease를 받는 route는 없다.

### 명시적 epoch 전환

1. ENV 역할이나 키를 변경하기 전에 승인된 관리 절차로 현재 epoch를 expected 값으로 제시하여 DB authority를 inactive로 stage한다. epoch를 올리고 기존 lease를 폐기한다. 일반 요청은 이를 실행하거나 authority를 자동 복구할 수 없다.
2. 개인 binding, 현재 역할·권한, Project·owner allowlist, per-Project ACL로 계산한 policy digest와 새 epoch를 검토된 서버 구성에 고정한다. DB가 아직 모르는 ENV 변경을 자동 탐지한다고 가정하지 않는다.
3. worker 구성이 준비된 뒤 별도 승인된 owner 절차로 기존 authority를 활성화한다. 일반 backend에는 활성화 권한을 주지 않는다. 오래된 worker는 새 epoch를 알아도 digest 또는 binding이 다르면 거부된다.
4. 새 서버 session id로 lease를 명시적으로 등록한다. 폐기된 id를 재사용하거나 expiry를 늘리지 않는다. 누락, 불일치, 네트워크 오류 시 자동 enrollment나 epoch 복구를 하지 않는다.

### 폐기와 실패의 범위

DB factory를 주입한 console은 공유 세션과 DB lease를 모두 요구한다. logout은 공유 세션 폐기를 먼저 시도하고 실패해도 DB 폐기를 시도한다. 두 응답을 모두 확인해야 성공이다. 한쪽만 닫혀도 해당 console의 재사용을 거부한다. 양쪽 폐기가 모두 미확인이라면 cookie를 지우고 성공을 주장하지 않으며 운영 재조정이 필요하다. 독립된 두 저장소의 원자적 logout이나 네트워크 단절 중의 확정적 전역 폐기를 주장하지 않는다.

SQL은 management gate를 transaction 종료까지 보유하고 RPC 반환 직전에 현재 proof, DB lease, managed key를 다시 확인한다. 이미 gate를 잡은 쓰기는 DB 폐기보다 먼저 commit될 수 있다. 임의의 외부 장기 transaction이 정확한 만료 시각에 commit되는 것까지 보장하지 않는다. DB 권한 판정과 Redis 세션 판정을 하나의 분산 transaction으로 취급하지 않는다.

### 검증과 실제 활성화 전 단계

PR #31의 코드 테스트는 459/459이며 신규 29개, 실패와 skip은 0이다. 일반/Vercel 타입 검사, 빌드와 diff 검사를 통과했다. 기존 브라우저 View 클라이언트의 JavaScript를 합성 cookie jar와 실제 route handler에 연결해 connect, 재개, logout을 검증했다. 이는 Chromium 화면이나 실제 외부 서비스 검증은 아니다.

격리 하네스는 기존 캐시 공식 PostgreSQL 17.11 이미지로 정확한 SQL 초안과 compiled adapter를 실행한다. 합성 HTTP fetch bridge를 psql에 연결하며 실제 PostgREST 서버를 실행했다고 보고하지 않는다. 최종 33개 그룹이 모두 통과했고 임시 컨테이너와 합성 데이터 정리를 확인했다. 증거는 workspace의 engine-report.json에 기록한다. SQL epoch 준비 경로의 잘못된 ENV binding UUID 변환과 모의 HTTP bridge의 SQL NULL 표현을 수정했다. 권한 검사를 완화하거나 테스트를 skip하지 않았다.

PostgREST의 named JSON args 계약은 [공식 문서](https://docs.postgrest.org/en/v13/references/api/functions.html), secret apikey와 bearer 구분은 [Supabase 문서](https://supabase.com/docs/guides/getting-started/api-keys)를 따른다. 실제 환경에서는 schema cache 갱신, API gateway의 역할 매핑과 기존 migration 이력을 별도로 확인해야 한다.

읽기 전용 사전 점검은 추가 승인 없이 진행할 수 있다. 2026-10-24 조회에서는 대상 조직의 Free 플랜과 프로젝트 INACTIVE 상태를 확인했으나 실제 보존본과 재개 안내 금액은 확인하지 못했다. 인증된 대시보드 표시 정보가 필요하다. 프로젝트 재개, 요금제 변경, migration, grant, credential 설정을 이 승인에 묶지 않는다. Supabase compute·저장·백업, 중지된 프로젝트의 복구 조건, Upstash 요청·저장 한도, Vercel Preview 실행·로그 비용을 먼저 확인한다. 코드 구현 단계에서는 실제 서비스의 비용이나 운영 상태를 변경하지 않았다.

사전 점검 후에도 별도 폐기 가능한 환경에서 실제 PostgREST/역할/API key/schema cache 계약을 검증해야 한다. 운영 DB 재개와 실제 schema/history 확인, CLI로 정식 migration 및 rollback 계획 생성, migration/grant 적용, backend credential과 authority 설정, 실제 OAuth·UI 검증, 최종 배포는 각각 필요한 단계에서 별도 승인을 받는다. 후속 코드의 검증 상태는 아래 고정된 세 항목을 참조한다.

계획, 변경 patch, 검사 로그, 엔진 격리·정리 증거는 `/workspace/gyuniverse-db-lease-validation-20261024/`에 보존한다. PR과 최종 커밋·병합 결과는 그 디렉터리의 RESULT.md와 manifest.json에 기록한다. PR #30 당시 430개 테스트와 22개 엔진 그룹 결과는 이전 디렉터리와 구분한다.


## 고정된 세 항목 코드 준비 완료 — 기본 비활성·운영 미적용

이번 단위는 새 기능을 추가하지 않고 다음 세 항목만 구현한다. 계획한 17개 파일과 검사 결과는 `/workspace/gyuniverse-managed-completion-20261024/`에 보존한다. 정식 migration 생성이나 실제 DB 적용은 하지 않는다.

| 항목 | 작성한 코드 | 계정 없이 검증하는 경계 |
| --- | --- | --- |
| 키 원문·해시·최초 표시 | CredentialIssuer가 요청 중 후보를 만들고 해시만 scoped SQL에 전달. 최초 candidateAccepted 성공과 현재 세션/lease 재확인 후에만 원문을 반환. 기존 UI는 같은 operationId의 확정 응답만 한 번 표시 | 합성 후보, hash 일치, 재호출 원문 비노출, 응답 유실, 역할/세션 철회, 숨김·logout·페이지 수명주기 |
| actor-scoped 관리 DB adapter | 기존 overview/users/users-update/credentials/credentials-revoke만 연결. 현재 actor, 전체 기존·신규·receipt 범위와 역할 상한, version, operationId를 SQL transaction 안에서 확인. 감사와 receipt도 같은 transaction | 권한별 목록 필터, metadata 생성 시 grant 미생성, 동시성·version 충돌·rollback·재호출·자기 폐기와 철회 |
| managed OAuth code/refresh | 관리 키 원문 대신 해시로 현재 subject/credentialId를 조회. code/access/refresh에 credentialId를 고정하고 교환·갱신 때 다시 조회. 만료를 키 수명에 묶고 쓰기 권한 축소를 반영 | PKCE, code 재사용, managed refresh 회전과 재사용 거부, 폐기·만료·네트워크 실패, 기존 ENV OAuth 호환성 |

생성한 후보는 합성 테스트의 임시 데이터이며 실제 서비스에 등록하지 않는다. SQL, 감사, receipt와 재호출 결과에는 원문이 없다. 버퍼는 해시 후 지우고 원문 참조를 요청 종료 때 버리지만 JavaScript 문자열의 메모리 완전 소거를 보장한다고 주장하지 않는다. 원문은 브라우저 저장소에 쓰지 않는다.

발급 응답이 유실되면 같은 operation을 확인해도 metadata만 받을 수 있다. 목록·감사에서 결과를 확인하고 접근할 수 없는 키를 명시적으로 폐기한 뒤 새 operation으로 재발급한다. 자동 재발급이나 원문 복구는 없다. 키를 숨긴 뒤에도 다시 원문을 조회할 수 없다.

관리 DB adapter는 synthetic store의 callback transaction을 여러 HTTP 요청으로 흉내 내지 않는다. mutation은 명시적인 SQL command RPC가 소유한다. 사용자 metadata 생성은 team principal, resource grant, 별도 관리 authority 또는 로그인 권한을 만들지 않는다. 기존 principal/grant와 연결되지 않은 metadata 사용자는 managed OAuth로 접근할 수 없다.

ENV OAuth 경로와 기본 router 호출에는 새 managed adapter를 설치하지 않는다. managed OAuth와 관리 factory는 각각 명시적 서버 주입과 Preview를 요구한다. 기존 관리 경로를 DB adapter에 연결하려면 managementEnabled도 명시적으로 설정해야 한다. 합병이나 flag 하나로 실제 credential·authority가 생기지 않는다.

검토 중 기존 signed token parser가 trailing segment 또는 비정규 base64 표현을 받아 재사용 key의 표현을 달리할 수 있는 경계를 발견했다. 정규 3-part 표현만 허용하도록 보강하고 유효한 기존 ENV token 회귀를 확인한다. 감사 id는 기존 합성 UUID와 실제 SQL bigint의 제한된 문자열 표현을 지원한다. 인증이나 권한 id의 검증을 완화하지 않는다.

코드 완료 조건은 이 세 항목을 기존 UI와 route 계약에 연결하고 전체 테스트, 타입 검사, 빌드와 격리 SQL 경계를 통과하는 것이다. 실제 PostgREST gateway, 운영 DB/RLS·역할 매핑, 실제 Redis·OAuth 및 배포 확인은 별도 실연동 단계다. DB 재개·migration 적용·grant·credential 설정·실제 로그인·View 변경과 배포는 승인 없이 실행하지 않는다.


최종 코드 검증은 474/474이며 신규 15개, 실패와 skip은 0이다. 일반/Vercel 타입 검사, 빌드와 diff 검사를 통과했다. 정확한 SQL 초안과 제품 코드를 연결한 격리 PostgreSQL 검증은 43개 그룹이 모두 통과했다. member 상한의 admin 키 폐기 거부와 충분한 상한을 가진 자기 키 폐기를 별도 회귀로 유지했다. 정상 OAuth 교환·refresh 회전, 역할 축소 후 읽기 scope 전환, 폐기 후 refresh 거부와 발급 응답 유실 후 중복 방지도 실제 격리 SQL에서 확인했다.

고정된 세 항목의 코드 작성과 합성·격리 검증은 완료했다. 기존 UI 계약을 포함한 검증이며 실제 PostgREST 서버·Supabase gateway·운영 Redis·실제 계정 로그인 검증을 뜻하지 않는다. 배포 entrypoint에 실제 adapter를 설치하거나 SQL을 적용하지 않았다. 필요한 실제 서비스 검증과 활성화는 기존 승인 경계 안에서 별도 단계로 진행한다. 새로운 구현 항목은 이 목록에 추가하지 않는다.
