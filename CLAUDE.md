# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

`@vox-ai/react` 라이브러리 - Vox.ai 플랫폼을 통해 React 애플리케이션에 음성 AI 기능을 통합하기 위한 React SDK입니다. 이 라이브러리는 LiveKit의 실시간 오디오 인프라를 감싸고 음성 어시스턴트 상호작용을 위한 간단한 React 훅 인터페이스를 제공합니다.

## 빌드 및 개발 명령어

### 빌드

```bash
npm run build
```

microbundle을 사용하여 라이브러리를 빌드하고, `dist/` 디렉토리에 UMD, ES Module, CommonJS 출력을 생성합니다.

### 개발

```bash
npm run dev
```

modern 포맷 출력으로 microbundle을 watch 모드로 실행합니다. 로컬에서 변경사항을 개발하고 테스트할 때 사용합니다.

### 린팅

```bash
npm run lint        # TypeScript와 ESLint 검사를 모두 실행
npm run lint:ts     # TypeScript 타입 검사만 실행
npm run lint:es     # ESLint만 실행
```

### 정리

```bash
npm run clean
```

`dist/` 디렉토리를 제거합니다.

## 아키텍처

### 핵심 훅: useVoxAI

주요 export는 `useVoxAI` 훅(src/hooks/useVoxAI.tsx)으로, 전체 음성 AI 라이프사이클을 관리합니다. 사용자의 React 트리를 어지럽히지 않고 LiveKit 컴포넌트를 렌더링하기 위해 숨겨진 DOM 포털 패턴을 사용합니다.

**주요 아키텍처 패턴:**

1. **숨겨진 포털 패턴**: LiveKit의 `<LiveKitRoom>` 컴포넌트는 `createRoot()`를 통해 생성된 숨겨진 DOM 노드에 렌더링되어, LiveKit의 내부 구조를 소비자의 컴포넌트 트리와 분리합니다.

2. **MessageChannel 통신**: 메인 훅과 숨겨진 `StateMonitor` 컴포넌트 간의 양방향 통신을 위해 `MessageChannel`을 사용합니다:

   - Port 1: 메인 훅이 상태 업데이트, 전사(transcription), 파형 데이터를 수신
   - Port 2: LiveKit 내부의 StateMonitor 컴포넌트가 명령을 수신 (텍스트 전송, 마이크 토글, 볼륨 설정)

3. **세션 타임스탬프 필터링**: `sessionTimestampRef`를 사용하여 이전 연결의 오래된 비동기 이벤트를 필터링하여, 빠른 연결/연결 해제 시 경쟁 조건을 방지합니다.

4. **전사 맵 패턴**: 세그먼트 ID를 키로 하는 `Map<string, VoxMessage>`로 전사를 유지하여, 최종화되기 전 비최종 전사의 효율적인 업데이트를 가능하게 합니다.

### 컴포넌트 흐름

```
useVoxAI 훅
  ├─> 통신을 위한 MessageChannel 생성
  ├─> 연결 상태 및 세션 타임스탬프 관리
  ├─> 숨겨진 포털에 LiveKitRoom 렌더링
  └─> LiveKitRoom
        ├─> RoomAudioRenderer (오디오 재생 처리)
        └─> StateMonitor 컴포넌트
              ├─> LiveKit 음성 어시스턴트 상태 모니터링
              ├─> 에이전트 및 사용자 전사 추적
              ├─> 양쪽 스피커의 오디오 파형 관리
              ├─> 함수 호출 데이터 채널 수신
              └─> MessagePort를 통해 메인 훅으로 업데이트 전송
```

### API 통합

- **엔드포인트**: `https://www.tryvox.co/api/agent/sdk` (useVoxAI.tsx의 36번 줄 참조)
- **인증**: `apiKey` 매개변수를 통한 Bearer 토큰
- **연결 파라미터**:
  - `agentId` (필수): 에이전트 ID
  - `agentVersion` (선택): 에이전트 버전 지정
    - `'v1'`, `'v12'` 등: 특정 버전 번호 (v + 숫자 형식)
    - `'current'`: 현재 편집중인 버전 (기본값)
    - `'production'`: 프로덕션으로 지정된 버전
    - `undefined`: 'current'와 동일
  - `apiKey` (필수): API 키
  - `dynamicVariables` (선택): 동적 변수
  - `metadata` (선택): 아웃바운드 웹훅 및 통화 기록에 포함될 메타데이터
