import { RefreshCw, FolderPlus, FilePlus, Upload, X, FolderOpen } from 'lucide-react';
import { useFileStore } from '../../stores/useFileStore';
import { useChatStore } from '../../stores/useChatStore';
import { useMarkdownViewerStore } from '../../stores/useMarkdownViewerStore';
import { WorkspaceFileTree } from './WorkspaceFileTree';
import { useState, createContext, useContext, ReactNode } from 'react';

// Context to share dialog controls between WorkspaceExplorer and WorkspaceExplorerActions
interface WorkspaceActionsContextType {
  showNewFolderDialog: () => void;
  showNewFileDialog: () => void;
  copyFileToWorkspace: () => void;
}

const WorkspaceActionsContext = createContext<WorkspaceActionsContextType | null>(null);

export function WorkspaceExplorerProvider({ children }: { children: ReactNode }) {
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const { refreshWorkspaceFiles, workspaceFiles } = useFileStore();

  // Get list of all folders for the dropdown
  const folders = ['/', ...workspaceFiles
    .filter(f => f.type === 'directory')
    .map(f => '/' + f.path)
    .sort()];

  const handleCreateFolder = async () => {
    if (!newItemName.trim()) return;
    
    try {
      // Construct path: if selectedFolder is '/', use name directly, otherwise combine
      const folderPath = selectedFolder === '/' 
        ? newItemName 
        : `${selectedFolder.slice(1)}/${newItemName}`;
      
      const result = await window.electronAPI.createFolder(folderPath);
      
      if (result.success) {
        useChatStore.getState().addMessage('system', `✅ Created folder: ${newItemName}`);
        await refreshWorkspaceFiles();
        setShowNewFolderDialog(false);
        setNewItemName('');
        setSelectedFolder('');
      } else {
        useChatStore.getState().addMessage('system', `❌ Failed to create folder: ${result.error}`);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      useChatStore.getState().addMessage('system', `❌ Failed to create folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCreateFile = async () => {
    if (!newItemName.trim()) return;
    
    try {
      // Construct path: if selectedFolder is '/', use name directly, otherwise combine
      const filePath = selectedFolder === '/' 
        ? newItemName 
        : `${selectedFolder.slice(1)}/${newItemName}`;
      
      const result = await window.electronAPI.createFile(filePath, '');
      
      if (result.success) {
        useChatStore.getState().addMessage('system', `✅ Created file: ${newItemName}`);
        await refreshWorkspaceFiles();
        setShowNewFileDialog(false);
        setNewItemName('');
        setSelectedFolder('');
      } else {
        useChatStore.getState().addMessage('system', `❌ Failed to create file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error creating file:', error);
      useChatStore.getState().addMessage('system', `❌ Failed to create file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCopyFileToWorkspace = async () => {
    try {
      const result = await window.electronAPI.copyFileToWorkspace('');
      
      if (result.success) {
        useChatStore.getState().addMessage('system', `✅ Copied file to workspace: ${result.fileName}`);
        await refreshWorkspaceFiles();
      } else if (result.error !== 'No file selected') {
        useChatStore.getState().addMessage('system', `❌ Failed to copy file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error copying file:', error);
      useChatStore.getState().addMessage('system', `❌ Failed to copy file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const contextValue: WorkspaceActionsContextType = {
    showNewFolderDialog: () => setShowNewFolderDialog(true),
    showNewFileDialog: () => setShowNewFileDialog(true),
    copyFileToWorkspace: handleCopyFileToWorkspace,
  };

  return (
    <WorkspaceActionsContext.Provider value={contextValue}>
      {children}
      
      {/* New Folder Dialog */}
      {showNewFolderDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => {
          setShowNewFolderDialog(false);
          setNewItemName('');
          setSelectedFolder('');
        }}>
          <div className="bg-bg-medium border border-border rounded-lg shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Create New Folder</h3>
              <button
                onClick={() => {
                  setShowNewFolderDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-primary mb-2">Parent Folder</label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="w-full px-3 py-2 bg-bg-light border border-border rounded-md text-text-primary focus:outline-none focus:border-deepclause-primary"
              >
                <option value="">Select folder...</option>
                {folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Folder name"
              className="w-full px-3 py-2 bg-bg-light border border-border rounded-md text-text-primary placeholder-text-secondary focus:outline-none focus:border-deepclause-primary mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') {
                  setShowNewFolderDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }
              }}
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowNewFolderDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }}
                className="px-4 py-2 bg-bg-light border border-border rounded-md text-text-primary hover:bg-bg-darkest transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!selectedFolder}
                className="px-4 py-2 bg-deepclause-primary text-white rounded-md hover:bg-deepclause-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New File Dialog */}
      {showNewFileDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => {
          setShowNewFileDialog(false);
          setNewItemName('');
          setSelectedFolder('');
        }}>
          <div className="bg-bg-medium border border-border rounded-lg shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Create New File</h3>
              <button
                onClick={() => {
                  setShowNewFileDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-text-primary mb-2">Parent Folder</label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="w-full px-3 py-2 bg-bg-light border border-border rounded-md text-text-primary focus:outline-none focus:border-deepclause-primary"
              >
                <option value="">Select folder...</option>
                {folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="File name (e.g., notes.txt)"
              className="w-full px-3 py-2 bg-bg-light border border-border rounded-md text-text-primary placeholder-text-secondary focus:outline-none focus:border-deepclause-primary mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFile();
                if (e.key === 'Escape') {
                  setShowNewFileDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }
              }}
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowNewFileDialog(false);
                  setNewItemName('');
                  setSelectedFolder('');
                }}
                className="px-4 py-2 bg-bg-light border border-border rounded-md text-text-primary hover:bg-bg-darkest transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFile}
                disabled={!selectedFolder}
                className="px-4 py-2 bg-deepclause-primary text-white rounded-md hover:bg-deepclause-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceActionsContext.Provider>
  );
}

export function WorkspaceExplorer() {
  const { workspaceFiles, isLoadingWorkspace } = useFileStore();
  const { openMarkdownFile } = useMarkdownViewerStore();

  const handleFileClick = async (file: { name: string; path: string; fullPath?: string; type: string }) => {
    if (file.type === 'directory') {
      useChatStore.getState().addMessage('system', `📁 Directory: ${file.path}`);
    } else if (file.name.endsWith('.md')) {
      // Open markdown files in the viewer - use fullPath for absolute path
      openMarkdownFile(file.fullPath || file.path, file.name);
    } else {
      // Open other files with OS's default application
      try {
        const result = await window.electronAPI.openFileExternal(file.path);
        if (!result.success) {
          useChatStore.getState().addMessage('system', `❌ Failed to open file: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error opening file:', error);
        useChatStore.getState().addMessage('system', `❌ Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  if (isLoadingWorkspace) {
    return (
      <div className="text-center text-text-secondary py-8">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
        Loading workspace...
      </div>
    );
  }

  if (workspaceFiles.length === 0) {
    return (
      <div className="text-center text-text-secondary py-8">
        Workspace is empty
      </div>
    );
  }

  return <WorkspaceFileTree files={workspaceFiles} onFileClick={handleFileClick} />;
}

interface WorkspaceExplorerActionsProps {
  onRefresh: () => void;
}

export function WorkspaceExplorerActions({ onRefresh }: WorkspaceExplorerActionsProps) {
  const actions = useContext(WorkspaceActionsContext);

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.openWorkspaceFolder();
    } catch (error) {
      console.error('Error opening workspace folder:', error);
    }
  };

  if (!actions) {
    // Fallback if not wrapped in provider
    return (
      <div className="flex gap-1">
        <button
          onClick={handleOpenFolder}
          className="p-1 hover:bg-bg-light rounded transition-colors"
          title="Open workspace folder"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <button
          onClick={onRefresh}
          className="p-1 hover:bg-bg-light rounded transition-colors"
          title="Refresh workspace"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <button
        onClick={actions.showNewFolderDialog}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Create new folder"
      >
        <FolderPlus className="w-4 h-4" />
      </button>
      <button
        onClick={actions.showNewFileDialog}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Create new file"
      >
        <FilePlus className="w-4 h-4" />
      </button>
      <button
        onClick={actions.copyFileToWorkspace}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Copy file to workspace"
      >
        <Upload className="w-4 h-4" />
      </button>
      <button
        onClick={handleOpenFolder}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Open workspace folder"
      >
        <FolderOpen className="w-4 h-4" />
      </button>
      <button
        onClick={onRefresh}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Refresh workspace"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
}
