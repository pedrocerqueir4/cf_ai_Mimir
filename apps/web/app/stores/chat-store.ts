import { create } from "zustand";
import type { ChatMessage, GenerationStatus as GenerationStatusBase } from "~/lib/api-client";

export interface GenerationStatus extends GenerationStatusBase {
  workflowRunId: string;
}

interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  generationStatus: GenerationStatus | null;

  // Actions
  setConversationId: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  setStreaming: (val: boolean) => void;
  setGenerationStatus: (status: GenerationStatus | null) => void;
  appendToLastMessage: (text: string) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  generationStatus: null,

  setConversationId: (id: string) =>
    set({ conversationId: id }),

  addMessage: (msg: ChatMessage) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setStreaming: (val: boolean) =>
    set({ isStreaming: val }),

  setGenerationStatus: (status: GenerationStatus | null) =>
    set({ generationStatus: status }),

  appendToLastMessage: (text: string) =>
    set((state) => {
      const messages = [...state.messages];
      const lastIndex = messages.length - 1;
      if (lastIndex < 0) return state;
      const last = messages[lastIndex];
      messages[lastIndex] = {
        ...last,
        content: last.content + text,
      };
      return { messages };
    }),

  clearMessages: () =>
    set({ messages: [], generationStatus: null }),
}));
