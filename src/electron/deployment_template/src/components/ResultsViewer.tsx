import { useEffect, useRef } from 'react';
import { CheckCircle, XCircle, Loader2, Clock, Download, File } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { MermaidDiagram } from './MermaidDiagram';
import { config as appConfig } from '../config';

interface ExecutionResult {
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

interface ResultsViewerProps {
  execution: ExecutionResult | null;
  isExecuting: boolean;
}

export default function ResultsViewer({ execution, isExecuting }: ResultsViewerProps) {
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when output updates
  useEffect(() => {
    if (outputRef.current && isExecuting) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [execution?.output, isExecuting]);

  if (!execution) {
    return (
      <div className="card">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Execution Yet
          </h3>
          <p className="text-gray-600 max-w-md">
            Configure the parameters and click Execute to run the DML file.
            Results will appear here.
          </p>
        </div>
      </div>
    );
  }

  const statusConfig = {
    running: {
      icon: <Loader2 className="w-5 h-5 animate-spin text-primary-600" />,
      bgColor: 'bg-primary-50',
      textColor: 'text-primary-700',
      label: 'Executing',
    },
    completed: {
      icon: <CheckCircle className="w-5 h-5 text-green-600" />,
      bgColor: 'bg-green-50',
      textColor: 'text-green-700',
      label: 'Completed',
    },
    error: {
      icon: <XCircle className="w-5 h-5 text-red-600" />,
      bgColor: 'bg-red-50',
      textColor: 'text-red-700',
      label: 'Error',
    },
  };

  const config = statusConfig[execution.status];

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className={`${config.bgColor} rounded-lg p-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {config.icon}
            <div>
              <h3 className={`font-semibold ${config.textColor}`}>
                {config.label}
              </h3>
              <p className="text-sm text-gray-600">
                {new Date(execution.timestamp).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 font-mono mt-1">
                Session: {execution.id}
              </p>
            </div>
          </div>
          
          {execution.duration && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">
                {formatDuration(execution.duration)}
              </p>
              <p className="text-xs text-gray-500">duration</p>
            </div>
          )}
        </div>
      </div>

      {/* Parameters Used */}
      {Object.keys(execution.parameters).length > 0 && (
        <div className="card">
          <h4 className="font-semibold text-gray-900 mb-3">Parameters Used</h4>
          <div className="space-y-2">
            {Object.entries(execution.parameters).map(([key, value]) => (
              <div key={key} className="flex justify-between items-start gap-4">
                <span className="text-sm font-medium text-gray-700">{key}:</span>
                <span className="text-sm text-gray-600 text-right break-all">
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output */}
      <div className="card">
        <h4 className="font-semibold text-gray-900 mb-3">Output</h4>
        <div
          ref={outputRef}
          className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[600px] overflow-y-auto"
        >
          {execution.output ? (
            <div className="prose prose-sm max-w-none prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const lang = match ? match[1] : '';
                    const code = String(children).replace(/\n$/, '');

                    // Handle mermaid diagrams
                    if (lang === 'mermaid') {
                      return <MermaidDiagram chart={code} />;
                    }

                    // Regular code blocks
                    if (!inline && match) {
                      return (
                        <pre className={className}>
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                      );
                    }

                    // Inline code
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {execution.output}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-400">
              {isExecuting ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Waiting for output...</span>
                </div>
              ) : (
                <span>No output generated</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Workspace Files */}
      {execution.workspaceFiles && execution.workspaceFiles.length > 0 && (
        <div className="card">
          <h4 className="font-semibold text-gray-900 mb-3">Workspace Files</h4>
          <p className="text-sm text-gray-600 mb-4">
            Files created during this execution. Click to download.
          </p>
          <div className="space-y-2">
            {execution.workspaceFiles.map((file) => (
              <a
                key={file.name}
                href={`${appConfig.apiEndpoint}/api/download?sessionId=${encodeURIComponent(execution.id)}&filename=${encodeURIComponent(file.name)}`}
                download={file.name}
                className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <File className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.size)} • {new Date(file.modified).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Download className="w-4 h-4 text-gray-400 group-hover:text-primary-600 flex-shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
