# @vox-ai/react

vox.ai voice agent를 React 앱에서 사용하기 위한 hook 라이브러리.

## 설치

```bash
npm install @vox-ai/react
# or
yarn add @vox-ai/react
# or
pnpm add @vox-ai/react
```

## 빠른 시작

```tsx
import { useConversation } from "@vox-ai/react";

export function VoiceWidget() {
  const conversation = useConversation({
    onConnect: () => console.log("연결됨"),
    onDisconnect: () => console.log("연결 종료"),
    onStatusChange: (status) => console.log("status:", status),
    onModeChange: (mode) => console.log("mode:", mode),
    onMessage: (message) => console.log(`${message.source}: ${message.text}`),
    onError: (error) => console.error("error:", error.message),
  });

  const start = async () => {
    // 마이크 권한 요청 (UI에서 사전 안내 권장)
    await navigator.mediaDevices.getUserMedia({ audio: true });

    const conversationId = await conversation.startSession({
      agentId: "YOUR_AGENT_ID",
      apiKey: "YOUR_API_KEY",
    });
    console.log("session started:", conversationId);
  };

  return (
    <div>
      <button onClick={start} disabled={conversation.status !== "disconnected"}>
        Start
      </button>
      <button onClick={conversation.endSession}>End</button>
      <p>Status: {conversation.status}</p>
      <p>Speaking: {conversation.isSpeaking ? "Yes" : "No"}</p>
    </div>
  );
}
```

## `useConversation(options?)`

### 콜백 (hook 초기화 시 전달)

| 콜백 | 시그니처 | 설명 |
|------|----------|------|
| `onConnect` | `() => void` | 연결 성공 |
| `onDisconnect` | `() => void` | 연결 종료 |
| `onStatusChange` | `(status: ConversationStatus) => void` | Status 변경 (`"disconnected"` → `"connecting"` → `"connected"`) |
| `onModeChange` | `(mode: ConversationMode) => void` | Mode 변경 (`"listening"` ⇄ `"speaking"`) |
| `onMessage` | `(message: ConversationMessage) => void` | 메시지 수신 (user transcription, agent response) |
| `onError` | `(error: Error) => void` | 에러 발생 |

### React State

| State | 타입 | 설명 |
|-------|------|------|
| `status` | `ConversationStatus` | `"disconnected"` \| `"connecting"` \| `"connected"` |
| `isSpeaking` | `boolean` | Agent가 현재 발화 중인지 여부 |
| `micMuted` | `boolean` | 마이크 음소거 상태 |

> JS SDK의 `getStatus()`, `getMode()`, `getMicMuted()`에 대응. React에서는 state로 제공되므로 자동 re-render.

### 메서드

#### 세션 제어

```tsx
// 세션 시작 — conversationId를 반환
const conversationId = await conversation.startSession({
  agentId: "YOUR_AGENT_ID",
  apiKey: "YOUR_API_KEY",
});

// 세션 종료
await conversation.endSession();

// 세션 ID 조회
const id = conversation.getId();
```

#### `startSession` 옵션

| 옵션 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `agentId` | `string` | O | Agent ID |
| `apiKey` | `string` | O | API key |
| `agentVersion` | `string` | | Agent version (`"current"`, `"production"`, `"v1"` 등, default: `"current"`) |
| `dynamicVariables` | `Record<string, string \| number \| boolean>` | | Agent prompt에 주입할 dynamic variables |
| `metadata` | `Record<string, unknown>` | | Call metadata (webhook, call log에 포함) |

#### 메시지 전송

```tsx
// 텍스트 메시지 전송 (음성 대신 텍스트 입력)
await conversation.sendUserMessage("안녕하세요");
```

#### 마이크 제어

```tsx
// 음소거
await conversation.setMicMuted(true);

// 음소거 해제
await conversation.setMicMuted(false);

// 현재 상태는 conversation.micMuted 로 확인
```

#### 볼륨 제어

```tsx
// Agent 음성 볼륨 설정 (0.0 ~ 1.0)
conversation.setVolume({ volume: 0.5 });
```

#### 오디오 모니터링

```tsx
// 입출력 볼륨 (0.0 ~ 1.0)
const inputVol = conversation.getInputVolume();
const outputVol = conversation.getOutputVolume();

// Frequency data (Uint8Array, 시각화용)
const inputFreq = conversation.getInputByteFrequencyData();
const outputFreq = conversation.getOutputByteFrequencyData();
```

#### 디바이스 전환

```tsx
// 입력 디바이스 변경
await conversation.changeInputDevice({ inputDeviceId: "device-id" });

// 출력 디바이스 변경
await conversation.changeOutputDevice({ outputDeviceId: "device-id" });
```

디바이스 목록은 [`navigator.mediaDevices.enumerateDevices()`](https://developer.mozilla.org/docs/Web/API/MediaDevices/enumerateDevices)로 조회.

## Dynamic Variables / Metadata

```tsx
const conversationId = await conversation.startSession({
  agentId: "YOUR_AGENT_ID",
  apiKey: "YOUR_API_KEY",
  agentVersion: "production",
  dynamicVariables: {
    userName: "홍길동",
    userType: "premium",
    accountBalance: 50000,
  },
  metadata: {
    sessionId: "sess_abc123",
    source: "mobile-app",
  },
});
```

- `dynamicVariables` — Agent prompt에서 `{{userName}}` 형식으로 참조
- `metadata` — Outbound webhook과 call log에 포함

## Export 타입

```ts
import type {
  ConversationMessage,
  ConversationMode,
  ConversationSource,
  ConversationStatus,
  InputDeviceConfig,
  OutputDeviceConfig,
  SetVolumeParams,
  StartConversationOptions,
  UseConversationOptions,
} from "@vox-ai/react";
```

## JS SDK와의 관계

| JS SDK (`@vox-ai/client`) | React SDK (`@vox-ai/react`) |
|---------------------------|----------------------------|
| `Conversation.startSession(opts)` | `conversation.startSession(opts)` |
| `getStatus()` | `status` (React state) |
| `getMode()` | `isSpeaking` (React state) |
| `getMicMuted()` | `micMuted` (React state) |
| 나머지 method/callback | 동일 |

## 참고

- `useVoxAI`는 deprecated — `useConversation` 사용 권장
- 인증은 `apiKey` 직접 전달 방식
- 내부 연결은 LiveKit WebRTC 기반
- 브라우저별 audio device 제약이 있을 수 있음