- **연결 흐름**:
  1. `agentId`, `apiKey`, 선택적 `agentVersion`/`dynamicVariables`/`metadata`와 함께 API 엔드포인트로 POST 요청
  2. LiveKit 연결 세부정보 수신 (`serverUrl`, `participantToken` 등)
  3. LiveKitRoom이 이 자격 증명을 사용하여 연결

### 상태 관리

**VoxAgentState**는 에이전트의 현재 상태를 나타냅니다:

- `disconnected`: 활성 연결 없음
- `connecting`: Vox.ai에 연결 중
- `initializing`: LiveKit 세션 설정 중
- `listening`: 에이전트가 사용자 입력을 듣는 중
- `thinking`: 에이전트가 응답을 처리/결정 중
- `speaking`: 에이전트가 말하는 중

**메시지 타입** (VoxMessage):

- `agent`: AI 에이전트로부터의 메시지
- `user`: 사용자로부터의 메시지 (음성 전사 및 텍스트 모두)
- `tool`: 함수 호출 및 그 결과

### LiveKit 의존성

라이브러리는 다음의 peer 의존성을 가집니다:

- `@livekit/components-react`: ^2.9.3
- `livekit-client`: ^2.11.3

이들은 소비하는 애플리케이션에서 설치되어야 합니다. 라이브러리는 LiveKit 훅을 광범위하게 사용합니다:

- `useVoiceAssistant`: 음성 어시스턴트 상태 관리
- `useTrackTranscription`: 오디오 트랙에서 전사 추출
- `useAudioWaveform`: 오디오 시각화 데이터 생성
- `useDataChannel`: 함수 호출 정보 수신
- `useChat`: 에이전트에게 텍스트 메시지 전송

### 함수 호출

라이브러리는 LiveKit 데이터 채널을 통한 에이전트 함수 호출을 지원합니다:

- `function_calls_collected`: 에이전트가 함수 호출을 시작할 때 발생
- `function_calls_finished`: 함수 결과가 사용 가능할 때 발생

둘 다 `name: "tool"`로 메시지 배열에 표시됩니다.

## 주요 구현 세부사항

### 경쟁 조건 방지

빠르게 연결을 해제하고 재연결할 때, 새 연결이 시작된 후 오래된 LiveKit 이벤트가 도착할 수 있습니다. `sessionTimestampRef`는 현재 세션이 시작된 시점을 추적하고, `handleTranscriptionUpdate` (288번 줄)는 현재 세션 이전의 전사를 필터링합니다.

### 마이크 및 볼륨 제어

- `toggleMic(boolean)`: LiveKit의 `setMicrophoneEnabled`를 통해 사용자의 마이크를 활성화/비활성화
- `setVolume(number)`: 에이전트 오디오 볼륨 설정 (0-1 범위), 유효한 값으로 제한됨

### 파형 데이터

`audioWaveform()`은 실시간 오디오 시각화 데이터를 반환합니다:

- `"agent"` 또는 `"user"` 스피커에 대한 파형 요청 가능
- 구성 가능한 `barCount` (막대 수) 및 `updateInterval` (ms 단위의 새로고침 속도)
- 데이터 흐름: StateMonitor → MessagePort → 메인 훅 → 소비자

### 메시지 중복 제거

훅은 `processedMessageIdsRef`에서 처리된 메시지 ID를 추적하여, 메시지 배열이 다시 렌더링되더라도 `onMessage` 콜백이 최종 메시지당 한 번만 호출되도록 보장합니다.

## 개발 참고사항

- **빌드 도구**: Microbundle (라이브러리용 제로 설정 번들러)
- **TypeScript 설정**: ES2018을 타겟으로 하고, 선언과 함께 `dist/`에 출력
- **Exports**: 패키지는 적절한 ESM/CJS 해상도를 위해 최신 export maps를 사용
- **소스 진입점**: `src/index.ts`는 `src/hooks/`에서 재export
- 코드베이스는 한국어와 영어로 작성됨 (README는 한국어)
