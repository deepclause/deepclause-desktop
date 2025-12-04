export interface ElectronAPI {
  // Agent operations
  initializeAgent: () => Promise<{
    success: boolean;
    paths?: Paths;
    error?: string;
  }>;
  processInput: (input: string, conversationId: string, messages?: any[]) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;

  // DML operations
  createDml: (description: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  createDmlFromFile: (filename: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  saveDml: (filename: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  runDmlFile: (filename: string, parameters: string, conversationId?: string | null) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  explainExecution: (conversationId: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  listDmlFiles: () => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  analyzeDmlFile: (filename: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  readDmlFile: (filename: string) => Promise<{
    success: boolean;
    result?: string;
    error?: string;
  }>;
  readDmlFileContent: (filename: string) => Promise<{
    success: boolean;
    content?: string;
    description?: string;
    error?: string;
  }>;
  saveDmlFileContent: (filename: string, content: string, description?: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  deleteDmlFile: (filename: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  createDmlFile: (filename: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  learnDmlFile: (filename: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;

  // Tree editor operations
  readTreeJson: (filename: string) => Promise<{
    success: boolean;
    tree?: any; // DmlTree type
    error?: string;
  }>;
  generatePromptFromTree: (tree: any) => Promise<string>;
  compileTreeToDml: (tree: any) => Promise<{
    success: boolean;
    dml?: string;
    error?: string;
  }>;
  saveDmlWithTree: (
    filename: string,
    content: string,
    description: string,
    tree: any
  ) => Promise<{
    success: boolean;
    error?: string;
  }>;

  // Workspace operations
  selectWorkspace: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  getPaths: () => Promise<{
    success: boolean;
    paths?: Paths;
    error?: string;
  }>;
  listWorkspaceFiles: () => Promise<{
    success: boolean;
    files?: WorkspaceFile[];
    error?: string;
  }>;
  openWorkspaceFolder: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  openFileExternal: (filePath: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  readFile: (filePath: string) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }>;
  writeFile: (filePath: string, content: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  createFolder: (folderPath: string) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  createFile: (filePath: string, content?: string) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  copyFileToWorkspace: (destinationPath: string) => Promise<{
    success: boolean;
    path?: string;
    fileName?: string;
    error?: string;
  }>;

  // Execution control
  abortExecution: (conversationId?: string) => Promise<void>;
  
  // Conversation resource management
  cleanupConversation: (conversationId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  getActiveConversationsStatus: () => Promise<{
    success: boolean;
    status?: ConversationStatus[];
    error?: string;
  }>;

  // User input handling
  onRequestUserInput: (callback: (data: InputRequest) => void) => void;
  respondToInput: (requestId: string, userInput: string) => Promise<void>;
  selectWorkspaceFile: (options?: FileSelectionOptions) => Promise<{
    success: boolean;
    filePath?: string;
    absolutePath?: string;
    canceled?: boolean;
    error?: string;
  }>;

  // Output streaming
  onDmlOutputChunk: (callback: (chunk: string) => void) => void;
  onDmlOutputEnd: (callback: () => void) => void;
  
  // DML file list refresh
  onRefreshDmlFiles: (callback: () => void) => void;

  // Settings operations
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  reloadMcpServers: () => Promise<void>;
  getAvailableTools: () => Promise<{
    success: boolean;
    tools?: string[];
    error?: string;
  }>;

  // Serial console operations
  connectSerialConsole: () => Promise<void>;
  sendSerialInput: (data: string) => Promise<void>;
  onSerialOutput: (callback: (data: string) => void) => () => void;
  
  // Conversation management operations
  createConversation: (title: string) => Promise<{
    success: boolean;
    conversation?: Conversation;
    error?: string;
  }>;
  listConversations: () => Promise<{
    success: boolean;
    conversations?: ConversationMetadata[];
    error?: string;
  }>;
  loadConversation: (conversationId: string) => Promise<{
    success: boolean;
    conversation?: Conversation;
    error?: string;
  }>;
  saveConversation: (conversationId: string, messages: any[], title: string) => Promise<{
    success: boolean;
    conversation?: Conversation;
    error?: string;
  }>;
  deleteConversation: (conversationId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  renameConversation: (conversationId: string, newTitle: string) => Promise<{
    success: boolean;
    conversation?: Conversation;
    error?: string;
  }>;

  // Deployment operations
  selectDeploymentFolder: () => Promise<{
    success: boolean;
    folderPath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  deployDmlFileWithName: (options: {
    dmlFilePath: string;
    deploymentName: string;
    outputFolder: string;
    workspaceDir: string;
  }) => Promise<{
    success: boolean;
    deploymentPath?: string;
    deploymentName?: string;
    canceled?: boolean;
    error?: string;
  }>;
}

export interface Paths {
  workspace: string;
  dmlExamples: string;
  config: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  fullPath?: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface InputRequest {
  requestId: string;
  promptText: string;
  inputType?: 'text' | 'file' | 'select' | 'multiselect';
  options?: string[];
}

export interface FileSelectionOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Conversation extends ConversationMetadata {
  messages: any[];
}

export interface ConversationStatus {
  conversationId: string;
  status: 'active' | 'idle' | 'executing' | 'aborted' | 'error';
  createdAt: number;
  duration: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
