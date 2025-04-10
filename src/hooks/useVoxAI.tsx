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
 * VoxAgentState
 * @description The state of the agent
 */
export type VoxAgentState =
  | "disconnected"
  | "connecting"
  | "initializing"
  | "listening"
  | "thinking"
  | "speaking";

/**
 * Function call related types
 */
export interface FunctionToolsExecuted {
  type: "function_tools_executed";
  function_calls: FunctionCallInfo[];
  function_call_outputs: FunctionCallResult[];
}

export interface FunctionCallInfo {
  id: string;
  type: string;
  call_id: string;
  arguments: string;
  name: string;
}

export interface FunctionCallResult {
  id: string;
  name: string;
  type: string;
  call_id: string;
  output: string;
  is_error: boolean;
}

/**
 * VoxMessage
 * @description The message type between the agent and the user
 */
export type VoxMessage = {
  id?: string;
  name: "agent" | "user" | "tool";
  message?: string;
  timestamp: number;
  isFinal?: boolean;
  tool?: FunctionToolsExecuted;
};

/**
 * VoxAIOptions
 * @description The callback functions for the useVoxAI hook
 */
export interface VoxAIOptions {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
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
 * ConnectParams
 * @param agentId - The agent ID
 * @param apiKey - The API key
 * @param dynamicVariables - The dynamic variables
 * @param metadata - 이 메타데이터는 아웃바운드 웹훅, 통화 기록에 포함됩니다.
 */
export interface ConnectParams {
  agentId: string;
  apiKey: string;
  dynamicVariables?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * useVoxAI
 * @description The hook for integrating with vox.ai voice assistant
 * @param options - The options for the useVoxAI hook
 * @returns The useVoxAI hook
 * @example
 * const { connect, disconnect, state, messages, send } = useVoxAI({
 *   onConnect: () => console.log("Connected"),
 *   onDisconnect: () => console.log("Disconnected"),
 *   onError: (error) => console.error("Error:", error),
 *   onMessage: (message) => console.log("Message:", message),
 * });
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

  // Connect to VoxAI service - updated to include dynamicVariables
  const connect = useCallback(
    async ({ agentId, apiKey, dynamicVariables, metadata }: ConnectParams) => {
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

        const response = await fetch(HTTPS_API_ORIGIN, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: agentId,
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
          }),
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

  // Disconnect from VoxAI service, updating the session timestamp to ignore stale events
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

  // Update the send function with debugging and error checking
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

  // Update the audioWaveform function to return data for the requested speaker
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

  // Add toggleMic function that will be exposed in the hook's return value
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

  // Add setVolume function that will be exposed in the hook's return value
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
