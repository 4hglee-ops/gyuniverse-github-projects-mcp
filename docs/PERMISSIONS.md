# 권한 모델

## 1. 기본 역할

Gyuniverse GitHub Projects MCP는 기본적으로 세 가지 역할을 사용합니다.

- `Viewer` — 조회와 분석
- `Member` — 조회 + 일반적인 Status/Priority 및 일부 item 작업
- `Admin` — 생성·할당·generic field·relationship·bulk governance 포함

역할은 편의를 위한 기본 권한 묶음이고, 실제 runtime authorization은 capability를 기준으로 합니다.

## 2. Capability matrix

| Capability | Admin | Member | Viewer |
| --- | :---: | :---: | :---: |
| `project.read` | ✅ | ✅ | ✅ |
| `project.write` | ✅ | ✅ | ❌ |
| `item.add` | ✅ | ✅ | ❌ |
| `item.update_status` | ✅ | ✅ | ❌ |
| `item.update_priority` | ✅ | ✅ | ❌ |
| `item.create` | ✅ | ❌ | ❌ |
| `item.assign` | ✅ | ❌ | ❌ |
| `item.update_field` | ✅ | ❌ | ❌ |
| `item.relationship.write` | ✅ | ❌ | ❌ |
| `bulk.preview` | ✅ | ❌ | ❌ |
| `bulk.approve` | ✅ | ❌ | ❌ |
| `bulk.apply` | ✅ | ❌ | ❌ |

## 3. Identity별 권한 축소

OAuth identity에 별도의 `permissions` 배열을 지정하면 role의 기본 권한보다 더 좁게 제한할 수 있습니다.

중요한 점은 **권한을 추가하는 용도가 아니라 줄이는 용도**라는 것입니다.

예를 들어 Member가 기본적으로 Status와 Priority를 변경할 수 있더라도, 특정 identity에는 `project.read`만 허용하도록 축소할 수 있습니다.

반대로 Viewer에게 Admin capability를 추가하는 식의 권한 상승은 허용하지 않습니다.

## 4. Project membership

Role만 맞는다고 모든 Project에 접근할 수 있는 것은 아닙니다.

인증된 요청은 다음 조건의 교집합을 사용합니다.

```text
Role / Capability
      ∩
Owner Allowlist
      ∩
Project Allowlist
      ∩
Identity Project Membership
```

Identity의 `githubLogin`은 actor identity로만 사용하며 Project owner를 대신하지 않습니다.

### 신규 팀원 추가: 기존 Secret 유지

기존 `MCP_OAUTH_IDENTITIES_JSON`이 Vercel Sensitive/Secret으로 저장되어 다시 읽을 수 없다면,
별도의 `MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON` 환경변수에 새 OAuth identity 배열을 등록할 수 있습니다.
서버는 두 배열을 합쳐 검사하며, 기존 Secret을 재입력하거나 덮어쓰지 않습니다.

- 새 팀원은 고유한 `subject`, `accessCode`, `githubLogin`, `role`, `projectIds`를 가집니다.
- 두 배열 사이에서 `subject` 또는 `accessCode`가 중복되면 인증 설정이 거부됩니다.
- 기존 identity의 Project membership은 자동으로 확장되지 않습니다. 기존 사용자를 새 Project에 추가하려면 새로운 identity를 별도로 등록하거나 원본 설정을 수정해야 합니다.
- 동일한 GitHub login에 기존 identity와 새 identity가 함께 존재할 수 있으나, OAuth 연결 시 어떤 개인 접근 코드를 사용했는지에 따라 Project 권한이 결정됩니다.
- 신규 접근 코드는 반드시 비밀 저장소에서 관리하며 GitHub 저장소/Issue/PR에 넣지 않습니다.

`MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON`을 비워 두면 기존 동작과 동일합니다.

## 5. Viewer

Viewer는 다음 용도에 적합합니다.

- Project 현재 상태 확인
- Status / Priority / assignee 조회
- gap / reconciliation 분석
- relationship 조회
- checkpoint 비교
- 팀 브리핑 생성

Viewer는 GitHub 상태를 변경하지 않습니다.

## 6. Member

Member는 일반적인 팀 운영에 필요한 범위까지 허용합니다.

대표적으로:

- Viewer 기능 전체
- 기존 item Project에 추가
- Status 변경
- Priority 변경

반면 다음 작업은 기본적으로 허용하지 않습니다.

- 새 work item 생성
- assignee 직접 변경
- generic field 변경
- relationship write
- bulk plan 승인·적용

## 7. Admin

Admin은 Project 구조나 다수 item에 영향을 줄 수 있는 작업까지 수행할 수 있습니다.

대표적으로:

- work item 생성
- assignment
- generic field update
- parent/sub-issue/dependency 관계 변경
- bulk Preview / Approval / Apply

따라서 Admin identity는 가장 좁게 운영하는 것을 권장합니다.

## 8. Bulk maker-checker

기본 bulk approval mode는:

```text
same_admin_allowed
```

입니다.

보다 강한 통제가 필요한 경우:

```text
M10_BULK_APPROVAL_MODE=distinct_admin_required
```

를 사용할 수 있습니다.

이 경우 Preview를 만든 Admin이 자기 plan을 직접 approve할 수 없으며, 별도의 authorized Admin이 승인해야 합니다.

