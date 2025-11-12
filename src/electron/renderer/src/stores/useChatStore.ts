import { create } from 'zustand';
import type { Message, StreamingMessage } from '../types/dml';

// Batch streaming updates to reduce re-renders
let streamingBuffer = '';
let streamingFlushTimeout: NodeJS.Timeout | null = null;
const STREAMING_FLUSH_INTERVAL = 50; // Update UI every 50ms instead of every chunk

interface ChatState {
  messages: Message[];
  streamingMessage: StreamingMessage | null;

  // Actions
  addMessage: (type: Message['type'], content: string, raw?: boolean) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;

  // Streaming
  startStreaming: () => void;
  appendToStreaming: (chunk: string) => void;
  finalizeStreaming: () => void;
  flushStreamingBuffer: () => void; // Internal method to flush buffer
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streamingMessage: null,

  addMessage: (type, content, raw = false) => {
    const message: Message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      type,
      content,
      timestamp: new Date(),
      raw,
    };
    set((state) => ({
      messages: [...state.messages, message],
    }));
  },

  setMessages: (messages) => {
    set({ messages });
  },

  clearMessages: () => set({ messages: [] }),

  startStreaming: () => {
    streamingBuffer = ''; // Reset buffer
    if (streamingFlushTimeout) {
      clearTimeout(streamingFlushTimeout);
      streamingFlushTimeout = null;
    }
    set({
      streamingMessage: {
        id: `stream-${Date.now()}`,
        content: '',
        timestamp: new Date(),
      },
    });
  },

  appendToStreaming: (chunk) => {
    streamingBuffer += chunk;
    
    // Schedule flush if not already scheduled
    if (!streamingFlushTimeout) {
      streamingFlushTimeout = setTimeout(() => {
        streamingFlushTimeout = null;
        get().flushStreamingBuffer();
      }, STREAMING_FLUSH_INTERVAL);
    }
  },

  flushStreamingBuffer: () => {
    if (!streamingBuffer) return;
    
    const bufferCopy = streamingBuffer;
    streamingBuffer = '';
    
    set((state) => {
      if (!state.streamingMessage) {
        // Create new streaming message if none exists
        return {
          streamingMessage: {
            id: `stream-${Date.now()}`,
            content: bufferCopy,
            timestamp: new Date(),
          },
        };
      }
      return {
        streamingMessage: {
          ...state.streamingMessage,
          content: state.streamingMessage.content + bufferCopy,
        },
      };
    });
  },

  finalizeStreaming: () => {
    // Flush any remaining buffered content
    if (streamingFlushTimeout) {
      clearTimeout(streamingFlushTimeout);
      streamingFlushTimeout = null;
    }
    if (streamingBuffer) {
      get().flushStreamingBuffer();
    }
    
    const { streamingMessage } = get();
    if (streamingMessage && streamingMessage.content) {
      const message: Message = {
        id: streamingMessage.id,
        type: 'agent',
        content: streamingMessage.content,
        timestamp: streamingMessage.timestamp,
        raw: false, // Process with markdown and log extraction
      };
      set((state) => ({
        messages: [...state.messages, message],
        streamingMessage: null,
      }));
    } else {
      set({ streamingMessage: null });
    }
  },
}));
