import { create } from 'zustand';
import type { ViewType, SidebarState } from '../types/dml';
import type { Paths, InputRequest } from '../types/electron';

interface AppState {
  // View state
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;

  // Sidebar state
  sidebars: SidebarState;
  toggleSidebar: (side: keyof SidebarState) => void;

  // Processing state
  isProcessing: boolean;
  setProcessing: (processing: boolean) => void;
  
  // Aborting state
  isAborting: boolean;
  setAborting: (aborting: boolean) => void;

  // Status
  status: string;
  setStatus: (status: string) => void;

  // Paths
  currentPaths: Paths | null;
  setPaths: (paths: Paths) => void;

  // Input control (for setting input from file clicks, etc)
  pendingInput: string | null;
  setPendingInput: (input: string | null) => void;

  // Input dialog (for DML user input requests)
  inputRequest: InputRequest | null;
  setInputRequest: (request: InputRequest | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  activeView: 'chat',
  sidebars: {
    conversations: false,
    dml: false,
    workspace: false,
    console: false,
  },
  isProcessing: false,
  isAborting: false,
  status: 'Ready',
  currentPaths: null,
  pendingInput: null,
  inputRequest: null,

  // Actions
  setActiveView: (view) => set({ activeView: view }),

  toggleSidebar: (side) =>
    set((state) => ({
      sidebars: {
        ...state.sidebars,
        [side]: !state.sidebars[side],
      },
    })),

  setProcessing: (processing) => set({ isProcessing: processing }),
  
  setAborting: (aborting) => set({ isAborting: aborting }),

  setStatus: (status) => set({ status }),

  setPaths: (paths) => set({ currentPaths: paths }),

  setPendingInput: (input) => set({ pendingInput: input }),

  setInputRequest: (request) => set({ inputRequest: request }),
}));
