import { create } from 'zustand';
import type { DmlTree } from '../../../shared/tree-schema';

type EditorMode = 'code' | 'tree';

interface DmlEditorState {
  // File being edited
  filename: string | null;
  content: string;
  description: string;
  
  // Tree data
  treeData: DmlTree | null;
  mode: EditorMode;
  
  // State flags
  hasChanges: boolean;
  isSaving: boolean;
  isCompiling: boolean;
  showCompileLog: boolean;
  treeNeedsCompile: boolean; // Track if tree has changed since last compilation
  
  // Actions
  openFile: (filename: string, content: string, description: string) => void;
  closeFile: () => void;
  setContent: (content: string) => void;
  setDescription: (description: string) => void;
  setTreeData: (tree: DmlTree | null) => void;
  setMode: (mode: EditorMode) => void;
  setHasChanges: (hasChanges: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
  setIsCompiling: (isCompiling: boolean) => void;
  setShowCompileLog: (show: boolean) => void;
  setTreeNeedsCompile: (needs: boolean) => void;
}

export const useDmlEditorStore = create<DmlEditorState>((set) => ({
  // Initial state
  filename: null,
  content: '',
  description: '',
  treeData: null,
  mode: 'code',
  hasChanges: false,
  isSaving: false,
  isCompiling: false,
  showCompileLog: false,
  treeNeedsCompile: false,

  // Actions
  openFile: (filename, content, description) =>
    set({
      filename,
      content,
      description,
      hasChanges: false,
      mode: 'code',
    }),

  closeFile: () =>
    set({
      filename: null,
      content: '',
      description: '',
      treeData: null,
      mode: 'code',
      hasChanges: false,
      isSaving: false,
      isCompiling: false,
      showCompileLog: false,
      treeNeedsCompile: false,
    }),

  setContent: (content) => set({ content, hasChanges: true }),
  
  setDescription: (description) => set({ description, hasChanges: true }),
  
  setTreeData: (treeData) => set({ treeData, hasChanges: true, treeNeedsCompile: true }),
  
  setMode: (mode) => set({ mode }),
  
  setHasChanges: (hasChanges) => set({ hasChanges }),
  
  setIsSaving: (isSaving) => set({ isSaving }),
  
  setIsCompiling: (isCompiling) => set({ isCompiling }),
  
  setShowCompileLog: (show) => set({ showCompileLog: show }),
  
  setTreeNeedsCompile: (needs) => set({ treeNeedsCompile: needs }),
}));
