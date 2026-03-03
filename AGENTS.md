# @vox-ai/react AGENTS Guide

이 문서는 `domains/voxai/sdk/react` 작업 시 에이전트가 따라야 하는 기준이다.

## 목적

`@vox-ai/react`는 `@vox-ai/client` 위에 얇은 React 인터페이스를 제공하는 패키지다.
핵심 역할은 `useConversation` 훅으로 React 상태와 SDK 제어를 연결하는 것이다.

## 개발 철학

1. React 패키지는 얇게 유지한다.
2. 연결/오디오 핵심 로직은 `@vox-ai/client`에 둔다.
3. React에서는 상태 동기화와 사용성에 집중한다.
4. deprecation/호환 레이어 없이 현재 API를 명확히 유지한다.
5. React스럽게 테스트한다. (React 앱에서 훅 사용)

## 코드 원칙

1. 훅은 예측 가능한 상태(`status`, `isSpeaking`, `micMuted`)를 제공해야 한다.
2. 콜백(`onConnect`, `onMessage`, `onError` 등)은 중복 호출 없이 일관되게 전달한다.
3. 새 기능은 먼저 `@vox-ai/client` 가능 여부를 확인한 뒤 래핑한다.
4. 새/변경 API는 `tests/react` 테스트 앱과 문서를 함께 갱신한다.

## 검증

- 수동 검증 앱: `domains/voxai/sdk/tests/react`
- 문서 동기화: SDK README + docs 페이지를 함께 갱신
