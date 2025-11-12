import { useState } from 'react';
import { X, FileText, Plus } from 'lucide-react';
import { Button } from '../ui/Button';

interface NewDmlFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filename: string) => Promise<void>;
}

export function NewDmlFileDialog({ isOpen, onClose, onConfirm }: NewDmlFileDialogProps) {
  const [filename, setFilename] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    // Validate filename
    if (!filename.trim()) {
      setError('Filename cannot be empty');
      return;
    }

    // Check for valid characters (alphanumeric, dots, underscores, hyphens)
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      setError('Filename can only contain letters, numbers, dots, underscores, and hyphens');
      return;
    }

    // Check that it doesn't start or end with a dot
    if (filename.startsWith('.') || filename.endsWith('.')) {
      setError('Filename cannot start or end with a dot');
      return;
    }

    // Check for consecutive dots
    if (filename.includes('..')) {
      setError('Filename cannot contain consecutive dots');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      await onConfirm(filename);
      setFilename('');
      setError('');
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create file');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setFilename('');
      setError('');
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      handleConfirm();
    } else if (e.key === 'Escape' && !isCreating) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-white border border-border rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-light">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-deepclause-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Create New DML File</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-4">
            <label htmlFor="filename" className="block text-sm font-medium text-text-primary mb-2">
              Filename (dot notation)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="filename"
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g., browser.search or utils.helper"
                disabled={isCreating}
                autoFocus
                className="flex-1 px-3 py-2 text-sm bg-white border border-border rounded focus:outline-none focus:ring-2 focus:ring-deepclause-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-sm text-text-secondary">.dml</span>
            </div>
            <p className="text-xs text-text-secondary mt-2">
              Use dots to create files in subdirectories (e.g., "browser.search" creates "browser/search.dml")
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="bg-bg-medium p-3 rounded">
            <p className="text-xs text-text-secondary">
              <strong>Preview:</strong> {filename ? filename.replace(/\./g, '/') + '.dml' : 'filename.dml'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-bg-light border-t border-border rounded-b-lg">
          <Button onClick={handleClose} variant="secondary" disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!filename.trim() || isCreating}>
            <Plus className="w-4 h-4 mr-2" />
            {isCreating ? 'Creating...' : 'Create File'}
          </Button>
        </div>
      </div>
    </div>
  );
}
