import { PlusCircle } from 'lucide-react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useConversationStore } from '../../stores/useConversationStore';
import { useChatStore } from '../../stores/useChatStore';

export function ChatContainer() {
  const { createNewConversation, currentConversationTitle } = useConversationStore();
  const clearMessages = useChatStore((state) => state.clearMessages);

  const handleNewConversation = async () => {
    clearMessages();
    await createNewConversation();
  };

  return (
    <main className="flex-1 flex flex-col bg-bg-dark overflow-hidden">
      {/* Conversation Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-medium">
        <h2 className="text-sm font-medium text-text-secondary truncate">
          {currentConversationTitle}
        </h2>
        <button
          onClick={handleNewConversation}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-deepclause-primary hover:text-white bg-bg-dark hover:bg-deepclause-primary/20 border border-deepclause-primary/40 hover:border-deepclause-primary rounded-lg transition-all duration-200"
          title="Start a new conversation"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>
      
      <MessageList />
      <InputArea />
    </main>
  );
}
