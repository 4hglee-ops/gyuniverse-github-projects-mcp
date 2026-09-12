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
