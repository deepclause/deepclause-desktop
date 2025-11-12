import { create } from 'zustand';
import type { DmlFile } from '../types/dml';
import type { WorkspaceFile } from '../types/electron';

interface FileState {
  // DML files
  dmlFiles: DmlFile[];
  setDmlFiles: (files: DmlFile[]) => void;
  refreshDmlFiles: () => Promise<void>;

  // Workspace files
  workspaceFiles: WorkspaceFile[];
  setWorkspaceFiles: (files: WorkspaceFile[]) => void;
  refreshWorkspaceFiles: () => Promise<void>;

  // Loading state
  isLoadingDml: boolean;
  isLoadingWorkspace: boolean;
}

export const useFileStore = create<FileState>((set) => ({
  dmlFiles: [],
  workspaceFiles: [],
  isLoadingDml: false,
  isLoadingWorkspace: false,

  setDmlFiles: (files) => set({ dmlFiles: files }),

  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),

  refreshDmlFiles: async () => {
    set({ isLoadingDml: true });
    try {
      const result = await window.electronAPI.listDmlFiles();
      if (result.success && result.result) {
        const files = parseDmlFileList(result.result);
        set({ dmlFiles: files });
      }
    } catch (error) {
      console.error('Failed to refresh DML files:', error);
    } finally {
      set({ isLoadingDml: false });
    }
  },

  refreshWorkspaceFiles: async () => {
    set({ isLoadingWorkspace: true });
    try {
      const result = await window.electronAPI.listWorkspaceFiles();
      if (result.success && result.files) {
        set({ workspaceFiles: result.files });
      }
    } catch (error) {
      console.error('Failed to refresh workspace files:', error);
    } finally {
      set({ isLoadingWorkspace: false });
    }
  },
}));

// Helper function to parse DML file list
function parseDmlFileList(text: string): DmlFile[] {
  const files: DmlFile[] = [];
  const lines = text.split('\n');
  let currentFile: Partial<DmlFile> | null = null;

  for (const line of lines) {
    if (line.startsWith('📄 ')) {
      if (currentFile && currentFile.name) {
        files.push(currentFile as DmlFile);
      }
      // Parse the dot notation name (e.g., "browser.find_trials")
      const dotName = line.substring(2).trim();
      currentFile = {
        name: dotName, // Store dot notation for display and /run command
        description: '',
        parameters: [],
        path: '', // Will be filled from next line
      };
    } else if (currentFile && line.trim().startsWith('Path:')) {
      currentFile.path = line.substring(line.indexOf(':') + 1).trim();
    } else if (currentFile && line.trim().startsWith('Parameters:')) {
      const params = line.substring(line.indexOf(':') + 1).trim();
      currentFile.parameters = params
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p);
    } else if (
      currentFile &&
      line.trim() &&
      !line.startsWith('Available') &&
      !line.startsWith('Path:')
    ) {
      currentFile.description = line.trim();
    }
  }

  if (currentFile && currentFile.name) {
    files.push(currentFile as DmlFile);
  }

  return files;
}
