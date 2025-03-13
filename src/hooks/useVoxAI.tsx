import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipantTracks,
  useTrackTranscription,
  useVoiceAssistant,
  useChat,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

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

// API endpoint
const HTTPS_API_ORIGIN = "https://www.tryvox.co/api/agent/sdk";
// const HTTPS_API_ORIGIN = "http://localhost:3000/api/agent/sdk";

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
  | { type: "transcription_update"; transcriptions: TranscriptionSegment[] };

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
      }
    };

    // Store the channel reference
    channelRef.current = channel;

    return () => {
      channelRef.current?.port1.close();
      channelRef.current?.port2.close();
      channelRef.current = null;
    };
  }, []);

  // Process incoming transcriptions
  const handleTranscriptionUpdate = useCallback(
    (transcriptions: TranscriptionSegment[]) => {
      setTranscriptMap((prevMap) => {
        const newMap = new Map(prevMap);

        transcriptions.forEach((t) => {
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
        // Reset state on error
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
    [options]
  );

  // Disconnect from VoxAI service
  const disconnect = useCallback(() => {
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
        // Add the message to our local transcript map for immediate feedback
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

        // Send message through the message channel to StateMonitor
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
        // Send DTMF through the message channel to StateMonitor
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

  // Modify the useEffect hook that renders the LiveKit component
  useEffect(() => {
    if (!rootRef.current) return;

    if (connectionDetail) {
      // Only create a new LiveKit component if we don't have one or connection details changed
      if (!livekitComponentRef.current) {
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
              <StateMonitor port={channelRef.current.port2} />
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
  };
}

/**
 * Component that monitors LiveKit state and communicates back to the main hook
 */
function StateMonitor({ port }: { port: MessagePort | undefined }) {
  const { agent, state } = useVoiceAssistant();
  const { send: sendChat } = useChat();

  // Agent transcriptions
  const agentAudioTrack = useParticipantTracks(
    [Track.Source.Microphone],
    agent?.identity
  )[0];
  const agentTranscription = useTrackTranscription(agentAudioTrack);

  // User transcriptions
  const localParticipant = useLocalParticipant();
  const localMessages = useTrackTranscription({
    publication: localParticipant.microphoneTrack,
    source: Track.Source.Microphone,
    participant: localParticipant.localParticipant,
  });

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

  // Listen for messages from the main component
  useEffect(() => {
    if (!port) {
      console.error("No message port available in StateMonitor");
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;

      if (data.type === "send_text") {
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
      }
    };

    // Make sure to start the port
    port.start();

    port.addEventListener("message", handleMessage);

    return () => {
      port.removeEventListener("message", handleMessage);
    };
  }, [port, sendChat, localParticipant]);

  return null;
}
