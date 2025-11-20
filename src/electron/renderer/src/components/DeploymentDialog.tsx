import React, { useState } from 'react';
import { X, Folder, Rocket } from 'lucide-react';

interface DeploymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  dmlFilePath: string;
  workspaceDir: string;
  onDeploymentComplete?: (result: { deploymentPath: string; deploymentName: string }) => void;
}

export function DeploymentDialog({
  isOpen,
  onClose,
  dmlFilePath,
  workspaceDir,
  onDeploymentComplete,
}: DeploymentDialogProps) {
  const [deploymentName, setDeploymentName] = useState('');
  const [outputFolder, setOutputFolder] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive suggested name from DML file
  React.useEffect(() => {
    if (dmlFilePath && !deploymentName) {
      // Handle both dot notation (browser.find_trials) and file paths
      const fileName = dmlFilePath.includes('/') 
        ? dmlFilePath.split('/').pop() || '' 
        : dmlFilePath;
      const baseName = fileName.replace('.dml', '');
      const suggested = baseName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
      setDeploymentName(suggested);
    }
  }, [dmlFilePath, deploymentName]);

  const handleSelectFolder = async () => {
    try {
      const result = await (window as any).electronAPI.selectDeploymentFolder();
      
      if (result.success && result.folderPath) {
        setOutputFolder(result.folderPath);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select folder');
    }
  };

  const handleDeploy = async () => {
    if (!deploymentName.trim()) {
      setError('Please enter a deployment name');
      return;
    }

    if (!outputFolder) {
      setError('Please select an output folder');
      return;
    }

    setIsDeploying(true);
    setError(null);

    try {
      const result = await (window as any).electronAPI.deployDmlFileWithName({
        dmlFilePath,
        deploymentName: deploymentName.trim(),
        outputFolder,
        workspaceDir,
      });

      if (result.success) {
        onDeploymentComplete?.({
          deploymentPath: result.deploymentPath,
          deploymentName: result.deploymentName,
        });
        onClose();
      } else {
        setError(result.error || 'Deployment failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Rocket className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Deploy DML File</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isDeploying}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* DML File Info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              DML File
            </label>
            <div className="px-3 py-2 bg-gray-50 rounded border border-gray-200 text-sm text-gray-600 break-all">
              {dmlFilePath || 'No file selected'}
            </div>
          </div>

          {/* Deployment Name */}
          <div>
            <label htmlFor="deployment-name" className="block text-sm font-medium text-gray-700 mb-1">
              Deployment Name
            </label>
            <input
              id="deployment-name"
              type="text"
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="my-dml-app"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isDeploying}
            />
            <p className="mt-1 text-xs text-gray-500">
              Use lowercase letters, numbers, hyphens, and underscores
            </p>
          </div>

          {/* Output Folder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Output Folder
            </label>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2 bg-gray-50 rounded border border-gray-200 text-sm text-gray-600 break-all overflow-hidden">
                {outputFolder || 'No folder selected'}
              </div>
              <button
                onClick={handleSelectFolder}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-2"
                disabled={isDeploying}
              >
                <Folder className="w-4 h-4" />
                Browse
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Deployment Info */}
          <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800">
              This will create a standalone web application with all necessary dependencies
              bundled. The deployment will include:
            </p>
            <ul className="mt-2 text-xs text-blue-700 space-y-1 ml-4 list-disc">
              <li>React frontend with parameter form</li>
              <li>Node.js backend for DML execution</li>
              <li>DML runtime and dependencies</li>
              <li>Session-based workspace management</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded transition-colors"
            disabled={isDeploying}
          >
            Cancel
          </button>
          <button
            onClick={handleDeploy}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isDeploying || !deploymentName.trim() || !outputFolder}
          >
            {isDeploying ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Deploy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
