import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, RotateCcw, Code2, TreePine, MessageSquare, Play, Rocket } from 'lucide-react';
import { Button } from '../ui/Button';
import { TreeEditor } from '../tree/TreeEditor';
import { CompileLogView } from '../tree/CompileLogView';
import { ChatContainer } from '../chat/ChatContainer';
import { useDmlEditorStore } from '../../stores/useDmlEditorStore';
import { useAppStore } from '../../stores/useAppStore';
import { DeploymentDialog } from '../DeploymentDialog';
import { useFileStore } from '../../stores/useFileStore';
import { useChatStore } from '../../stores/useChatStore';
import { useConversationStore } from '../../stores/useConversationStore';

export function DmlEditorView() {
  const {
    filename,
    content,
    description,
    treeData,
    mode,
    hasChanges,
    isSaving,
    isCompiling,
    showCompileLog,
    treeNeedsCompile,
    closeFile,
    setContent,
    setDescription,
    setTreeData,
    setMode,
    setHasChanges,
    setIsSaving,
    setIsCompiling,
    setShowCompileLog,
    setTreeNeedsCompile,
  } = useDmlEditorStore();

  const setActiveView = useAppStore((state) => state.setActiveView);
  const currentPaths = useAppStore((state) => state.currentPaths);
  const refreshDmlFiles = useFileStore((state) => state.refreshDmlFiles);
  const startStreaming = useChatStore((state) => state.startStreaming);
  const addMessage = useChatStore((state) => state.addMessage);
  const [isDeployDialogOpen, setIsDeployDialogOpen] = useState(false);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);
  const [isRunning, setIsRunning] = useState(false);

  // Load tree data when file opens
  useEffect(() => {
    const loadTreeData = async () => {
      if (!filename) return;
      
      try {
        const result = await window.electronAPI.readTreeJson(filename);
        if (result.success && result.tree) {
          setTreeData(result.tree);
          setMode('tree'); // Default to tree view if .tree.json exists
        } else {
          setTreeData(null);
          setMode('code'); // Default to code view if no .tree.json
        }
      } catch (error) {
        console.error('Error loading tree data:', error);
        setTreeData(null);
        setMode('code');
      }
    };

    loadTreeData();
  }, [filename, setTreeData, setMode]);

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to close?');
      if (!confirmed) return;
    }
    closeFile();
    setActiveView('chat');
  };

  const handleSave = async () => {
    if (!filename) return;
    
    setIsSaving(true);
    try {
      // If in tree mode and we have tree data, save both DML and tree.json
      if (mode === 'tree' && treeData) {
        await window.electronAPI.saveDmlWithTree(filename, content, description, treeData);
      } else {
        const result = await window.electronAPI.saveDmlFileContent(filename, content, description);
        if (!result.success) {
          throw new Error(result.error || 'Failed to save file');
        }
      }
      setHasChanges(false);
      await refreshDmlFiles();
    } catch (error) {
      console.error('Error saving file:', error);
      alert(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm('Are you sure you want to discard all changes?');
    if (confirmed) {
      // Reset would need to reload the original content
      // For now, just close and reopen
      setHasChanges(false);
    }
  };

  const handleCompileTree = async () => {
    if (!treeData) return;
    
    setIsCompiling(true);
    setShowCompileLog(true);
    
    try {
      const result = await window.electronAPI.compileTreeToDml(treeData);
      
      if (result.success && result.dml) {
        setContent(result.dml);
        setHasChanges(true);
        setTreeNeedsCompile(false); // Tree has been compiled, reset flag
      } else {
        alert(`Compilation failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Tree compilation error:', error);
      alert(`Compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleRun = async () => {
    if (!filename) return;
    
    setIsRunning(true);
    
    try {
      // If in tree mode and tree needs compilation, compile first
      if (mode === 'tree' && treeData && treeNeedsCompile) {
        setIsCompiling(true);
        setShowCompileLog(true);
        
        const compileResult = await window.electronAPI.compileTreeToDml(treeData);
        
        if (compileResult.success && compileResult.dml) {
          setContent(compileResult.dml);
          setTreeNeedsCompile(false);
          setHasChanges(true);
        } else {
          setIsCompiling(false);
          alert(`Compilation failed: ${compileResult.error || 'Unknown error'}`);
          return;
        }
        
        setIsCompiling(false);
      }
      
      // Save first if there are changes
      if (hasChanges) {
        setIsSaving(true);
        if (mode === 'tree' && treeData) {
          await window.electronAPI.saveDmlWithTree(filename, content, description, treeData);
        } else {
          const result = await window.electronAPI.saveDmlFileContent(filename, content, description);
          if (!result.success) {
            throw new Error(result.error || 'Failed to save file');
          }
        }
        setHasChanges(false);
        await refreshDmlFiles();
        setIsSaving(false);
      }
      
      // Add user message to indicate the run
      addMessage('user', `/run ${filename}`);
      
      // Start streaming
      startStreaming();
      
      // Run the DML file
      const result = await window.electronAPI.runDmlFile(filename, '', currentConversationId);
      
      if (!result.success) {
        addMessage('error', `Failed to run ${filename}: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error running DML file:', error);
      addMessage('error', `Failed to run ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  if (!filename) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-bg-darkest">
      {/* Split View Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side - Editor */}
        <div className="flex-1 flex flex-col border-r border-border">
          {/* Editor Header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-dark">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-text-primary">{filename}</h1>
                
                {/* Mode Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMode('tree')}
                    disabled={!treeData && mode !== 'tree'}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                      mode === 'tree'
                        ? 'bg-deepclause-primary text-white'
                        : 'bg-bg-medium text-text-secondary hover:bg-bg-dark hover:text-text-primary'
                    } ${!treeData && mode !== 'tree' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={!treeData ? 'No tree data available' : 'Tree View'}
                  >
                    <TreePine className="w-4 h-4" />
                    Tree
                  </button>
                  <button
                    onClick={() => setMode('code')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
                      mode === 'code'
                        ? 'bg-deepclause-primary text-white'
                        : 'bg-bg-medium text-text-secondary hover:bg-bg-dark hover:text-text-primary'
                    }`}
                    title="Code View"
                  >
                    <Code2 className="w-4 h-4" />
                    Code
                  </button>
                </div>
              </div>
            </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setIsDeployDialogOpen(true)}
                  variant="secondary"
                  className="flex items-center gap-2"
                  title="Deploy DML Agent"
                >
                  <Rocket className="w-5 h-5" />
                  Deploy
                </Button>
                <button
                  onClick={handleClose}
                  className="text-text-secondary hover:text-text-primary transition-colors"
                  title="Close Editor"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
          </div>

          {/* Editor Content */}
          <div className="flex-1 overflow-hidden">
            {mode === 'tree' && treeData ? (
              <TreeEditor
                tree={treeData}
                onChange={setTreeData}
              />
            ) : (
              <Editor
                height="100%"
                defaultLanguage="prolog"
                value={content}
                onChange={(value) => setContent(value || '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: true },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  insertSpaces: true,
                  wordWrap: 'on',
                  wrappingIndent: 'indent',
                  padding: { top: 16, bottom: 16 },
                }}
              />
            )}
          </div>

          {/* Description Section */}
          <div className="px-6 py-3 border-t border-border bg-bg-medium">
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter a brief description of what this DML file does..."
              className="w-full px-3 py-2 text-sm bg-white border border-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-deepclause-primary focus:border-transparent"
              rows={2}
            />
          </div>

          {/* Editor Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-light">
            <div className="text-sm text-text-secondary">
              {content.split('\n').length} lines • {content.length} characters
            </div>
            <div className="flex items-center gap-3">
              {mode === 'tree' && treeData && (
                <Button
                  onClick={handleCompileTree}
                  disabled={isCompiling || isSaving}
                  variant="secondary"
                >
                  <Rocket className="w-4 h-4 mr-2" />
                  {isCompiling ? 'Compiling...' : 'Compile'}
                </Button>
              )}
              <Button
                onClick={handleRun}
                disabled={isRunning || isSaving}
                variant="secondary"
              >
                <Play className="w-4 h-4 mr-2" />
                {isRunning ? 'Running...' : 'Run'}
              </Button>
              <Button
                onClick={handleReset}
                disabled={!hasChanges || isSaving}
                variant="secondary"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset
              </Button>
              <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* Right Side - Chat */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 border-b border-border bg-bg-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-text-secondary" />
            <span className="text-sm font-semibold text-text-secondary">Conversation</span>
          </div>
          <ChatContainer />
        </div>
      </div>

      {/* Compile Log View Modal */}
      {showCompileLog && (
        <CompileLogView
          onClose={() => setShowCompileLog(false)}
          isCompiling={isCompiling}
        />
      )}
      {/* Deploy Modal Dialog */}
      {isDeployDialogOpen && (
        <DeploymentDialog
          isOpen={isDeployDialogOpen}
          onClose={() => setIsDeployDialogOpen(false)}
          dmlFilePath={filename || ''}
          workspaceDir={currentPaths?.workspace || ''}
        />
      )}
    </div>
  );
}
