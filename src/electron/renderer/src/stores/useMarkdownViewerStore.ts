import { create } from 'zustand';

interface MarkdownViewerState {
  isOpen: boolean;
  filePath: string | null;
  fileName: string | null;
  openMarkdownFile: (filePath: string, fileName: string) => void;
  closeMarkdownViewer: () => void;
}

export const useMarkdownViewerStore = create<MarkdownViewerState>((set) => ({
  isOpen: false,
  filePath: null,
  fileName: null,
  openMarkdownFile: (filePath: string, fileName: string) => {
    set({ isOpen: true, filePath, fileName });
  },
  closeMarkdownViewer: () => {
    set({ isOpen: false, filePath: null, fileName: null });
  },
}));
