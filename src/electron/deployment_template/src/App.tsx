import { useState, useEffect } from 'react';
import ParameterForm from './components/ParameterForm';
import ResultsViewer from './components/ResultsViewer';
import ExecutionHistory from './components/ExecutionHistory';
import ApiDocs from './components/ApiDocs';
import { config } from './config';
import { Play, History, Info, Loader2, Code } from 'lucide-react';

interface Parameter {
  key: string;
  name: string;
  description: string;
  type: 'text' | 'file' | 'select' | 'multiselect' | 'number' | 'boolean';
  options?: string[];
  default?: any;
}

interface DMLMetadata {
  name: string;
  description: string;
  parameters: Parameter[];
}

export interface ExecutionResult {
  id: string;
  timestamp: Date;
  parameters: Record<string, any>;
  output: string;
  status: 'running' | 'completed' | 'error';
  duration?: number;
  workspaceFiles?: Array<{
    name: string;
    size: number;
    modified: Date;
  }>;
}

function App() {
  const [dmlMetadata, setDmlMetadata] = useState<DMLMetadata | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentExecution, setCurrentExecution] = useState<ExecutionResult | null>(null);
  const [executionHistory, setExecutionHistory] = useState<ExecutionResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showApiDocs, setShowApiDocs] = useState(false);

  // Load DML metadata from server on mount
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        setIsLoadingMetadata(true);
        const response = await fetch(`${config.apiEndpoint}/api/metadata`);
        
        if (!response.ok) {
          throw new Error(`Failed to load metadata: ${response.statusText}`);
        }
        
        const metadata = await response.json();
        setDmlMetadata(metadata);
        setMetadataError(null);
      } catch (error) {
        console.error('Failed to load DML metadata:', error);
        setMetadataError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setIsLoadingMetadata(false);
      }
    };
    
    loadMetadata();
  }, []);

  const handleExecute = async (parameters: Record<string, any>, files: Record<string, File>) => {
    if (!dmlMetadata) {
      console.error('Cannot execute: DML metadata not loaded');
      return;
    }
    
    // Generate session ID using ISO timestamp format (consistent with backend)
    // Remove hyphens, colons, and dots for filesystem compatibility
    const sessionId = `session_${new Date().toISOString().replace(/[:.]/g, '_').replace(/-/g, '_')}`;
    const startTime = Date.now();
    
    const execution: ExecutionResult = {
      id: sessionId,
      timestamp: new Date(),
      parameters,
      output: '',
      status: 'running',
    };
    
    setCurrentExecution(execution);
    setIsExecuting(true);

    try {
      // First, upload any files to the session workspace
      const uploadedFileNames: Record<string, string> = {};
      
      if (Object.keys(files).length > 0) {
        console.log(`[Session ${sessionId}] Uploading ${Object.keys(files).length} file(s)...`);
        
        for (const [key, file] of Object.entries(files)) {
          const formData = new FormData();
          formData.append('file', file);
          
          // Pass sessionId as query parameter so multer can set the destination correctly
          const uploadResponse = await fetch(`${config.apiEndpoint}/api/upload?sessionId=${encodeURIComponent(sessionId)}`, {
            method: 'POST',
            body: formData,
          });
          
          if (!uploadResponse.ok) {
            const error = await uploadResponse.json().catch(() => ({ error: uploadResponse.statusText }));
            throw new Error(`File upload failed for ${file.name}: ${error.error || uploadResponse.statusText}`);
          }
          
          const uploadResult = await uploadResponse.json();
          uploadedFileNames[key] = uploadResult.filename;
          console.log(`[Session ${sessionId}] Uploaded ${file.name} as ${uploadResult.filename}`);
        }
        
        // Replace file parameters with uploaded filenames (just the basename, not full path)
        Object.assign(parameters, uploadedFileNames);
      }

      // Execute DML with the session workspace
      console.log(`[Session ${sessionId}] Executing DML with parameters:`, parameters);
      
      const response = await fetch(`${config.apiEndpoint}/api/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dmlFile: dmlMetadata.name,
          parameters,
          streamResults: config.execution.streamResults,
          sessionId: sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Execution failed: ${response.statusText}`);
      }

      if (config.execution.streamResults && response.body) {
        // Stream results
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let output = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          output += chunk;
          
          setCurrentExecution(prev => prev ? {
            ...prev,
            output,
          } : null);
        }

        const duration = Date.now() - startTime;
        
        // Fetch workspace files before completing
        const workspaceFiles = await fetchWorkspaceFiles(sessionId);
        
        const completedExecution = {
          ...execution,
          output,
          status: 'completed' as const,
          duration,
          workspaceFiles,
        };
        
        setCurrentExecution(completedExecution);
        setExecutionHistory(prev => [completedExecution, ...prev.slice(0, config.ui.maxHistoryItems - 1)]);
        
        // Don't clean up session immediately - user might want to download files
        console.log(`[Session ${sessionId}] Execution completed. Workspace files available for download.`);
      } else {
        // Non-streaming result
        const result = await response.json();
        const duration = Date.now() - startTime;
        
        // Fetch workspace files before completing
        const workspaceFiles = await fetchWorkspaceFiles(sessionId);
        
        const completedExecution = {
          ...execution,
          output: result.output || '',
          status: 'completed' as const,
          duration,
          workspaceFiles,
        };
        
        setCurrentExecution(completedExecution);
        setExecutionHistory(prev => [completedExecution, ...prev.slice(0, config.ui.maxHistoryItems - 1)]);
        
        // Don't clean up session immediately - user might want to download files
        console.log(`[Session ${sessionId}] Execution completed. Workspace files available for download.`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorExecution = {
        ...execution,
        output: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 'error' as const,
        duration,
      };
      
      setCurrentExecution(errorExecution);
      setExecutionHistory(prev => [errorExecution, ...prev.slice(0, config.ui.maxHistoryItems - 1)]);
      
      // Clean up session on error
      console.log(`[Session ${sessionId}] Execution failed, cleaning up workspace...`);
      await cleanupSession(sessionId);
    } finally {
      setIsExecuting(false);
    }
  };

  // Helper function to fetch workspace files
  const fetchWorkspaceFiles = async (sessionId: string) => {
    try {
      const response = await fetch(`${config.apiEndpoint}/api/list-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[Session ${sessionId}] Found ${result.files?.length || 0} workspace file(s)`);
        return result.files || [];
      } else {
        console.warn(`[Session ${sessionId}] Failed to fetch workspace files:`, response.statusText);
        return [];
      }
    } catch (error) {
      console.warn(`[Session ${sessionId}] Error fetching workspace files:`, error);
      return [];
    }
  };

  // Helper function to clean up session workspace
  const cleanupSession = async (sessionId: string) => {
    try {
      const response = await fetch(`${config.apiEndpoint}/api/cleanup-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });
      
      if (response.ok) {
        console.log(`[Session ${sessionId}] Workspace cleaned up successfully`);
      } else {
        console.warn(`[Session ${sessionId}] Failed to clean up workspace:`, response.statusText);
      }
    } catch (error) {
      console.warn(`[Session ${sessionId}] Error cleaning up workspace:`, error);
    }
  };

  const handleViewHistoryItem = (execution: ExecutionResult) => {
    setCurrentExecution(execution);
    setShowHistory(false);
  };

  // Show loading state
  if (isLoadingMetadata) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading DML metadata...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (metadataError || !dmlMetadata) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">Failed to Load Metadata</h2>
            <p className="text-sm text-red-700">{metadataError || 'Unknown error'}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 btn-primary"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Play className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {dmlMetadata.name.replace('.dml', '')}
                </h1>
                <p className="text-sm text-gray-600">{dmlMetadata.description}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowApiDocs(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Code className="w-4 h-4" />
                API Docs
              </button>
              
              {config.ui.showExecutionHistory && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="btn-secondary flex items-center gap-2"
                >
                  <History className="w-4 h-4" />
                  History ({executionHistory.length})
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* API Documentation Modal */}
      {showApiDocs && dmlMetadata && (
        <ApiDocs
          dmlFileName={dmlMetadata.name}
          parameters={dmlMetadata.parameters}
          onClose={() => setShowApiDocs(false)}
        />
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Parameters Form */}
          <div className="lg:col-span-1">
            <div className="card sticky top-8">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-5 h-5 text-primary-600" />
                <h2 className="text-lg font-semibold text-gray-900">Parameters</h2>
              </div>
              <ParameterForm
                parameters={dmlMetadata.parameters}
                onExecute={handleExecute}
                isExecuting={isExecuting}
              />
            </div>
          </div>

          {/* Results Viewer */}
          <div className="lg:col-span-2">
            {showHistory ? (
              <ExecutionHistory
                executions={executionHistory}
                onViewExecution={handleViewHistoryItem}
                onClose={() => setShowHistory(false)}
              />
            ) : (
              <ResultsViewer
                execution={currentExecution}
                isExecuting={isExecuting}
              />
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-gray-600 text-center">
            Powered by DeepClause DML
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
