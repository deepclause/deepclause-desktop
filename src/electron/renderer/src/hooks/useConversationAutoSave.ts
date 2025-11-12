import { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { useConversationStore } from '../stores/useConversationStore';

/**
 * Hook to automatically save conversation when messages change
 */
export function useConversationAutoSave() {
  const messages = useChatStore((state) => state.messages);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);
  const currentConversationTitle = useConversationStore((state) => state.currentConversationTitle);
  const refreshConversations = useConversationStore((state) => state.refreshConversations);
  const updateConversationTitle = useConversationStore((state) => state.updateConversationTitle);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only auto-save if we have a conversation ID and at least one message
    if (!currentConversationId) {
      console.log('[AutoSave] Skipping: No conversation ID');
      return;
    }

    // Don't save empty conversations
    if (messages.length === 0) {
      console.log('[AutoSave] Skipping: No messages');
      return;
    }

    console.log('[AutoSave] Scheduling save for conversation:', currentConversationId, 'messages:', messages.length);

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce the save - wait 2 seconds after last message before saving
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        console.log('[AutoSave] Saving conversation:', currentConversationId);
        
        // Convert messages to a serializable format
        const serializableMessages = messages.map((msg) => ({
          id: msg.id,
          type: msg.type,
          content: msg.content,
          timestamp: msg.timestamp.toISOString(),
          raw: msg.raw,
        }));

        const result = await window.electronAPI.saveConversation(
          currentConversationId,
          serializableMessages,
          currentConversationTitle
        );

        console.log('[AutoSave] Save result:', result);
        
        if (result.success) {
          console.log('[AutoSave] Conversation saved successfully:', currentConversationId);
          
          // Update the title if the LLM generated a new one
          if (result.conversation && result.conversation.title && result.conversation.title !== currentConversationTitle) {
            console.log('[AutoSave] LLM generated new title:', result.conversation.title);
            updateConversationTitle(result.conversation.title);
          }
          
          // Refresh the conversation list to show updated metadata (messageCount, updatedAt, new title)
          await refreshConversations();
        } else {
          console.error('[AutoSave] Save failed:', result.error);
        }
      } catch (error) {
        console.error('[AutoSave] Failed to auto-save conversation:', error);
      }
    }, 2000);

    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, currentConversationId, currentConversationTitle]);
}
