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
  const [includeLinuxVM, setIncludeLinuxVM] = useState(false);
  const [deployLog, setDeployLog] = useState<string | null>(null);

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
    setIsDeploying(true);
    setError(null);
    try {
      const result = await (window as any).electronAPI.deployDmlFileWithName({
        dmlFilePath,
        deploymentName: deploymentName.trim(),
        outputFolder,
        workspaceDir,
        includeLinuxVM,
      });
      if (result.success) {
        setDeployLog(
          `[Deployment] ✅ Deployment created successfully at: ${result.deploymentPath}
` +
          `[Deployment] 
` +
          `[Deployment] 📚 Quick Start Options:
` +
          `[Deployment] 
` +
          `[Deployment] 1️⃣  Docker (Recommended for Production):
` +
          `[Deployment]     cd ${result.deploymentPath}
` +
          `[Deployment]     npm run docker:compose:up
` +
          `[Deployment]     → Access at http://localhost
` +
          `[Deployment] 
` +
          `[Deployment] 2️⃣  Vercel (Fastest Deployment):
` +
          `[Deployment]     cd ${result.deploymentPath}
` +
          `[Deployment]     npm run build
` +
          `[Deployment]     vercel --prod
` +
          `[Deployment] 
` +
          `[Deployment] 3️⃣  Local Development:
` +
          `[Deployment]     cd ${result.deploymentPath}
` +
          `[Deployment]     npm install
` +
          `[Deployment]     npm run dev:all
` +
          `[Deployment]     → Access at http://localhost:5173
` +
          `[Deployment] 
` +
          `[Deployment] 📖 Full documentation:
` +
          `[Deployment]     - QUICKSTART.md for immediate deployment
` +
          `[Deployment]     - DEPLOYMENT.md for detailed instructions
` +
          `[Deployment]     - README.md for complete project info
`
        );
        onDeploymentComplete?.({
          deploymentPath: result.deploymentPath,
          deploymentName: result.deploymentName,
        });
        // Do NOT call onClose() here; let user close manually
      } else {
        setError(result.error || 'Deployment failed');
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
      onClose();
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 transition-opacity ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="w-full max-w-2xl p-6 bg-white rounded-lg shadow-md transition-transform transform-gpu scale-100">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Deploy DML File</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4">
          {!deployLog ? (
            <>
              {/* File Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  DML File
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={dmlFilePath}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Folder className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>

              {/* Deployment Name */}
              <div className="mt-4">
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
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Output Folder
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={outputFolder}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
                    />
                  </div>
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Folder className="w-4 h-4" />
                    Browse
                  </button>
                </div>
              </div>

              {/* Linux VM Option */}
              <div className="mt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLinuxVM}
                    onChange={(e) => setIncludeLinuxVM(e.target.checked)}
                    disabled={isDeploying}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-700">
                      Include Linux VM Tool (Experimental)
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Bundles the v86 Linux VM image (~50MB) for bash command execution.
                      Only enable if your DML file uses the Linux VM tool.
                    </div>
                    {includeLinuxVM && (
                      <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded">
                        <p className="text-xs text-yellow-800 font-medium">
                          ⚠️ Warning: This is experimental and significantly increases deployment size.
                        </p>
                      </div>
                    )}
                  </div>
                </label>
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
            </>
          ) : (
            <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-md">
              <pre className="text-xs text-gray-800 whitespace-pre-wrap">{deployLog}</pre>
            </div>
          )}
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
