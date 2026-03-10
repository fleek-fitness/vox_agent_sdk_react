import {
  Conversation,
  type ConversationMessage,
  type ConversationMode,
  type ConversationSource,
  type ConversationStatus,
  type InputDeviceConfig,
  type OutputDeviceConfig,
  type SetVolumeParams,
  type StartSessionOptions,
} from "@vox-ai/client";
import { useCallback, useMemo, useRef, useState } from "react";

type HookCallbacks = Pick<
  StartSessionOptions,
  | "onConnect"
  | "onDisconnect"
  | "onError"
  | "onMessage"
  | "onStatusChange"
  | "onModeChange"
>;

export type UseConversationOptions = HookCallbacks & {
  textOnly?: boolean;
};

export type StartConversationOptions = Omit<
  StartSessionOptions,
  keyof HookCallbacks
>;

export function useConversation(options: UseConversationOptions = {}) {
  const conversationRef = useRef<Conversation | null>(null);
  const messageMapRef = useRef<Map<string, ConversationMessage>>(new Map());

  const [status, setStatus] = useState<ConversationStatus>("disconnected");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micMuted, setMicMutedState] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);

  const startSession = useCallback(
    async (params: StartConversationOptions): Promise<string> => {
      if (conversationRef.current) {
        await conversationRef.current.endSession();
        conversationRef.current = null;
      }

      messageMapRef.current = new Map();
      setMessages([]);

      const conversation = await Conversation.startSession({
        ...params,
        textOnly: params.textOnly ?? options.textOnly,
        onConnect: () => {
          setStatus("connected");
          options.onConnect?.();
        },
        onDisconnect: () => {
          setStatus("disconnected");
          setIsSpeaking(false);
          options.onDisconnect?.();
        },
        onError: (error) => {
          options.onError?.(error);
        },
        onMessage: (message) => {
          messageMapRef.current.set(message.id, message);
          setMessages(
            Array.from(messageMapRef.current.values()).sort(
              (a, b) => a.timestamp - b.timestamp,
            ),
          );
          options.onMessage?.(message);
        },
        onStatusChange: (nextStatus) => {
          setStatus(nextStatus);
          options.onStatusChange?.(nextStatus);
        },
        onModeChange: (mode) => {
          setIsSpeaking(mode === "speaking");
          options.onModeChange?.(mode);
        },
      });

      conversationRef.current = conversation;
      setStatus(conversation.getStatus());
      setMicMutedState(conversation.getMicMuted());
      setIsSpeaking(conversation.getMode() === "speaking");

      return conversation.getId() ?? "";
    },
    [options],
  );

  const endSession = useCallback(async () => {
    if (!conversationRef.current) return;
    await conversationRef.current.endSession();
    conversationRef.current = null;
    setStatus("disconnected");
    setIsSpeaking(false);
  }, []);

  const getId = useCallback(() => {
    return conversationRef.current?.getId();
  }, []);

  const getMessages = useCallback(() => {
    return conversationRef.current?.getMessages() ?? messages;
  }, [messages]);

  const setVolume = useCallback((volume: { volume: number }) => {
    conversationRef.current?.setVolume(volume);
  }, []);

  const setMicMuted = useCallback(async (isMuted: boolean) => {
    if (!conversationRef.current) return;
    await conversationRef.current.setMicMuted(isMuted);
    setMicMutedState(conversationRef.current.getMicMuted());
  }, []);

  const sendUserMessage = useCallback(async (text: string) => {
    if (!conversationRef.current) return;
    await conversationRef.current.sendUserMessage(text);
  }, []);

  const changeInputDevice = useCallback(async (config: InputDeviceConfig) => {
    if (!conversationRef.current) return false;
    return conversationRef.current.changeInputDevice(config);
  }, []);

  const changeOutputDevice = useCallback(async (config: OutputDeviceConfig) => {
    if (!conversationRef.current) return false;
    return conversationRef.current.changeOutputDevice(config);
  }, []);

  const getInputVolume = useCallback(() => {
    return conversationRef.current?.getInputVolume() ?? 0;
  }, []);

  const getOutputVolume = useCallback(() => {
    return conversationRef.current?.getOutputVolume() ?? 0;
  }, []);

  const getInputByteFrequencyData = useCallback(() => {
    return conversationRef.current?.getInputByteFrequencyData();
  }, []);

  const getOutputByteFrequencyData = useCallback(() => {
    return conversationRef.current?.getOutputByteFrequencyData();
  }, []);

  return useMemo(
    () => ({
      startSession,
      endSession,
      getId,
      getMessages,
      setVolume,
      setMicMuted,
      sendUserMessage,
      changeInputDevice,
      changeOutputDevice,
      getInputVolume,
      getOutputVolume,
      getInputByteFrequencyData,
      getOutputByteFrequencyData,
      messages,
      status,
      isSpeaking,
      micMuted,
    }),
    [
      startSession,
      endSession,
      getId,
      getMessages,
      setVolume,
      setMicMuted,
      sendUserMessage,
      changeInputDevice,
      changeOutputDevice,
      getInputVolume,
      getOutputVolume,
      getInputByteFrequencyData,
      getOutputByteFrequencyData,
      messages,
      status,
      isSpeaking,
      micMuted,
    ],
  );
}

export type {
  ConversationMessage,
  ConversationMode,
  ConversationSource,
  ConversationStatus,
  InputDeviceConfig,
  OutputDeviceConfig,
  SetVolumeParams,
};
