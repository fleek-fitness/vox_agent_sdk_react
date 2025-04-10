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
  const {
    connect,
    disconnect,
    state,
    messages,
    send,
    audioWaveform,
    toggleMic,
    setVolume,
  } = useVoxAI({
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
  metadata: {
    // 통화에 대한 메타데이터를 프론트엔드에게 전달
    callerId: "customer-123",
    departmentId: "support",
  },
});
```

##### disconnect

음성 AI 세션을 수동으로 종료하는 메서드입니다.

```tsx
disconnect();
```

##### send

텍스트 메시지나 DTMF 톤을 에이전트에 전송하는 메서드입니다.

```tsx
// 텍스트 메시지 전송
send({ message: "안녕하세요, 도움이 필요합니다." });

// DTMF 톤 전송 (0-9, *, #)
send({ digit: 1 });
```

##### audioWaveform

에이전트나 사용자의 오디오 웨이브폼 데이터를 반환하는 메서드입니다.

```tsx
// 에이전트 오디오 웨이브폼 데이터 가져오기 (기본값)
const agentWaveform = audioWaveform({
  speaker: "agent", // "agent" 또는 "user"
  barCount: 20, // 반환할 웨이브폼 바의 수
  updateInterval: 50, // 업데이트 간격 (ms)
});

// 사용자 오디오 웨이브폼 데이터 가져오기
const userWaveform = audioWaveform({ speaker: "user" });
```

##### toggleMic

사용자의 마이크를 활성화/비활성화하는 메서드입니다.

```tsx
// 마이크 활성화
toggleMic(true);

// 마이크 비활성화
toggleMic(false);
```

##### setVolume

에이전트의 볼륨을 설정하는 메서드입니다. 값은 0(음소거)부터 1(최대 볼륨)까지입니다.

```tsx
// 볼륨 50%로 설정
setVolume(0.5);
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
  tool?: FunctionToolsExecuted; // 에이전트가 실행한 함수 도구
};
```

## 예제

### 기본 사용법

```tsx
import React, { useState } from "react";
import { useVoxAI } from "@vox-ai/react";

function VoiceAssistant() {
  const [isConnected, setIsConnected] = useState(false);
  const { connect, disconnect, state, messages, send } = useVoxAI({
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

  const handleSendMessage = () => {
    send({ message: "안녕하세요, 도움이 필요합니다." });
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
        <button onClick={handleSendMessage} disabled={!isConnected}>
          메시지 전송
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

### 오디오 웨이브폼 시각화 예제

```tsx
import React, { useState, useEffect } from "react";
import { useVoxAI } from "@vox-ai/react";

function WaveformVisualizer() {
  const { audioWaveform, state } = useVoxAI();
  const [waveformData, setWaveformData] = useState([]);

  // 웨이브폼 데이터를 정기적으로 업데이트
  useEffect(() => {
    if (state === "disconnected") return;

    const intervalId = setInterval(() => {
      // 에이전트 오디오 웨이브폼 데이터 가져오기
      const data = audioWaveform({ speaker: "agent", barCount: 30 });
      setWaveformData(data);
    }, 50);

    return () => clearInterval(intervalId);
  }, [audioWaveform, state]);

  return (
    <div className="waveform-container">
      {waveformData.map((value, index) => (
        <div
          key={index}
          className="waveform-bar"
          style={{
            height: `${value * 100}%`,
            width: "10px",
            backgroundColor: "#3498db",
            margin: "0 2px",
          }}
        />
      ))}
    </div>
  );
}
```

## 기여하기

변경 사항을 제안하기 전에 먼저 이슈를 생성해 주세요. 모든 기여를 환영합니다!

Pull Request를 제출함으로써, 귀하는 코드가 MIT 라이센스 하에 이 라이브러리에 통합되는 것에 동의하는 것입니다.
