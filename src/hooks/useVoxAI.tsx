import {
  LiveKitRoom,
  RoomAudioRenderer,
  useAudioWaveform,
  useChat,
  useDataChannel,
  useLocalParticipant,
  useParticipantTracks,
  useTrackTranscription,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { HTTPS_API_ORIGIN, SDK_VERSION } from "../utils/constants";

type VoxConnectionDetail = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

/**
 * 음성 AI 에이전트의 현재 상태를 나타냅니다.
 *
 * @remarks
 * 에이전트의 상태는 다음과 같이 변화합니다:
 * `disconnected` → `connecting` → `initializing` → `listening` ⇄ `thinking` ⇄ `speaking`
 *
 * @example
 * ```tsx
 * const { state } = useVoxAI();
 *
 * if (state === 'listening') {
 *   console.log('에이전트가 사용자의 말을 듣고 있습니다');
 * }
 * ```
 */
export type VoxAgentState =
  /** 연결되지 않은 상태 */
  | "disconnected"
  /** Vox.ai 서버에 연결 중 */
  | "connecting"
  /** LiveKit 세션을 초기화하는 중 */
  | "initializing"
  /** 에이전트가 사용자의 음성을 듣고 있는 상태 */
  | "listening"
  /** 에이전트가 응답을 생각하고 있는 상태 */
  | "thinking"
  /** 에이전트가 응답을 말하고 있는 상태 */
  | "speaking";

/**
 * 에이전트가 실행한 함수 도구들의 정보를 담고 있는 타입입니다.
 *
 * @remarks
 * 에이전트가 외부 API를 호출하거나 특정 작업을 수행할 때 이 타입의 데이터가 생성됩니다.
 */
export interface FunctionToolsExecuted {
  /** 이벤트 타입 */
  type: "function_tools_executed";
  /** 실행된 함수 호출 정보 배열 */
  function_calls: FunctionCallInfo[];
  /** 함수 호출 결과 배열 */
  function_call_outputs: FunctionCallResult[];
}

/**
 * 에이전트가 호출한 함수의 정보를 담고 있는 타입입니다.
 */
export interface FunctionCallInfo {
  /** 함수 호출 고유 ID */
  id: string;
  /** 함수 타입 */
  type: string;
  /** 함수 호출 ID */
  call_id: string;
  /** 함수에 전달된 인자들 */
  arguments: Record<string, any>;
  /** 호출된 함수의 이름 */
  name: string;
}

/**
 * 함수 호출의 결과를 담고 있는 타입입니다.
 */
export interface FunctionCallResult {
  /** 결과 고유 ID */
  id: string;
  /** 호출된 함수의 이름 */
  name: string;
  /** 결과 타입 */
  type: string;
  /** 함수 호출 ID */
  call_id: string;
  /** 함수 실행 결과 (문자열 형태) */
  output: string;
  /** 에러 발생 여부 */
  is_error: boolean;
}

/**
 * 에이전트와 사용자 간의 대화 메시지를 나타내는 타입입니다.
 *
 * @remarks
 * - `name`이 "agent"인 경우: AI 에이전트가 말한 내용
 * - `name`이 "user"인 경우: 사용자가 말한 내용 (음성 또는 텍스트)
 * - `name`이 "tool"인 경우: 에이전트가 실행한 함수 도구 정보
 *
 * @example
 * ```tsx
 * const { messages } = useVoxAI();
 *
 * messages.forEach(msg => {
 *   if (msg.name === 'user' && msg.isFinal) {
 *     console.log('사용자:', msg.message);
 *   }
 * });
 * ```
 */
export type VoxMessage = {
  /** 메시지 고유 ID */
  id?: string;
  /** 메시지 발신자 타입 */
  name: "agent" | "user" | "tool";
  /** 메시지 내용 (음성 전사 텍스트 또는 사용자가 보낸 텍스트) */
  message?: string;
  /** 메시지 생성 시각 (Unix timestamp) */
  timestamp: number;
  /** 최종 확정된 메시지인지 여부 (false인 경우 음성 인식 중간 결과) */
  isFinal?: boolean;
  /** 함수 도구 실행 정보 (name이 "tool"인 경우에만 존재) */
  tool?: FunctionToolsExecuted;
};

/**
 * useVoxAI 훅의 콜백 함수들을 설정하는 옵션입니다.
 *
 * @example
 * ```tsx
 * const vox = useVoxAI({
 *   onConnect: () => {
 *     console.log('음성 AI에 연결되었습니다');
 *   },
 *   onDisconnect: () => {
 *     console.log('연결이 종료되었습니다');
 *   },
 *   onError: (error) => {
 *     console.error('오류 발생:', error.message);
 *   },
 *   onMessage: (message) => {
 *     if (message.isFinal) {
 *       console.log(`${message.name}: ${message.message}`);
 *     }
 *   }
 * });
 * ```
 */
export interface VoxAIOptions {
  /** 음성 AI 연결이 성공했을 때 호출되는 콜백 */
  onConnect?: () => void;
  /** 음성 AI 연결이 종료되었을 때 호출되는 콜백 */
  onDisconnect?: () => void;
  /** 오류가 발생했을 때 호출되는 콜백 */
  onError?: (error: Error) => void;
  /** 새로운 최종 메시지가 수신되었을 때 호출되는 콜백 (isFinal이 true인 메시지만 전달됨) */
  onMessage?: (message: VoxMessage) => void;
}

// Message channel event types
type MessageChannelEvent =
  | { type: "state_update"; state: VoxAgentState }
  | { type: "transcription_update"; transcriptions: TranscriptionSegment[] }
  | {
      type: "waveform_update";
      waveformData: number[];
      speaker: "agent" | "user";
    }
  | { type: "function_tools_executed"; tool: FunctionToolsExecuted };

type TranscriptionSegment = {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  speaker: "agent" | "user";
};

/**
 * Vox.ai 음성 AI에 연결하기 위한 매개변수입니다.
 *
 * @example
 * ```tsx
 * // 기본 연결 (current 버전)
 * connect({
 *   agentId: 'my-agent-id',
 *   apiKey: 'my-api-key'
 * });
 *
 * // 특정 버전으로 연결
 * connect({
 *   agentId: 'my-agent-id',
 *   agentVersion: 'v5',
 *   apiKey: 'my-api-key'
 * });
 *
 * // 동적 변수와 함께 연결
 * connect({
 *   agentId: 'my-agent-id',
 *   apiKey: 'my-api-key',
 *   dynamicVariables: {
 *     userName: '홍길동',
 *     userId: 'user123'
 *   },
 *   metadata: {
 *     sessionId: 'sess_abc123'
 *   }
 * });
 * ```
 */
export interface ConnectParams {
  /**
   * 연결할 에이전트의 ID
   * @remarks Vox.ai 대시보드에서 확인할 수 있습니다.
   */
  agentId: string;

  /**
   * 사용할 에이전트 버전
   * @remarks
   * - `'v1'`, `'v2'`, `'v12'` 등: 특정 버전 번호 (v + 숫자 형식)
   * - `'current'`: 현재 편집중인 버전 (기본값)
   * - `'production'`: 프로덕션으로 지정된 버전
   * - `undefined` 또는 미지정: 'current' 버전 사용
   */
  agentVersion?: string;

  /**
   * Vox.ai API 키
   * @remarks Vox.ai 대시보드에서 발급받을 수 있습니다.
   */
  apiKey: string;

  /**
   * 에이전트 대화에 전달할 동적 변수
   * @remarks
   * 에이전트 프롬프트에서 이 변수들을 참조하여 개인화된 대화를 만들 수 있습니다.
   * @example
   * ```tsx
   * dynamicVariables: {
   *   userName: '홍길동',
   *   userType: 'premium',
   *   accountBalance: 50000
   * }
   * ```
   */
  dynamicVariables?: Record<string, any>;

  /**
   * 통화 메타데이터
   * @remarks
   * 이 메타데이터는 아웃바운드 웹훅과 통화 기록에 포함되어,
   * 외부 시스템과의 연동이나 분석에 활용할 수 있습니다.
   * @example
   * ```tsx
   * metadata: {
   *   source: 'mobile-app',
   *   campaignId: 'spring-2024',
   *   customerId: 'cust_123'
   * }
   * ```
   */
  metadata?: Record<string, any>;
}

/**
 * Vox.ai 음성 AI를 React 애플리케이션에 통합하기 위한 훅입니다.
 *
 * @param options - 연결 이벤트에 대한 콜백 함수들을 설정하는 옵션 객체
 *
 * @returns 음성 AI를 제어하기 위한 메서드와 상태를 포함한 객체
 * - `connect`: Vox.ai 서버에 연결하는 함수
 * - `disconnect`: 연결을 종료하는 함수
 * - `state`: 에이전트의 현재 상태
 * - `messages`: 대화 메시지 배열
 * - `send`: 텍스트 메시지 또는 DTMF 숫자를 전송하는 함수
 * - `audioWaveform`: 실시간 오디오 파형 데이터를 가져오는 함수
 * - `toggleMic`: 마이크를 켜거나 끄는 함수
 * - `setVolume`: 에이전트 음성의 볼륨을 조절하는 함수
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const {
 *     connect,
 *     disconnect,
 *     state,
 *     messages,
 *     send,
 *     audioWaveform,
 *     toggleMic,
 *     setVolume
 *   } = useVoxAI({
 *     onConnect: () => console.log("연결됨"),
 *     onDisconnect: () => console.log("연결 종료"),
 *     onError: (error) => console.error("오류:", error),
 *     onMessage: (message) => console.log("새 메시지:", message)
 *   });
 *
 *   const handleConnect = () => {
 *     connect({
 *       agentId: 'my-agent-id',
 *       apiKey: 'my-api-key'
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={handleConnect}>연결</button>
 *       <button onClick={disconnect}>연결 해제</button>
 *       <p>상태: {state}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useVoxAI(options: VoxAIOptions = {}) {
  // Connection state
  const [connectionDetail, setConnectionDetail] =
    useState<VoxConnectionDetail | null>(null);
  const [state, setState] = useState<VoxAgentState>("disconnected");

  // Session timestamp to filter out stale asynchronous events
  const sessionTimestampRef = useRef<number>(Date.now());

  // Message handling
  const [transcriptMap, setTranscriptMap] = useState<Map<string, VoxMessage>>(
    new Map()
  );
  const [messages, setMessages] = useState<VoxMessage[]>([]);
  const prevMessagesRef = useRef<string>("");

  // Track which messages we've already sent to the onMessage callback
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  // DOM manipulation for LiveKit portal
  const portalRootRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  // Communication channel
  const channelRef = useRef<MessageChannel | null>(null);

  // Add this near the start of your useVoxAI hook
  const livekitComponentRef = useRef<React.ReactNode>(null);

  // Replace the single waveform state with a map for multiple speakers
  const [waveformDataMap, setWaveformDataMap] = useState<
    Record<string, number[]>
  >({
    agent: [],
    user: [],
  });

  // Add back the waveform config reference
  const waveformConfigRef = useRef<{
    speaker?: "agent" | "user";
    barCount: number;
    updateInterval: number;
  } | null>(null);

  // Add a new state to track microphone status
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(true);

  // Update messages whenever transcriptMap changes
  useEffect(() => {
    const allMessages = Array.from(transcriptMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

    // Only update if the messages have actually changed
    const messagesString = JSON.stringify(allMessages);
    if (messagesString !== prevMessagesRef.current) {
      prevMessagesRef.current = messagesString;
      setMessages(allMessages);

      // Only trigger onMessage for new final messages that haven't been processed yet
      if (options.onMessage) {
        allMessages
          .filter(
            (msg) =>
              msg.isFinal &&
              msg.id &&
              !processedMessageIdsRef.current.has(msg.id)
          )
          .forEach((msg) => {
            if (msg.id) {
              // Mark this message as processed
              processedMessageIdsRef.current.add(msg.id);
              // Call the callback
              options.onMessage?.(msg);
            }
          });
      }
    }
  }, [transcriptMap, options.onMessage]);

  // Initialize message channel - ensure ports are properly connected
  useEffect(() => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (e) => {
      const data = e.data as MessageChannelEvent;

      if (data.type === "state_update") {
        setState(data.state);
      } else if (data.type === "transcription_update") {
        handleTranscriptionUpdate(data.transcriptions);
      } else if (data.type === "waveform_update" && data.speaker) {
        // Store the waveform data for the specific speaker
        setWaveformDataMap((prevMap) => ({
          ...prevMap,
          [data.speaker]: data.waveformData,
        }));
      } else if (data.type === "function_tools_executed" && data.tool) {
        // Handle function calls
        const functionCallsId = `function-calls-${Date.now()}`;
        setTranscriptMap((prevMap) => {
          const newMap = new Map(prevMap);
          newMap.set(functionCallsId, {
            id: functionCallsId,
            name: "tool",
            tool: data.tool,
            timestamp: Date.now(),
            isFinal: true,
          });
          return newMap;
        });
      }
    };

    // Start the port
    channel.port1.start();

    // Store the channel reference
    channelRef.current = channel;

    return () => {
      channelRef.current?.port1.close();
      channelRef.current?.port2.close();
      channelRef.current = null;
    };
  }, []);

  // Process incoming transcriptions and filter out stale events
  const handleTranscriptionUpdate = useCallback(
    (transcriptions: TranscriptionSegment[]) => {
      setTranscriptMap((prevMap) => {
        const newMap = new Map(prevMap);

        transcriptions.forEach((t) => {
          // Only process transcriptions generated after the current session timestamp
          if (t.timestamp < sessionTimestampRef.current) {
            return;
          }
          const messageType = t.speaker === "agent" ? "agent" : "user";
          // Use existing timestamp if we already have this segment
          const existingTimestamp = prevMap.get(t.id)?.timestamp || t.timestamp;

          newMap.set(t.id, {
            id: t.id,
            name: messageType,
            message: t.text,
            timestamp: existingTimestamp,
            isFinal: t.isFinal,
          });
        });

        return newMap;
      });
    },
    []
  );

  // Set up DOM portal for LiveKit
  useEffect(() => {
    const div = document.createElement("div");
    div.style.display = "none";
    document.body.appendChild(div);
    portalRootRef.current = div;
    rootRef.current = createRoot(div);

    return () => {
      if (rootRef.current) {
        rootRef.current.unmount();
      }
      if (portalRootRef.current) {
        document.body.removeChild(portalRootRef.current);
      }
    };
  }, []);

  /**
   * Vox.ai 음성 AI 서버에 연결합니다.
   *
   * @param params - 연결에 필요한 매개변수 ({@link ConnectParams} 참조)
   *
   * @remarks
   * - 이미 연결된 상태에서 호출하면 오류가 발생합니다.
   * - 연결에 성공하면 `onConnect` 콜백이 호출됩니다.
   * - 연결에 실패하면 `onError` 콜백이 호출됩니다.
   * - 연결 성공 후 상태가 `connecting` → `initializing` → `listening`으로 변화합니다.
   *
   * @throws {Error} 이미 연결된 상태이거나 인증에 실패한 경우
   *
   * @example
   * ```tsx
   * const { connect } = useVoxAI();
   *
   * // 기본 연결
   * await connect({
   *   agentId: 'agent_abc123',
   *   apiKey: 'key_xyz789'
   * });
   *
   * // 특정 버전과 동적 변수로 연결
   * await connect({
   *   agentId: 'agent_abc123',
   *   agentVersion: 'v5',
   *   apiKey: 'key_xyz789',
   *   dynamicVariables: {
   *     userName: '홍길동',
   *     userId: 'user_123'
   *   }
   * });
   * ```
   */
  const connect = useCallback(
    async ({
      agentId,
      agentVersion,
      apiKey,
      dynamicVariables,
      metadata,
    }: ConnectParams) => {
      try {
        // Prevent connecting if already in a connection state
        if (state !== "disconnected") {
          const errorMessage = `Connection attempt rejected: Already in a connection state (${state})`;
          console.warn(errorMessage);

          if (options.onError) {
            options.onError(new Error(errorMessage));
          }
          return Promise.reject(new Error(errorMessage));
        }

        // Update session timestamp for new connection
        sessionTimestampRef.current = Date.now();
        setState("connecting");

        const requestBody: any = {
          agent_id: agentId,
          agent_version: agentVersion || "current",
          metadata: {
            runtime_context: {
              source: {
                type: "react-sdk",
                version: SDK_VERSION,
              },
            },
            call_web: {
              dynamic_variables: dynamicVariables || {},
              metadata: metadata || {},
            },
          },
        };

        const response = await fetch(HTTPS_API_ORIGIN, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Connection failed (${response.status}): ${errorText}`
          );
        }

        const data = await response.json();
        setConnectionDetail(data);

        if (options.onConnect) {
          options.onConnect();
        }
      } catch (err) {
        setConnectionDetail(null);
        setTranscriptMap(new Map());
        setMessages([]);
        setState("disconnected");

        const error = err instanceof Error ? err : new Error(String(err));

        if (options.onError) {
          options.onError(error);
        }
      }
    },
    [options, state]
  );

  /**
   * 음성 AI 연결을 종료합니다.
   *
   * @remarks
   * - 연결이 종료되면 `onDisconnect` 콜백이 호출됩니다.
   * - 모든 메시지와 상태가 초기화됩니다.
   * - 상태가 `disconnected`로 변경됩니다.
   * - 연결되지 않은 상태에서 호출해도 안전합니다.
   *
   * @example
   * ```tsx
   * const { disconnect } = useVoxAI();
   *
   * // 연결 종료
   * disconnect();
   * ```
   */
  const disconnect = useCallback(() => {
    // Update session timestamp on disconnect
    sessionTimestampRef.current = Date.now();
    setConnectionDetail(null);
    setTranscriptMap(new Map());
    setMessages([]);
    setState("disconnected");

    if (options.onDisconnect) {
      options.onDisconnect();
    }
  }, [options]);

  /**
   * 에이전트에게 텍스트 메시지를 전송하거나 DTMF 숫자를 입력합니다.
   *
   * @param params - 전송할 메시지 또는 DTMF 숫자
   * @param params.message - 전송할 텍스트 메시지 (음성 대신 텍스트로 입력)
   * @param params.digit - 전송할 DTMF 숫자 (0-9, *, #에 해당하는 숫자)
   *
   * @remarks
   * - 연결되지 않은 상태에서 호출하면 경고 메시지가 출력되고 무시됩니다.
   * - `message`와 `digit`을 동시에 전달할 수 있습니다.
   * - 텍스트 메시지는 음성 입력 대신 사용할 수 있습니다.
   * - DTMF는 전화번호 입력 등에 활용됩니다.
   *
   * @example
   * ```tsx
   * const { send } = useVoxAI();
   *
   * // 텍스트 메시지 전송
   * send({ message: '안녕하세요' });
   *
   * // DTMF 숫자 전송
   * send({ digit: 1 });
   *
   * // 둘 다 전송
   * send({ message: '1번을 선택합니다', digit: 1 });
   * ```
   */
  const send = useCallback(
    ({ message, digit }: { message?: string; digit?: number }) => {
      if (state === "disconnected") {
        console.warn("Cannot send message: Not connected to a conversation");
        return;
      }

      if (message) {
        const messageId = `user-text-${Date.now()}`;
        setTranscriptMap((prevMap) => {
          const newMap = new Map(prevMap);
          newMap.set(messageId, {
            id: messageId,
            name: "user",
            message: message,
            timestamp: Date.now(),
            isFinal: true,
          });
          return newMap;
        });

        if (channelRef.current) {
          channelRef.current.port1.postMessage({
            type: "send_text",
            text: message,
          });
        } else {
          console.error("No message channel available to send message");
        }
      }

      if (digit !== undefined) {
        if (channelRef.current) {
          channelRef.current.port1.postMessage({
            type: "send_dtmf",
            digit: digit,
          });
        } else {
          console.error("No message channel available to send DTMF");
        }
      }
    },
    [state]
  );

  /**
   * 실시간 오디오 파형 데이터를 가져옵니다.
   *
   * @param params - 파형 설정 옵션
   * @param params.speaker - 파형을 가져올 대상 (`"agent"` 또는 `"user"`, 기본값: `"agent"`)
   * @param params.barCount - 반환할 파형 막대 개수 (기본값: 10)
   * @param params.updateInterval - 파형 업데이트 간격 (밀리초, 기본값: 20)
   *
   * @returns 0~1 사이의 값을 가진 숫자 배열 (길이는 `barCount`와 동일)
   *
   * @remarks
   * - 각 값은 해당 주파수 대역의 음량을 나타냅니다 (0: 무음, 1: 최대 음량).
   * - 음성 시각화 UI를 만들 때 유용합니다.
   * - 연결되지 않은 상태에서는 모두 0으로 채워진 배열을 반환합니다.
   *
   * @example
   * ```tsx
   * const { audioWaveform, state } = useVoxAI();
   *
   * // 렌더링 루프에서 사용
   * useEffect(() => {
   *   const interval = setInterval(() => {
   *     // 에이전트의 파형 데이터 (20개 막대)
   *     const agentWaveform = audioWaveform({
   *       speaker: 'agent',
   *       barCount: 20
   *     });
   *
   *     // 사용자의 파형 데이터
   *     const userWaveform = audioWaveform({
   *       speaker: 'user',
   *       barCount: 20
   *     });
   *
   *     // 시각화 업데이트
   *     updateVisualization(agentWaveform, userWaveform);
   *   }, 50);
   *
   *   return () => clearInterval(interval);
   * }, []);
   * ```
   */
  const audioWaveform = useCallback(
    ({
      speaker = "agent",
      barCount = 10,
      updateInterval = 20,
    }: {
      speaker?: "agent" | "user";
      barCount?: number;
      updateInterval?: number;
    }): number[] => {
      waveformConfigRef.current = { speaker, barCount, updateInterval };

      if (channelRef.current) {
        channelRef.current.port1.postMessage({
          type: "waveform_config",
          config: { speaker, barCount, updateInterval },
        });
      }

      const speakerData = waveformDataMap[speaker] || [];
      return speakerData.length > 0
        ? speakerData.slice(0, barCount)
        : Array(barCount).fill(0);
    },
    [waveformDataMap]
  );

  /**
   * 사용자의 마이크를 켜거나 끕니다.
   *
   * @param value - `true`면 마이크 켜기, `false`면 마이크 끄기
   *
   * @remarks
   * - 마이크를 끄면 에이전트가 사용자의 음성을 듣지 못합니다.
   * - 음성 인식도 중단됩니다.
   * - 프라이버시나 소음 차단이 필요할 때 유용합니다.
   *
   * @example
   * ```tsx
   * const { toggleMic } = useVoxAI();
   *
   * // 마이크 끄기
   * toggleMic(false);
   *
   * // 마이크 켜기
   * toggleMic(true);
   *
   * // 토글 버튼 예제
   * const [isMuted, setIsMuted] = useState(false);
   * const handleToggle = () => {
   *   setIsMuted(!isMuted);
   *   toggleMic(!isMuted);
   * };
   * ```
   */
  const toggleMic = useCallback((value: boolean) => {
    setIsMicEnabled(value);
    if (channelRef.current) {
      channelRef.current.port1.postMessage({
        type: "toggle_mic",
        enabled: value,
      });
    } else {
      console.error("No message channel available to toggle microphone");
    }
  }, []);

  /**
   * 에이전트 음성의 볼륨을 설정합니다.
   *
   * @param volume - 볼륨 크기 (0.0 ~ 1.0 사이의 값, 0: 무음, 1: 최대 음량)
   *
   * @remarks
   * - 범위를 벗어난 값은 자동으로 0~1 사이로 조정됩니다.
   * - 예: `-0.5` → `0`, `1.5` → `1`
   * - 사용자의 환경에 따라 적절한 볼륨을 설정할 수 있습니다.
   *
   * @example
   * ```tsx
   * const { setVolume } = useVoxAI();
   *
   * // 볼륨을 50%로 설정
   * setVolume(0.5);
   *
   * // 볼륨을 최대로 설정
   * setVolume(1.0);
   *
   * // 볼륨 슬라이더 예제
   * const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
   *   const newVolume = parseFloat(e.target.value);
   *   setVolume(newVolume);
   * };
   *
   * <input
   *   type="range"
   *   min="0"
   *   max="1"
   *   step="0.1"
   *   onChange={handleVolumeChange}
   * />
   * ```
   */
  const setVolume = useCallback((volume: number) => {
    const validVolume = Math.min(Math.max(volume, 0), 1);
    if (channelRef.current) {
      channelRef.current.port1.postMessage({
        type: "set_volume",
        volume: validVolume,
      });
    } else {
      console.error("No message channel available to set volume");
    }
  }, []);

  // Modify the useEffect hook that renders the LiveKit component
  useEffect(() => {
    if (!rootRef.current) return;

    if (connectionDetail) {
      if (!livekitComponentRef.current) {
        if (channelRef.current) {
          channelRef.current.port2.start();
        }

        livekitComponentRef.current = (
          <LiveKitRoom
            serverUrl={connectionDetail.serverUrl}
            token={connectionDetail.participantToken}
            audio={true}
            video={false}
            connect={true}
            onDisconnected={disconnect}
            onError={(error) => {
              console.error("LiveKit connection error:", error);
              disconnect();
              if (options.onError) {
                options.onError(
                  new Error(`LiveKit connection error: ${error.message}`)
                );
              }
            }}
          >
            <RoomAudioRenderer />
            {channelRef.current && (
              <StateMonitor
                port={channelRef.current.port2}
                initialConfig={
                  waveformConfigRef.current || {
                    barCount: 10,
                    updateInterval: 20,
                  }
                }
              />
            )}
          </LiveKitRoom>
        );
      }
      rootRef.current.render(livekitComponentRef.current);
    } else {
      livekitComponentRef.current = null;
      rootRef.current.render(<></>);
    }
  }, [connectionDetail, disconnect, options.onError]);

  return {
    connect,
    disconnect,
    state,
    messages,
    send,
    audioWaveform,
    toggleMic,
    setVolume,
  };
}

/**
 * Component that monitors LiveKit state and communicates back to the main hook
 */
function StateMonitor({
  port,
  initialConfig,
}: {
  port: MessagePort | undefined;
  initialConfig: {
    speaker?: "agent" | "user";
    barCount: number;
    updateInterval: number;
  };
}) {
  const { agent, state } = useVoiceAssistant();
  const { send: sendChat } = useChat();

  // Initialize waveform config with the passed initial values, defaulting to "agent" if not specified
  const [waveformConfig, setWaveformConfig] = useState({
    speaker: initialConfig.speaker || "agent",
    barCount: initialConfig.barCount,
    updateInterval: initialConfig.updateInterval,
  });

  // Agent transcriptions
  const agentAudioTrack = useParticipantTracks(
    [Track.Source.Microphone],
    agent?.identity
  )[0];
  const agentTranscription = useTrackTranscription(agentAudioTrack);

  // Use the current config for the waveform, applying different settings based on speaker
  const agentAudioWaveform = useAudioWaveform(agentAudioTrack, {
    barCount:
      waveformConfig.speaker === "agent" ? waveformConfig.barCount : 120, // default if not the selected speaker
    updateInterval:
      waveformConfig.speaker === "agent" ? waveformConfig.updateInterval : 20,
  });

  // User transcriptions
  const localParticipant = useLocalParticipant();
  const localMessages = useTrackTranscription({
    publication: localParticipant.microphoneTrack,
    source: Track.Source.Microphone,
    participant: localParticipant.localParticipant,
  });
  const localAudioTrack = useParticipantTracks(
    [Track.Source.Microphone],
    localParticipant.localParticipant.identity
  )[0];
  const userAudioWaveform = useAudioWaveform(localAudioTrack, {
    barCount: waveformConfig.speaker === "user" ? waveformConfig.barCount : 120, // default if not the selected speaker
    updateInterval:
      waveformConfig.speaker === "user" ? waveformConfig.updateInterval : 20,
  });

  // Add separate effects to send agent and user waveform data
  useEffect(() => {
    if (!port || !agentAudioWaveform || !agentAudioWaveform.bars) return;

    // Send the agent waveform data
    port.postMessage({
      type: "waveform_update",
      waveformData: agentAudioWaveform.bars,
      speaker: "agent",
    });
  }, [port, agentAudioWaveform]);

  useEffect(() => {
    if (!port || !userAudioWaveform || !userAudioWaveform.bars) return;

    // Send the user waveform data
    port.postMessage({
      type: "waveform_update",
      waveformData: userAudioWaveform.bars,
      speaker: "user",
    });
  }, [port, userAudioWaveform]);

  // Listen for messages including config updates and mic toggle commands
  useEffect(() => {
    if (!port) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;

      if (data.type === "waveform_config" && data.config) {
        // Verify we have both required properties before updating
        if (
          typeof data.config.barCount === "number" &&
          typeof data.config.updateInterval === "number"
        ) {
          setWaveformConfig(data.config);
        }
      } else if (data.type === "send_text") {
        if (sendChat) {
          sendChat(data.text);
        } else {
          console.error("sendChat function is not available");
        }
      } else if (data.type === "send_dtmf") {
        if (localParticipant.localParticipant) {
          // Use standard DTMF code (RFC 4733)
          const standardDtmfCode = 101; // Standard DTMF payload type
          localParticipant.localParticipant.publishDtmf(
            standardDtmfCode,
            data.digit
          );
        } else {
          console.error("Local participant is not available for DTMF");
        }
      } else if (
        data.type === "toggle_mic" &&
        typeof data.enabled === "boolean"
      ) {
        // Handle microphone toggle
        if (localParticipant.localParticipant) {
          localParticipant.localParticipant
            .setMicrophoneEnabled(data.enabled)
            .catch((error) => {
              console.error("Failed to toggle microphone:", error);
            });
        } else {
          console.error("Local participant is not available for mic toggle");
        }
      } else if (
        data.type === "set_volume" &&
        typeof data.volume === "number"
      ) {
        // Handle volume control
        if (agent) {
          // The agent is a RemoteParticipant, so we can call setVolume directly
          try {
            agent.setVolume(data.volume);
            console.log(`Set agent volume to ${data.volume}`);
          } catch (error) {
            console.error("Failed to set agent volume:", error);
          }
        } else {
          console.error("Agent is not available for volume control");
        }
      }
    };

    // Make sure we start the port
    port.start();

    port.addEventListener("message", handleMessage);

    return () => {
      port.removeEventListener("message", handleMessage);
    };
  }, [port, sendChat, localParticipant, agent]);

  // Send agent state updates
  useEffect(() => {
    if (port) {
      port.postMessage({ type: "state_update", state });
    }
  }, [state, port]);

  // Send agent transcriptions
  useEffect(() => {
    if (port && agentTranscription.segments.length > 0) {
      const transcriptions = agentTranscription.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        isFinal: segment.final,
        timestamp: Date.now(),
        speaker: "agent" as const,
      }));

      port.postMessage({
        type: "transcription_update",
        transcriptions,
      });
    }
  }, [agentTranscription.segments, port]);

  // Send user transcriptions
  useEffect(() => {
    if (port && localMessages.segments.length > 0) {
      const transcriptions = localMessages.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        isFinal: segment.final,
        timestamp: Date.now(),
        speaker: "user" as const,
      }));

      port.postMessage({
        type: "transcription_update",
        transcriptions,
      });
    }
  }, [localMessages.segments, port]);

  // Add data channel hook for function calls
  const { message: functionToolsExecuted } = useDataChannel(
    "function_tools_executed",
    (msg) => {
      if (!port) return;

      const textDecoder = new TextDecoder();
      const messageString =
        msg.payload instanceof Uint8Array
          ? textDecoder.decode(msg.payload)
          : String(msg.payload);

      let tool: FunctionToolsExecuted;
      try {
        tool = JSON.parse(messageString);

        // Send function calls to main hook via the port
        port.postMessage({
          type: "function_tools_executed",
          tool: tool,
        });
      } catch (e) {
        console.error("Failed to parse function call log:", e);
      }
    }
  );

  return null;
}
