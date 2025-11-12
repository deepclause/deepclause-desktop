import { FileText, FolderOpen, Terminal, MessageSquare } from 'lucide-react';
import { useAppStore } from './stores/useAppStore';
import { useFileStore } from './stores/useFileStore';
import { useChatStore } from './stores/useChatStore';
import { useConversationStore } from './stores/useConversationStore';
import { useMarkdownViewerStore } from './stores/useMarkdownViewerStore';
import { useElectronAPI } from './hooks/useElectronAPI';
import { useConversationAutoSave } from './hooks/useConversationAutoSave';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar } from './components/layout/Sidebar';
import { EdgeTab } from './components/layout/EdgeTab';
import { ChatContainer } from './components/chat/ChatContainer';
import { DmlFileList, DmlFileListActions } from './components/files/DmlFileList';
import { WorkspaceExplorer, WorkspaceExplorerActions, WorkspaceExplorerProvider } from './components/files/WorkspaceExplorer';
import { SerialConsole } from './components/console/SerialConsole';
import { ConversationList } from './components/conversations/ConversationList';
import { InputDialog } from './components/modals/InputDialog';
import { SettingsDialog } from './components/modals/SettingsDialog';
import { MarkdownViewer } from './components/markdown/MarkdownViewer';
import { useEffect } from 'react';

function App() {
  // Initialize Electron API and set up event handlers
  useElectronAPI();
  
  // Auto-save conversation when messages change
  useConversationAutoSave();

  const { sidebars, toggleSidebar, inputRequest, setInputRequest } = useAppStore();
  const { refreshDmlFiles, refreshWorkspaceFiles } = useFileStore();
  const { refreshConversations, createNewConversation, currentConversationId } = useConversationStore();
  const addMessage = useChatStore((state) => state.addMessage);
  const { isOpen, filePath, fileName, closeMarkdownViewer } = useMarkdownViewerStore();

  // Don't add message here - let the stream end handler do it
  // This prevents the message from appearing before streaming stops

  // Initialize a conversation on first load if none exists
  useEffect(() => {
    const initializeConversation = async () => {
      await refreshConversations();
      
      // If no current conversation, create one
      if (!currentConversationId) {
        await createNewConversation();
      }
    };
    
    initializeConversation();
  }, []); // Only run once on mount

  const handleInputSubmit = async (requestId: string, userInput: string) => {
    await window.electronAPI.respondToInput(requestId, userInput);
    setInputRequest(null);
    addMessage('user', `📝 Input provided: ${userInput}`);
  };

  const handleInputCancel = async (requestId: string) => {
    await window.electronAPI.respondToInput(requestId, '');
    setInputRequest(null);
    addMessage('system', '❌ Input request cancelled');
  };

  return (
    <WorkspaceExplorerProvider>
      <div className="flex flex-col h-screen bg-bg-darkest">
        <Header />
        
        {/* Edge Tabs for Sidebar Toggle */}
        <EdgeTab
          icon={MessageSquare}
          label="Conversations"
          position="left"
          isActive={sidebars.conversations}
          onClick={() => toggleSidebar('conversations')}
        />
        <div className="fixed left-0 top-[calc(50%+120px)] -translate-y-1/2 z-50">
          <EdgeTab
            icon={FileText}
            label="DML Files"
            position="left"
            isActive={sidebars.dml}
            onClick={() => toggleSidebar('dml')}
          />
        </div>
        <EdgeTab
          icon={FolderOpen}
          label="Workspace"
          position="right"
          isActive={sidebars.workspace}
          onClick={() => toggleSidebar('workspace')}
        />
        <div className="fixed right-0 top-[calc(50%+120px)] -translate-y-1/2 z-50">
          <EdgeTab
            icon={Terminal}
            label="VM Console"
            position="right"
            isActive={sidebars.console}
            onClick={() => toggleSidebar('console')}
          />
        </div>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebars Container */}
          <div className="flex flex-shrink-0">
            {/* Left Sidebar - Conversations */}
            <Sidebar
              side="left"
              title="Conversations"
              visible={sidebars.conversations}
              actions={
                <button
                  onClick={refreshConversations}
                  className="text-text-tertiary hover:text-deepclause-primary transition-colors"
                  title="Refresh conversations"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              }
            >
              <ConversationList />
            </Sidebar>

            {/* Left Sidebar - DML Files */}
            <Sidebar
              side="left"
              title="DML Files"
              visible={sidebars.dml}
              actions={<DmlFileListActions onRefresh={refreshDmlFiles} />}
            >
              <DmlFileList />
            </Sidebar>
          </div>

          {/* Main Content - Chat */}
          <ChatContainer />

          {/* Right Sidebars Container */}
          <div className="flex flex-shrink-0">
            {/* Right Sidebar - Workspace */}
            <Sidebar
              side="right"
              title="Workspace"
              visible={sidebars.workspace}
              actions={<WorkspaceExplorerActions onRefresh={refreshWorkspaceFiles} />}
            >
              <WorkspaceExplorer />
            </Sidebar>

            {/* Right Sidebar - VM Console */}
            <Sidebar
              side="right"
              title="VM Serial Console"
              visible={sidebars.console}
              width="w-[600px]"
              bgColor="bg-bg-dark"
            >
              <SerialConsole />
            </Sidebar>
          </div>
        </div>

        <StatusBar />

        {/* Input Dialog Modal */}
        {inputRequest && (
          <InputDialog
            requestId={inputRequest.requestId}
            promptText={inputRequest.promptText}
            inputType={inputRequest.inputType}
            options={inputRequest.options}
            onSubmit={handleInputSubmit}
            onCancel={handleInputCancel}
          />
        )}

        {/* Settings Dialog */}
        <SettingsDialog />

        {/* Markdown Viewer */}
        {isOpen && filePath && fileName && (
          <MarkdownViewer
            filePath={filePath}
            fileName={fileName}
            onClose={closeMarkdownViewer}
          />
        )}
      </div>
    </WorkspaceExplorerProvider>
  );
}

export default App;
