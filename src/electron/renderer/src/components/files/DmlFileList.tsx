import { useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { useFileStore } from '../../stores/useFileStore';
import { useAppStore } from '../../stores/useAppStore';
import { DmlFileTree } from './DmlFileTree';
import { DmlEditorDialog } from '../modals/DmlEditorDialog';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { NewDmlFileDialog } from '../modals/NewDmlFileDialog';

// Store for managing new file dialog state
let openNewFileDialog: (() => void) | null = null;

export function DmlFileList() {
  const { dmlFiles, isLoadingDml, refreshDmlFiles } = useFileStore();
  const setPendingInput = useAppStore((state) => state.setPendingInput);

  // Editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingFilename, setEditingFilename] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editingDescription, setEditingDescription] = useState('');

  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState('');

  // New file dialog state
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);

  // Expose the function to open new file dialog
  openNewFileDialog = () => setIsNewFileDialogOpen(true);

  const handleFileClick = (filename: string) => {
    // Set pending input via store (React-friendly way)
    setPendingInput(`/run ${filename}`);
  };

  const handleFileEdit = async (filename: string) => {
    try {
      const result = await window.electronAPI.readDmlFileContent(filename);
      if (result.success && result.content !== undefined) {
        setEditingFilename(filename);
        setEditingContent(result.content);
        setEditingDescription(result.description || '');
        setIsEditorOpen(true);
      } else {
        alert(`Failed to load file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error loading file for editing:', error);
      alert(`Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFileDelete = (filename: string) => {
    setDeletingFilename(filename);
    setIsDeleteDialogOpen(true);
  };

  const handleSaveFile = async (content: string, description: string) => {
    try {
      const result = await window.electronAPI.saveDmlFileContent(editingFilename, content, description);
      if (result.success) {
        await refreshDmlFiles();
        return;
      } else {
        throw new Error(result.error || 'Failed to save file');
      }
    } catch (error) {
      throw error;
    }
  };

  const handleConfirmDelete = async () => {
    try {
      const result = await window.electronAPI.deleteDmlFile(deletingFilename);
      if (result.success) {
        await refreshDmlFiles();
        setIsDeleteDialogOpen(false);
        setDeletingFilename('');
      } else {
        alert(`Failed to delete file: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert(`Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCancelDelete = () => {
    setIsDeleteDialogOpen(false);
    setDeletingFilename('');
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingFilename('');
    setEditingContent('');
    setEditingDescription('');
  };

  const handleCreateNewFile = async (filename: string) => {
    try {
      const result = await window.electronAPI.createDmlFile(filename);
      if (result.success) {
        await refreshDmlFiles();
        // Open the newly created file in the editor
        await handleFileEdit(filename);
      } else {
        throw new Error(result.error || 'Failed to create file');
      }
    } catch (error) {
      throw error; // Let the dialog handle the error display
    }
  };

  if (isLoadingDml) {
    return (
      <div className="text-center text-text-secondary py-8">
        <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
        Loading files...
      </div>
    );
  }

  if (dmlFiles.length === 0) {
    return (
      <div className="text-center text-text-secondary py-8">
        No DML files found
      </div>
    );
  }

  return (
    <>
      <DmlFileTree
        files={dmlFiles}
        onFileClick={handleFileClick}
        onFileEdit={handleFileEdit}
        onFileDelete={handleFileDelete}
      />

      <DmlEditorDialog
        isOpen={isEditorOpen}
        filename={editingFilename}
        initialContent={editingContent}
        initialDescription={editingDescription}
        onClose={handleCloseEditor}
        onSave={handleSaveFile}
      />

      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        title="Delete DML File"
        message={`Are you sure you want to delete "${deletingFilename}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      <NewDmlFileDialog
        isOpen={isNewFileDialogOpen}
        onClose={() => setIsNewFileDialogOpen(false)}
        onConfirm={handleCreateNewFile}
      />
    </>
  );
}

interface DmlFileListActionsProps {
  onRefresh: () => void;
}

export function DmlFileListActions({ onRefresh }: DmlFileListActionsProps) {
  const handleNewFile = () => {
    if (openNewFileDialog) {
      openNewFileDialog();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleNewFile}
        className="p-1 hover:bg-bg-light rounded transition-colors text-deepclause-primary"
        title="Create new DML file"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        onClick={onRefresh}
        className="p-1 hover:bg-bg-light rounded transition-colors"
        title="Refresh file list"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
}
