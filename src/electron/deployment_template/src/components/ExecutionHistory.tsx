import { X, Eye, Clock, CheckCircle, XCircle } from 'lucide-react';

interface ExecutionResult {
  id: string;
  timestamp: Date;
  parameters: Record<string, any>;
  output: string;
  status: 'running' | 'completed' | 'error';
  duration?: number;
}

interface ExecutionHistoryProps {
  executions: ExecutionResult[];
  onViewExecution: (execution: ExecutionResult) => void;
  onClose: () => void;
}

export default function ExecutionHistory({ executions, onViewExecution, onClose }: ExecutionHistoryProps) {
  const getStatusIcon = (status: ExecutionResult['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Execution History</h2>
        <button
          onClick={onClose}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Close history"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {executions.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">No execution history yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {executions.map((execution) => (
            <div
              key={execution.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusIcon(execution.status)}
                    <span className="text-sm font-medium text-gray-900">
                      {new Date(execution.timestamp).toLocaleString()}
                    </span>
                    {execution.duration && (
                      <span className="text-xs text-gray-500">
                        ({formatDuration(execution.duration)})
                      </span>
                    )}
                  </div>

                  {Object.keys(execution.parameters).length > 0 && (
                    <div className="space-y-1">
                      {Object.entries(execution.parameters).slice(0, 2).map(([key, value]) => (
                        <div key={key} className="text-xs text-gray-600 truncate">
                          <span className="font-medium">{key}:</span>{' '}
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </div>
                      ))}
                      {Object.keys(execution.parameters).length > 2 && (
                        <div className="text-xs text-gray-500">
                          +{Object.keys(execution.parameters).length - 2} more parameters
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onViewExecution(execution)}
                  className="btn-secondary px-3 py-1.5 flex items-center gap-1.5 text-sm shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
