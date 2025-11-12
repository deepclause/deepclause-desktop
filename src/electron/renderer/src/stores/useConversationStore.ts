import { create } from 'zustand';

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ConversationState {
  currentConversationId: string | null;
  currentConversationTitle: string;
  conversations: ConversationMetadata[];
  isLoading: boolean;

  // Actions
  setCurrentConversation: (id: string, title: string) => void;
  setConversations: (conversations: ConversationMetadata[]) => void;
  setLoading: (loading: boolean) => void;
  updateConversationTitle: (title: string) => void;
  
  // Conversation operations
  createNewConversation: () => Promise<void>;
  loadConversation: (id: string) => Promise<any>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, newTitle: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  currentConversationId: null,
  currentConversationTitle: 'New Conversation',
  conversations: [],
  isLoading: false,

  setCurrentConversation: (id, title) => {
    set({ currentConversationId: id, currentConversationTitle: title });
  },

  setConversations: (conversations) => {
    set({ conversations });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  updateConversationTitle: (title) => {
    set({ currentConversationTitle: title });
  },

  createNewConversation: async () => {
    try {
      set({ isLoading: true });
      const result = await window.electronAPI.createConversation('New Conversation');
      
      if (result.success && result.conversation) {
        set({
          currentConversationId: result.conversation.id,
          currentConversationTitle: result.conversation.title,
        });
        
        // Refresh the conversation list
        await get().refreshConversations();
      }
    } catch (error) {
      console.error('Failed to create conversation:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  loadConversation: async (id: string) => {
    try {
      set({ isLoading: true });
      const result = await window.electronAPI.loadConversation(id);
      
      if (result.success && result.conversation) {
        set({
          currentConversationId: result.conversation.id,
          currentConversationTitle: result.conversation.title,
        });
        
        return result.conversation;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteConversation: async (id: string) => {
    try {
      const result = await window.electronAPI.deleteConversation(id);
      
      if (result.success) {
        // If we deleted the current conversation, clear it
        if (get().currentConversationId === id) {
          set({
            currentConversationId: null,
            currentConversationTitle: 'New Conversation',
          });
        }
        
        // Refresh the conversation list
        await get().refreshConversations();
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  },

  renameConversation: async (id: string, newTitle: string) => {
    try {
      const result = await window.electronAPI.renameConversation(id, newTitle);
      
      if (result.success) {
        // If we renamed the current conversation, update the title
        if (get().currentConversationId === id) {
          set({ currentConversationTitle: newTitle });
        }
        
        // Refresh the conversation list
        await get().refreshConversations();
      }
    } catch (error) {
      console.error('Failed to rename conversation:', error);
    }
  },

  refreshConversations: async () => {
    try {
      const result = await window.electronAPI.listConversations();
      
      if (result.success && result.conversations) {
        set({ conversations: result.conversations });
      }
    } catch (error) {
      console.error('Failed to refresh conversations:', error);
    }
  },
}));
