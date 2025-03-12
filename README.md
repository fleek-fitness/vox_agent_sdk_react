# Vox.ai React 라이브러리

React 애플리케이션에 음성 AI 기능을 통합하기 위한 SDK 라이브러리입니다.

## 설치

패키지 매니저를 통해 프로젝트에 라이브러리를 설치하세요.

```bash
npm install @vox-ai/react
# 또는
yarn add @vox-ai/react
# 또는
pnpm install @vox-ai/react
```

## 사용법

### useVoxAI

Vox.ai 플랫폼과의 음성 AI 상호작용을 관리하는 React 훅입니다.

#### 초기화

먼저 useVoxAI 훅을 초기화합니다.

```tsx
import { useVoxAI } from "@vox-ai/react";

function VoiceComponent() {
  const { connect, disconnect, state, messages } = useVoxAI({
    onConnect: () => console.log("Vox.ai에 연결됨"),
    onDisconnect: () => console.log("Vox.ai 연결 해제됨"),
    onError: (error) => console.error("오류:", error),
    onMessage: (message) => console.log("새 메시지:", message),
  });

  // 컴포넌트의 나머지 부분
}
```

#### 옵션

- **onConnect** - 음성 AI 연결이 설정되었을 때 호출되는 핸들러
- **onDisconnect** - 음성 AI 연결이 종료되었을 때 호출되는 핸들러
- **onMessage** - 새 메시지가 수신되었을 때 호출되는 핸들러
- **onError** - 오류가 발생했을 때 호출되는 핸들러

#### 메서드

##### connect

Vox.ai 서비스에 연결을 설정합니다. 인증 매개변수가 필요합니다.

```tsx
// 에이전트 ID와 API 키로 Vox.ai에 연결
connect({
  agentId: "your-agent-id",
  apiKey: "your-api-key",
  dynamicVariables: {
    // 대화 커스터마이징을 위한 동적 변수
    userName: "홍길동",
    context: "고객-지원",
  },
});
```

##### disconnect

음성 AI 세션을 수동으로 종료하는 메서드입니다.

```tsx
disconnect();
```

#### 상태 및 데이터

##### state

음성 AI 상호작용의 현재 상태를 포함하는 React 상태입니다.

```tsx
const { state } = useVoxAI();
console.log(state); // "disconnected", "connecting", "initializing", "listening", "thinking", "speaking" 중 하나
```

이 상태를 사용하여 사용자에게 적절한 UI 표시기를 보여줄 수 있습니다.

##### messages

대화 기록을 포함하는 React 상태입니다.

```tsx
const { messages } = useVoxAI();
console.log(messages); // 메시지 객체 배열
```

각 메시지는 다음 구조를 가집니다:

```tsx
type VoxMessage = {
  id?: string;
  name: "agent" | "user" | "tool";
  message?: string;
  timestamp: number;
  isFinal?: boolean;
};
```

## 예제

```tsx
import React, { useState } from "react";
import { useVoxAI } from "@vox-ai/react";

function VoiceAssistant() {
  const [isConnected, setIsConnected] = useState(false);
  const { connect, disconnect, state, messages } = useVoxAI({
    onConnect: () => setIsConnected(true),
    onDisconnect: () => setIsConnected(false),
    onError: (error) => console.error("오류:", error),
  });

  const handleConnect = () => {
    connect({
      agentId: "your-agent-id",
      apiKey: "your-api-key",
    });
  };

  return (
    <div>
      <h1>Vox.ai 음성 비서</h1>

      <div>
        <button onClick={handleConnect} disabled={isConnected}>
          연결
        </button>
        <button onClick={disconnect} disabled={!isConnected}>
          연결 해제
        </button>
      </div>

      <div>
        <p>현재 상태: {state}</p>
      </div>

      <div>
        <h2>대화</h2>
        <ul>
          {messages.map((msg, index) => (
            <li key={msg.id || index}>
              <strong>{msg.name}:</strong> {msg.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

## 기여하기

변경 사항을 제안하기 전에 먼저 이슈를 생성해 주세요. 모든 기여를 환영합니다!

Pull Request를 제출함으로써, 귀하는 코드가 MIT 라이센스 하에 이 라이브러리에 통합되는 것에 동의하는 것입니다.
