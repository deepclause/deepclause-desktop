import { useState, useEffect } from 'react';
import { MessageSquare, Trash2, Edit2, Check, X } from 'lucide-react';
import { useConversationStore } from '../../stores/useConversationStore';
import { useChatStore } from '../../stores/useChatStore';

export function ConversationList() {
  const conversations = useConversationStore((state) => state.conversations);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);
  const loadConversation = useConversationStore((state) => state.loadConversation);
  const deleteConversation = useConversationStore((state) => state.deleteConversation);
  const renameConversation = useConversationStore((state) => state.renameConversation);
  const refreshConversations = useConversationStore((state) => state.refreshConversations);
  
  const { setMessages, clearMessages } = useChatStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    console.log('[ConversationList] Mounting, refreshing conversations');
    refreshConversations();
  }, []); // Only refresh on mount

  const handleLoadConversation = async (id: string) => {
    const conversation = await loadConversation(id);
    if (conversation && conversation.messages) {
      // Convert timestamp strings back to Date objects
      const messagesWithDates = conversation.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));
      setMessages(messagesWithDates);
    }
  };

  const handleDeleteConversation = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (confirm('Are you sure you want to delete this conversation?')) {
      await deleteConversation(id);
      
      // If we deleted the current conversation, clear messages
      if (id === currentConversationId) {
        clearMessages();
      }
    }
  };

  const startEditing = (id: string, currentTitle: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const cancelEditing = (event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingId(null);
    setEditTitle('');
  };

  const saveEdit = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (editTitle.trim()) {
      await renameConversation(id, editTitle.trim());
    }
    
    setEditingId(null);
    setEditTitle('');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
        <MessageSquare className="w-12 h-12 text-text-tertiary mb-3" />
        <p className="text-text-secondary text-sm">No conversations yet</p>
        <p className="text-text-tertiary text-xs mt-1">
          Start a new conversation to get started
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => handleLoadConversation(conv.id)}
          className={`
            group relative px-3 py-2.5 rounded-lg cursor-pointer
            transition-all duration-200
            ${conv.id === currentConversationId 
              ? 'bg-deepclause-primary/20 border border-deepclause-primary/40' 
              : 'bg-bg-dark hover:bg-bg-darkest border border-border'
            }
          `}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {editingId === conv.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 px-2 py-1 text-xs bg-bg-darkest border border-border rounded focus:outline-none focus:border-deepclause-primary"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveEdit(conv.id, e as any);
                      } else if (e.key === 'Escape') {
                        cancelEditing(e as any);
                      }
                    }}
                  />
                  <button
                    onClick={(e) => saveEdit(conv.id, e)}
                    className="p-1 text-deepclause-primary hover:text-deepclause-primary/80"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="p-1 text-text-tertiary hover:text-text-secondary"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
                    <h4 className="font-medium text-sm text-text-primary truncate">
                      {conv.title}
                    </h4>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-tertiary">
                    <span>{formatDate(conv.updatedAt)}</span>
                    <span>•</span>
                    <span>{conv.messageCount} messages</span>
                  </div>
                </>
              )}
            </div>
            
            {editingId !== conv.id && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => startEditing(conv.id, conv.title, e)}
                  className="p-1 text-text-tertiary hover:text-deepclause-primary rounded transition-colors"
                  title="Rename conversation"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                  className="p-1 text-text-tertiary hover:text-red-400 rounded transition-colors"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
