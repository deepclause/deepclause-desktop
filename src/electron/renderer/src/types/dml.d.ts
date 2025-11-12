export type MessageType = 'user' | 'agent' | 'system' | 'error' | 'streaming';

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  raw?: boolean;
}

export interface StreamingMessage {
  id: string;
  content: string;
  timestamp: Date;
}

export interface DmlFile {
  name: string; // Dot notation name (e.g., "browser.find_trials")
  description: string;
  parameters: string[];
  path?: string; // Relative file path (e.g., "browser/find_trials.dml")
}

export interface EditorFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
}

export type ViewType = 'chat' | 'editor' | 'settings';

export interface SidebarState {
  conversations: boolean;
  dml: boolean;
  workspace: boolean;
  console: boolean;
}
