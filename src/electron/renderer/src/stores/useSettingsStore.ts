import { create } from 'zustand';

export interface ModelConfig {
  provider: 'openai' | 'google' | 'anthropic' | 'openrouter';
  name: string;
  temperature: number;
}

export interface ApiKeys {
  OPENAI_API_KEY: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  OPENROUTER_API_KEY: string;
}

export interface McpServer {
  name: string;
  type: 'stdio' | 'http' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
}

export interface DefaultTools {
  // Search tools (only one can be enabled at a time)
  brave_search: boolean;
  you_search: boolean;
  google_search: boolean;
  
  // Academic/supplementary search (independent)
  google_scholar_search: boolean;
  
  // Other tools
  visit_webpage: boolean;
  workspace_reader: boolean;
  file_downloader: boolean;
  visualizer: boolean;
  diagram_generator: boolean;
  data_analyzer: boolean;
  linux_vm: boolean;
}

export interface Settings {
  models: {
    goal: ModelConfig;
    converter: ModelConfig;
    agent: ModelConfig;
  };
  apiKeys: ApiKeys;
  mcp_servers: McpServer[];
  environmentVariables?: EnvironmentVariable[];
  defaultTools?: DefaultTools;
}

interface SettingsState {
  settings: Settings | null;
  isLoading: boolean;
  isOpen: boolean;
  
  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
}

const defaultSettings: Settings = {
  models: {
    goal: { provider: 'google', name: 'gemini-2.5-flash', temperature: 0.0 },
    converter: { provider: 'google', name: 'gemini-2.5-pro', temperature: 0.1 },
    agent: { provider: 'google', name: 'gemini-2.5-flash', temperature: 0.0 },
  },
  apiKeys: {
    OPENAI_API_KEY: '',
    GOOGLE_GENERATIVE_AI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OPENROUTER_API_KEY: '',
  },
  mcp_servers: [],
  environmentVariables: [],
  defaultTools: {
    // Search tools (only one enabled by default)
    brave_search: false,
    you_search: true,
    google_search: false,
    
    // Academic/supplementary search (independent)
    google_scholar_search: true,
    
    // Other tools (all enabled by default)
    visit_webpage: true,
    workspace_reader: true,
    file_downloader: true,
    visualizer: true,
    diagram_generator: true,
    data_analyzer: true,
    linux_vm: true, // Enabled by default
  },
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  isOpen: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const loadedSettings = await window.electronAPI.getSettings();
      set({ 
        settings: { ...defaultSettings, ...loadedSettings },
        isLoading: false 
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
      set({ settings: defaultSettings, isLoading: false });
    }
  },

  saveSettings: async (settings: Settings) => {
    set({ isLoading: true });
    try {
      await window.electronAPI.saveSettings(settings);
      set({ settings, isLoading: false });
    } catch (error) {
      console.error('Failed to save settings:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  openDialog: () => set({ isOpen: true }),
  closeDialog: () => set({ isOpen: false }),
}));
