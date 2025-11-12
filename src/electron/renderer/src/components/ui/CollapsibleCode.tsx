import { useState } from 'react';
import { ChevronDown, ChevronRight, Code, Save, X } from 'lucide-react';

interface CollapsibleCodeProps {
  code: string;
  language?: string;
}

export function CollapsibleCode({ code }: CollapsibleCodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filename, setFilename] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async () => {
    if (!filename.trim()) {
      setErrorMessage('Filename is required');
      return;
    }

    setSaveStatus('saving');
    setErrorMessage('');

    try {
      const result = await window.electronAPI.saveDml(filename);
      if (result.success) {
        setSaveStatus('success');
        setTimeout(() => {
          setShowSaveDialog(false);
          setSaveStatus('idle');
          setFilename('');
        }, 1500);
      } else {
        setSaveStatus('error');
        setErrorMessage(result.error || 'Failed to save file');
      }
    } catch (error) {
      setSaveStatus('error');
      setErrorMessage((error as Error).message);
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSaveDialog(true);
    setSaveStatus('idle');
    setErrorMessage('');
  };

  const handleCancelSave = () => {
    setShowSaveDialog(false);
    setFilename('');
    setSaveStatus('idle');
    setErrorMessage('');
  };

  return (
    <div className="my-3 border border-deepclause-primary/30 rounded-lg overflow-hidden shadow-md bg-bg-light">
      <div className="w-full flex items-center gap-2 px-4 py-3 bg-deepclause-primary/10">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 hover:bg-deepclause-primary/10 transition-colors text-left rounded px-2 py-1 -mx-2 -my-1"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
          )}
          <Code className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
          <span className="font-semibold text-sm text-deepclause-primary">
            Generated DML Code
          </span>
          <span className="ml-auto text-xs text-text-secondary font-mono">
            {code.split('\n').length} lines
          </span>
        </button>
        
        <button
          onClick={handleSaveClick}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-deepclause-primary text-white rounded-md hover:bg-deepclause-primary/90 transition-colors text-sm font-medium shadow-sm"
          title="Save DML file"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>
      </div>
      
      {isExpanded && (
        <div className="border-t border-deepclause-primary/20">
          <pre className="overflow-x-auto p-4 bg-white">
            <code className="text-sm font-mono text-text-primary whitespace-pre">
              {code}
            </code>
          </pre>
        </div>
      )}

      {/* Save Dialog Modal */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelSave}>
          <div className="bg-bg-medium border border-border rounded-lg shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Save DML File</h3>
              <button
                onClick={handleCancelSave}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-text-primary mb-2">
                Filename (e.g., my_script.dml or category/script.dml)
              </label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  } else if (e.key === 'Escape') {
                    handleCancelSave();
                  }
                }}
                placeholder="example.dml"
                className="w-full px-3 py-2 bg-bg-light border border-border rounded-md text-text-primary placeholder-text-secondary focus:outline-none focus:border-deepclause-primary"
                autoFocus
                disabled={saveStatus === 'saving'}
              />
              <p className="text-xs text-text-secondary mt-1">
                File will be saved in dml_examples directory
              </p>
            </div>

            {errorMessage && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-md text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            {saveStatus === 'success' && (
              <div className="mb-4 p-3 bg-green-900/20 border border-green-500/30 rounded-md text-sm text-green-400">
                ✓ File saved successfully!
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelSave}
                className="px-4 py-2 bg-bg-light border border-border rounded-md text-text-primary hover:bg-bg-darkest transition-colors"
                disabled={saveStatus === 'saving'}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-deepclause-primary text-white rounded-md hover:bg-deepclause-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={saveStatus === 'saving' || !filename.trim()}
              >
                {saveStatus === 'saving' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
