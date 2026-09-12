# 문서 안내

Gyuniverse GitHub Projects MCP의 공개 문서는 **한국어를 기본 언어**로 사용합니다. MCP, OAuth, PKCE, ACL, GraphQL, Vercel, Upstash처럼 원문 표현이 중요한 기술 용어는 그대로 유지합니다.

## 처음 보는 경우

아래 순서로 읽는 것을 권장합니다.

1. [`../README.md`](../README.md) — 프로젝트가 무엇인지, 어떤 문제를 해결하는지
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — 전체 구조와 요청·권한·변경 흐름
3. [`SECURITY.md`](SECURITY.md) — 자격 증명과 쓰기 작업을 어떻게 보호하는지
4. [`PERMISSIONS.md`](PERMISSIONS.md) — Viewer / Member / Admin 권한 차이
5. [`DEPLOYMENT.md`](DEPLOYMENT.md) — Vercel / Upstash / self-hosting 구성
6. [`ROADMAP.md`](ROADMAP.md) — 현재 상태와 이후 확장 방향

## 현재 문서

| 문서 | 내용 |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | MCP / REST adapter, Shared Core, GitHub GraphQL, OAuth, governance 구조 |
| [`SECURITY.md`](SECURITY.md) | fail-closed 보안 모델, credential 경계, write 안전장치 |
| [`PERMISSIONS.md`](PERMISSIONS.md) | 역할 기반 접근 제어(ACL)와 capability 기준 |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Vercel Functions, Upstash, 환경변수, self-hosting |
| [`ROADMAP.md`](ROADMAP.md) | 현재 구현 범위와 다음 단계 |

## 개발 이력

`history/`에는 프로젝트가 M4 → M7 → M9 → M10으로 발전하면서 어떤 문제를 해결했는지 정리되어 있습니다.

이 문서들은 현재 사용법을 설명하는 규격 문서가 아니라 **설계 결정과 검증 과정의 기록**입니다.

- [`history/README.md`](history/README.md) — milestone 전체 흐름
- M4 — GitHub Project 운영 기반
- M7 — 개인 OAuth identity와 ACL
- M9 — REST / GPT Actions adapter와 OAuth DCR 호환성
- M10 — durable governance, relationship, bulk plan, richer ACL

## 문서 작성 원칙

- 설명은 한국어 중심
- API, MCP, OAuth, PKCE, ACL, GraphQL, 함수·환경변수·상태값은 원문 유지
- 현재 동작과 과거 milestone 기록을 섞지 않음
- 보안 관련 예시에 실제 credential을 넣지 않음
- 코드와 문서가 어긋나면 코드와 Production 검증 결과를 기준으로 문서를 갱신
