import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipantTracks,
  useTrackTranscription,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";

// Connection types
type VoxConnectionDetail = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

type VoxAgentState =
  | "disconnected"
  | "connecting"
  | "initializing"
  | "listening"
  | "thinking"
  | "speaking";

// API endpoint
const HTTPS_API_ORIGIN = "https://www.tryvox.co/api/agent/sdk";
// const HTTPS_API_ORIGIN = "http://localhost:3000/api/agent/sdk";

export type VoxMessage = {
  id?: string;
  name: "agent" | "user" | "tool";
  message?: string;
  timestamp: number;
  isFinal?: boolean;
};

// Hook configuration
interface VoxAIOptions {
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

// Update the connection parameter type to include metadata
interface ConnectParams {
  agentId: string;
  apiKey: string;
  metadata?: Record<string, any>; // Allow any metadata fields
}

/**
 * Hook for integrating with VoxAI voice assistant
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

  // Initialize message channel
  useEffect(() => {
    channelRef.current = new MessageChannel();
    channelRef.current.port1.onmessage = (e) => {
      const data = e.data as MessageChannelEvent;

      if (data.type === "state_update") {
        setState(data.state);
      } else if (data.type === "transcription_update") {
        handleTranscriptionUpdate(data.transcriptions);
      }
    };

    return () => {
      channelRef.current?.port1.close();
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

  // Connect to VoxAI service - updated to include metadata
  const connect = useCallback(
    async ({ agentId, apiKey, metadata }: ConnectParams) => {
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
                dynamic_variables: metadata || {},
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

  // Render LiveKit components when connection details are available
  useEffect(() => {
    if (!rootRef.current) return;

    if (connectionDetail) {
      rootRef.current.render(
        <LiveKitRoom
          serverUrl={connectionDetail.serverUrl}
          token={connectionDetail.participantToken}
          audio={true}
          video={false}
          connect={true}
          onDisconnected={disconnect}
        >
          <RoomAudioRenderer />
          <StateMonitor port={channelRef.current?.port2} />
        </LiveKitRoom>
      );
    } else {
      rootRef.current.render(<></>);
    }
  }, [connectionDetail, disconnect]);

  return {
    connect,
    disconnect,
    state,
    messages,
  };
}

/**
 * Component that monitors LiveKit state and communicates back to the main hook
 */
function StateMonitor({ port }: { port: MessagePort | undefined }) {
  const { agent, state } = useVoiceAssistant();

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

  return null;
}