Apply actor도 별도로 `bulk.apply`와 실제 item write capability를 보유해야 합니다.

## 9. Write 위험 수준

권한을 이해하기 쉽게 나누면 다음과 같습니다.

| 수준 | 예시 | 보호 방식 |
| --- | --- | --- |
| Level 0 | 조회·분석 | read capability |
| Level 1 | Status / Priority 단건 변경 | capability + validation + re-read + audit |
| Level 2 | 생성·할당·relationship | 더 강한 capability + operation별 검증 |
| Level 3 | 여러 item bulk 변경 | Preview → Approval → Apply |
| Destructive | 삭제 계열 | 기본 surface에서 제공하지 않음 |

## 10. Defense in depth

실제 mutation은 하나의 권한 체크에만 의존하지 않습니다.

```text
Client intent
+ Authenticated identity
+ OAuth scope
+ Server ACL
+ Owner / Project allowlist
+ Project membership
+ Operation capability
+ Global write gate
+ Precondition
+ Re-read verification
+ Durable audit
```

이 중 필요한 조건 하나라도 만족하지 못하면 실행하지 않는 fail-closed 모델을 사용합니다.

## 11. Client별 차이

ChatGPT MCP, Claude MCP, GPT Actions는 연결 방식이 다를 수 있지만 Project ACL 자체는 동일한 Shared Core 정책을 사용합니다.

즉 특정 client를 사용한다고 권한이 더 넓어지지 않습니다.

## 12. Project View API (로컬 구현, 미배포)

| 작업 | MCP 도구 | REST (POST) | 필요한 권한 |
| --- | --- | --- | --- |
| 조회 | `list_project_views` | `/api/v1/project/views` | `projects:read` + Project read/allowlist |
| 구성/부분 수정 계획 | `preview_project_view_setup` | `/api/v1/project/views/preview` | Project read; GitHub에는 쓰지 않고 별도 plan store에 저장 |
| 템플릿 승인 적용 | `apply_project_view_setup` | `/api/v1/write/views/apply` | Admin + `projects:write` + Project별 `project.view.write` 및 `project.write` + write gate |
| 지원되는 부분 수정 승인 | `update_project_view` | `/api/v1/write/views/update` | 동일한 Admin 쓰기 경계 |

`project.view.write`는 이 브랜치의 Admin 역할 기본값에만 추가한 capability 정의다. 실제 사용자/팀 grant, OAuth scope, 환경변수나 배포 설정을 변경한 것은 아니다. Viewer/Member에는 부여하지 않으며, 기존에 명시적으로 축소한 permission 목록과 팀별 교집합을 우회하지 않는다. 역할 기본값을 따르는 Admin grant에 미칠 영향은 향후 배포 승인 시 검토해야 한다.

Preview는 `template` 또는 `update: {viewId, changes}` 중 하나를 받는다. 템플릿은 `operating-v1`과 `wbs-v1`이다. 반환된 `planId`, `planDigest`, owner/number와 `approved: true`를 정확히 전달해야 적용할 수 있다. 15분 TTL, 전체 View/필드 상태 digest, GitHub `viewerCanUpdate`를 다시 확인한다. 적용 전 생성한 서로 다른 계획도 같은 Project에서는 동시에 실행하지 못한다.

기존 이름 충돌은 `manual-review`, 필요한 필드/옵션/REST 정수 ID 부재는 `blocked`로 반환한다. 필드 옵션이나 WBS 항목을 수정해 충돌을 해결하지 않는다. 기존 View의 부분 수정은 이름·필터·레이아웃·표시 필드로 제한한다. 그룹/정렬이 있는 View의 레이아웃 변경은 수동 검토한다. 그룹·정렬 초기 설정은 조직 소유 Project의 REST 생성에서만 처리한다. 사용자 소유 Project의 템플릿 생성은 현재 차단한다. 삭제 도구/경로는 없다.

`Parent issue` 표시와 Roadmap 날짜 선택·마커·확대 수준은 미검증 수동 항목이다. Roadmap 생성 성공이 날짜 설정 완료를 의미하지 않는다. REST field 조회가 100개로 꽉 찬 경우 기존 REST client의 Link header 제약 때문에 불완전한 목록으로 생성하지 않는다.

로컬 개발의 memory plan store는 같은 프로세스 안에서만 공유한다. Vercel Preview/Production 또는 `NODE_ENV=production`에서는 공유 Upstash store 없이 View 계획을 만들지 못한다. 기존 MCP 초기화·기타 도구는 View store를 선제 생성하지 않아 이 조건의 영향을 받지 않는다. 실제 Redis 접속과 Lua 실행은 이번 합성 검증에 포함하지 않았다.

실행 중 오류/결과 불확실성은 `partial` 또는 `failed`, `retryable: false`, 결과별 `changed: null`로 구분한다. 변경 결과가 불확실한 Project 잠금에는 자동 만료를 걸지 않아 늦게 끝나는 요청과 새 적용이 겹치지 않게 한다. 같은 계획 재호출은 결과만 반환하며 실패한 mutation을 다시 실행하지 않는다. 잠금 소유권/최종 저장도 불확실하면 `finalizationUncertain`와 `applying`으로 보고한다. 실제 상태·감사·작업자를 확인한 별도 운영 절차 없이 잠금을 강제로 해제하지 않는다.
