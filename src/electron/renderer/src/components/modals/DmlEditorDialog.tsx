import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';

interface DmlEditorDialogProps {
  isOpen: boolean;
  filename: string;
  initialContent: string;
  initialDescription?: string;
  onClose: () => void;
  onSave: (content: string, description: string) => Promise<void>;
}

export function DmlEditorDialog({
  isOpen,
  filename,
  initialContent,
  initialDescription = '',
  onClose,
  onSave,
}: DmlEditorDialogProps) {
  const [content, setContent] = useState(initialContent);
  const [description, setDescription] = useState(initialDescription);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setContent(initialContent);
    setDescription(initialDescription);
    setHasChanges(false);
  }, [initialContent, initialDescription, isOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(content, description);
      setHasChanges(false);
      onClose();
    } catch (error) {
      console.error('Failed to save DML file:', error);
      alert(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setContent(initialContent);
    setDescription(initialDescription);
    setHasChanges(false);
  };

  const handleContentChange = (value: string | undefined) => {
    const newContent = value || '';
    setContent(newContent);
    setHasChanges(newContent !== initialContent || description !== initialDescription);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDescription = e.target.value;
    setDescription(newDescription);
    setHasChanges(content !== initialContent || newDescription !== initialDescription);
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close?'
      );
      if (!confirmed) return;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-white border border-border rounded-lg shadow-2xl w-[90vw] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-light">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">DML Editor</h2>
            <p className="text-sm text-text-secondary mt-1">
              {filename}
              {hasChanges && <span className="text-deepclause-primary ml-2">• Modified</span>}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Description Section */}
        <div className="px-6 py-3 border-b border-border bg-bg-medium">
          <label className="block text-xs font-semibold text-text-secondary mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={handleDescriptionChange}
            placeholder="Enter a brief description of what this DML file does..."
            className="w-full px-3 py-2 text-sm bg-white border border-border rounded resize-none focus:outline-none focus:ring-2 focus:ring-deepclause-primary focus:border-transparent"
            rows={2}
          />
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="prolog"
            value={content}
            onChange={handleContentChange}
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-light">
          <div className="text-sm text-text-secondary">
            {content.split('\n').length} lines • {content.length} characters
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
              variant="secondary"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button onClick={handleClose} variant="secondary" disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
