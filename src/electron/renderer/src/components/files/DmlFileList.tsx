import { useState } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { useFileStore } from '../../stores/useFileStore';
import { useAppStore } from '../../stores/useAppStore';
import { useDmlEditorStore } from '../../stores/useDmlEditorStore';
import { DmlFileTree } from './DmlFileTree';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { NewDmlFileDialog } from '../modals/NewDmlFileDialog';
import { DeploymentDialog } from '../DeploymentDialog';

// Store for managing new file dialog state
let openNewFileDialog: (() => void) | null = null;

export function DmlFileList() {
  const { dmlFiles, isLoadingDml, refreshDmlFiles } = useFileStore();
  const setPendingInput = useAppStore((state) => state.setPendingInput);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const currentPaths = useAppStore((state) => state.currentPaths);
  const openFile = useDmlEditorStore((state) => state.openFile);

  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState('');

  // New file dialog state
  const [isNewFileDialogOpen, setIsNewFileDialogOpen] = useState(false);

  // Deployment dialog state
  const [isDeployDialogOpen, setIsDeployDialogOpen] = useState(false);
  const [deployingFilename, setDeployingFilename] = useState('');

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
        openFile(filename, result.content, result.description || '');
        setActiveView('editor');
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

  const handleFileDeploy = (filename: string) => {
    setDeployingFilename(filename);
    setIsDeployDialogOpen(true);
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
        onFileDeploy={handleFileDeploy}
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

      <DeploymentDialog
        isOpen={isDeployDialogOpen}
        onClose={() => setIsDeployDialogOpen(false)}
        dmlFilePath={deployingFilename}
        workspaceDir={currentPaths?.workspace || ''}
        onDeploymentComplete={(result: { deploymentPath: string; deploymentName: string }) => {
          console.log('✅ Deployment created:', result.deploymentPath);
          // Could show a success toast here
        }}
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
