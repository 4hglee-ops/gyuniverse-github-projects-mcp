# 개발 이력

이 디렉터리는 현재 사용법이 아니라 **프로젝트가 어떤 문제를 발견하고 어떤 설계로 발전했는지**를 남기는 기록입니다.

현재 사용법과 운영 기준은 상위 문서를 우선하세요.

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`../SECURITY.md`](../SECURITY.md)
- [`../PERMISSIONS.md`](../PERMISSIONS.md)
- [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- [`../ROADMAP.md`](../ROADMAP.md)

## 발전 흐름

### M4 — Project 운영 기반

GitHub Projects를 단순 조회하는 수준에서 벗어나 실제 팀 운영에 사용할 수 있는 기반을 만들던 단계입니다.

주요 주제:

- Project 운영 field와 workflow 구조
- Status / Priority 기준
- Project UI / view 구성
- 운영 자동화를 위한 foundation

관련 원문:

- [`legacy/M4_PROJECT_OPERATING_FOUNDATION.md`](legacy/M4_PROJECT_OPERATING_FOUNDATION.md)
- [`legacy/M4_PROJECT_UI_SETUP.md`](legacy/M4_PROJECT_UI_SETUP.md)

### M7 — Identity / ACL

공용 access code만으로는 실제 write 권한을 안전하게 구분하기 어렵다는 문제에서 시작했습니다.

이 단계에서 핵심적으로 추가한 것:

- individual OAuth identity
- `githubLogin`과 Project owner 구분
- Viewer / Member / Admin
- identity별 Project membership
- role별 write 제한
- actor-aware audit

관련 원문:

- [`legacy/M7_IDENTITY_VALIDATION.md`](legacy/M7_IDENTITY_VALIDATION.md)

### M9 — REST / GPT Actions

MCP 외의 client에서도 같은 business logic과 authorization을 재사용하기 위한 단계입니다.

핵심 결정:

```text
MCP Adapter ─┐
             ├─ Shared Core
REST Adapter ┘
```

REST가 MCP를 다시 호출하는 구조가 아니라, 두 adapter가 동일한 Shared Core를 사용하는 방향으로 정리했습니다.

또한 ChatGPT / Claude 계열 OAuth client와 DCR callback 차이를 검증했습니다.

관련 원문:

- [`legacy/M9_REST_GPT_ACTIONS.md`](legacy/M9_REST_GPT_ACTIONS.md)
- [`legacy/M9_GPT_ACTIONS_VALIDATION.md`](legacy/M9_GPT_ACTIONS_VALIDATION.md)
- [`legacy/OAUTH_DCR_DIAGNOSTICS.md`](legacy/OAUTH_DCR_DIAGNOSTICS.md)
- [`legacy/OAUTH_DCR_PUBLIC_CLIENT_NEGOTIATION.md`](legacy/OAUTH_DCR_PUBLIC_CLIENT_NEGOTIATION.md)

### M10 — Advanced Governance

AI가 실제 GitHub Project를 변경할 수 있게 되었을 때 생기는 운영 위험을 다루는 단계입니다.

#### M10-1 Checkpoint

Project 상태를 기준선(baseline)으로 저장하고 이후 상태와 비교할 수 있게 했습니다.

#### M10-2 Durable Audit

write 결과를 process memory가 아니라 Production durable store에서도 추적할 수 있도록 확장했습니다.

#### M10-3 Relationship Read

parent / sub-issue / dependency 관계를 AI가 조회할 수 있게 했습니다.

#### M10-4 Guarded Relationship Write

관계 변경에 Admin capability와 post-write reciprocal verification을 적용했습니다.

#### M10-5 Bulk Governance

여러 item의 Status / Priority 변경을 즉시 실행하지 않고:

```text
Preview → Approval → Apply
```

형태로 분리했습니다.

stale-state preflight, immutable plan, single-use Apply, item별 verification을 추가했습니다.

#### M10-6 Richer ACL

Role만 보는 방식에서 operation capability를 실제 runtime enforcement 기준으로 확장했습니다.

#### M10-7 Production Validation

Production deployment에서 OAuth, ACL, relationship, bulk, checkpoint, audit의 대표 경로를 검증하고 M10을 종료했습니다.

관련 원문:

- [`legacy/M10_ADVANCED_GOVERNANCE.md`](legacy/M10_ADVANCED_GOVERNANCE.md)
- [`legacy/M10_RELATIONSHIP_WRITES.md`](legacy/M10_RELATIONSHIP_WRITES.md)
- [`legacy/M10_BULK_PLANS.md`](legacy/M10_BULK_PLANS.md)
- [`legacy/M10_RICHER_ACL.md`](legacy/M10_RICHER_ACL.md)
- [`legacy/M10_CLOSEOUT.md`](legacy/M10_CLOSEOUT.md)

## Architecture V2 기록

Shared Core로 MCP와 REST/GPT Actions를 분리하던 시점의 설계 메모도 legacy에 보존합니다.

- [`legacy/ARCHITECTURE_V2.md`](legacy/ARCHITECTURE_V2.md)

현재 architecture의 기준 문서는 상위 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)입니다.

## 왜 원문을 남겨두는가

공개 문서는 한국어 중심으로 정리했지만, 당시 milestone 문서에는 구현 순서, 검증 조건, deferred item 등 개발 과정의 세부 기록이 남아 있습니다.

따라서 삭제하지 않고 `legacy/`에 보존합니다.

새로운 사용자는 이 원문을 모두 읽을 필요가 없습니다. 현재 구조를 이해하려면 상위 핵심 문서와 이 README의 milestone 요약만으로 충분합니다.
