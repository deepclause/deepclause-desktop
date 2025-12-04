import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Agent operations
  initializeAgent: () => ipcRenderer.invoke('initialize-agent'),
  processInput: (input, conversationId, messages) => ipcRenderer.invoke('process-input', input, conversationId, messages),
  
  // DML operations
  createDml: (description) => ipcRenderer.invoke('create-dml', description),
  createDmlFromFile: (filename) => ipcRenderer.invoke('create-dml-from-file', filename),
  saveDml: (filename) => ipcRenderer.invoke('save-dml', filename),
  runDmlFile: (filename, parameters, conversationId) => ipcRenderer.invoke('run-dml-file', filename, parameters, conversationId),
  explainExecution: (conversationId) => ipcRenderer.invoke('explain-execution', conversationId),
  listDmlFiles: () => ipcRenderer.invoke('list-dml-files'),
  analyzeDmlFile: (filename) => ipcRenderer.invoke('analyze-dml-file', filename),
  readDmlFile: (filename) => ipcRenderer.invoke('read-dml-file', filename),
  readDmlFileContent: (filename) => ipcRenderer.invoke('read-dml-file-content', filename),
  saveDmlFileContent: (filename, content, description) => ipcRenderer.invoke('save-dml-file-content', filename, content, description),
  deleteDmlFile: (filename) => ipcRenderer.invoke('delete-dml-file', filename),
  createDmlFile: (filename) => ipcRenderer.invoke('create-dml-file', filename),
  learnDmlFile: (filename) => ipcRenderer.invoke('learn-dml-file', filename),
  
  // Tree editor operations
  readTreeJson: (filename) => ipcRenderer.invoke('read-tree-json', filename),
  generatePromptFromTree: (tree) => ipcRenderer.invoke('generate-prompt-from-tree', tree),
  compileTreeToDml: (tree) => ipcRenderer.invoke('compile-tree-to-dml', tree),
  saveDmlWithTree: (filename, content, description, tree) => ipcRenderer.invoke('save-dml-with-tree', filename, content, description, tree),
  
  // Workspace operations
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  getPaths: () => ipcRenderer.invoke('get-paths'),
  listWorkspaceFiles: () => ipcRenderer.invoke('list-workspace-files'),
  openWorkspaceFolder: () => ipcRenderer.invoke('open-workspace-folder'),
  openFileExternal: (filePath) => ipcRenderer.invoke('open-file-external', filePath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  createFile: (filePath, content) => ipcRenderer.invoke('create-file', filePath, content),
  copyFileToWorkspace: (destinationPath) => ipcRenderer.invoke('copy-file-to-workspace', destinationPath),
  
  // Execution control
  abortExecution: (conversationId) => ipcRenderer.invoke('abort-execution', conversationId),
  
  // Conversation resource management
  cleanupConversation: (conversationId) => ipcRenderer.invoke('cleanup-conversation', conversationId),
  getActiveConversationsStatus: () => ipcRenderer.invoke('get-active-conversations-status'),
  
  // User input handling (for DML requesting input)
  onRequestUserInput: (callback) => {
    // Remove any existing listeners first to prevent duplicates
    ipcRenderer.removeAllListeners('request-user-input');
    ipcRenderer.on('request-user-input', (event, data) => callback(data));
  },
  respondToInput: (requestId, userInput) => ipcRenderer.invoke('respond-to-input', requestId, userInput),
  selectWorkspaceFile: (options) => ipcRenderer.invoke('select-workspace-file', options),
  
  // Output streaming (for DML intermediate output)
  onDmlOutputChunk: (callback) => {
    // Remove any existing listeners first to prevent duplicates
    ipcRenderer.removeAllListeners('dml-output-chunk');
    ipcRenderer.on('dml-output-chunk', (event, chunk) => callback(chunk));
  },
  
  // Output streaming end signal
  onDmlOutputEnd: (callback) => {
    // Remove any existing listeners first to prevent duplicates
    ipcRenderer.removeAllListeners('dml-output-end');
    ipcRenderer.on('dml-output-end', () => callback());
  },
  
  // DML file list refresh signal
  onRefreshDmlFiles: (callback) => {
    // Remove any existing listeners first to prevent duplicates
    ipcRenderer.removeAllListeners('refresh-dml-files');
    ipcRenderer.on('refresh-dml-files', () => callback());
  },
  
  // Settings operations
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  reloadMcpServers: () => ipcRenderer.invoke('reload-mcp-servers'),
  getAvailableTools: () => ipcRenderer.invoke('get-available-tools'),
  
  // Serial console operations
  connectSerialConsole: () => ipcRenderer.invoke('connect-serial-console'),
  sendSerialInput: (data) => ipcRenderer.invoke('send-serial-input', data),
  onSerialOutput: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('serial-output', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('serial-output', listener);
  },
  
  // Conversation management operations
  createConversation: (title) => ipcRenderer.invoke('create-conversation', title),
  listConversations: () => ipcRenderer.invoke('list-conversations'),
  loadConversation: (conversationId) => ipcRenderer.invoke('load-conversation', conversationId),
  saveConversation: (conversationId, messages, title) => ipcRenderer.invoke('save-conversation', conversationId, messages, title),
  deleteConversation: (conversationId) => ipcRenderer.invoke('delete-conversation', conversationId),
  renameConversation: (conversationId, newTitle) => ipcRenderer.invoke('rename-conversation', conversationId, newTitle),
  
  // Deployment operations
  selectDeploymentFolder: () => ipcRenderer.invoke('select-deployment-folder'),
  deployDmlFileWithName: (options) => ipcRenderer.invoke('deploy-dml-file-with-name', options),
});
