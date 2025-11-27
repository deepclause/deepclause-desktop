import { ipcMain, dialog, BrowserWindow } from 'electron';
import { shell } from 'electron';
import { DMLAgent } from './dml-agent.js';
import path from 'path';

let dmlAgent = null;
let currentWorkspaceManager = null;
let pendingInputRequests = new Map(); // Track pending input requests
let serialOutputListener = null; // Track serial output listener to avoid duplicates

/**
 * Setup all IPC handlers for communication between main and renderer
 */
export function setupIpcHandlers(workspaceManager) {
  currentWorkspaceManager = workspaceManager;

  // Initialize DML Agent with workspace paths
  ipcMain.handle('initialize-agent', async () => {
    try {
      const paths = {
        workspace: workspaceManager.getWorkspacePath(),
        dmlExamples: workspaceManager.getDmlExamplesPath(),
        config: workspaceManager.getConfigPath()
      };

      // Create input callback for user input requests
      const inputCallback = createInputCallback();
      
      // Create output callback for streaming output
      const outputCallback = createOutputCallback();
      
      dmlAgent = new DMLAgent(paths, inputCallback, outputCallback);
      return { success: true, paths };
    } catch (error) {
      console.error('Failed to initialize agent:', error);
      return { success: false, error: error.message };
    }
  });

  // Process natural language input
  ipcMain.handle('process-input', async (event, input, conversationId, messages = []) => {
    console.log(`[ABORT] IPC 'process-input' received conversationId: ${conversationId}`);
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      
      if (!conversationId) {
        throw new Error('conversationId is required');
      }
      
      console.log(`[ABORT] Calling dmlAgent.processNaturalLanguageInput with conversationId: ${conversationId}`);
      const result = await dmlAgent.processNaturalLanguageInput(input, conversationId, messages);
      
      // Signal end of streaming
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: true, result };
    } catch (error) {
      console.error('Error processing input:', error);
      
      // Signal end of streaming even on error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: false, error: error.message };
    }
  });

  // Create DML from description
  ipcMain.handle('create-dml', async (event, description) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.createDml(description);
      
      // Signal end of streaming
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: true, result };
    } catch (error) {
      console.error('Error creating DML:', error);
      
      // Signal end of streaming even on error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: false, error: error.message };
    }
  });

  // Create DML from file
  ipcMain.handle('create-dml-from-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.createDmlFromFile(filename);
      return { success: true, result };
    } catch (error) {
      console.error('Error creating DML from file:', error);
      return { success: false, error: error.message };
    }
  });

  // Save generated DML
  ipcMain.handle('save-dml', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = dmlAgent.saveDml(filename);
      
      // Trigger DML file list refresh in the renderer
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('refresh-dml-files');
      }
      
      return { success: true, result };
    } catch (error) {
      console.error('Error saving DML:', error);
      return { success: false, error: error.message };
    }
  });

  // Run DML file
  ipcMain.handle('run-dml-file', async (event, filename, parameters, conversationId = null) => {
    console.log(`[ABORT] IPC 'run-dml-file' received filename: ${filename}, conversationId: ${conversationId}`);
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.runDmlFile(filename, parameters, conversationId);
      
      // Signal end of streaming
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: true, result };
    } catch (error) {
      console.error('Error running DML file:', error);
      
      // Signal end of streaming even on error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: false, error: error.message };
    }
  });

  // List DML files
  ipcMain.handle('list-dml-files', async () => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.listDmlFiles();
      return { success: true, result };
    } catch (error) {
      console.error('Error listing DML files:', error);
      return { success: false, error: error.message };
    }
  });

  // Analyze DML file
  ipcMain.handle('analyze-dml-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.analyzeDmlFile(filename);
      return { success: true, result };
    } catch (error) {
      console.error('Error analyzing DML file:', error);
      return { success: false, error: error.message };
    }
  });

  // Read DML file
  ipcMain.handle('read-dml-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.readDmlFile(filename);
      return { success: true, result };
    } catch (error) {
      console.error('Error reading DML file:', error);
      return { success: false, error: error.message };
    }
  });

  // Read DML file content (raw content for editing)
  ipcMain.handle('read-dml-file-content', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.readDmlFileContent(filename);
      return { success: true, ...result };
    } catch (error) {
      console.error('Error reading DML file content:', error);
      return { success: false, error: error.message };
    }
  });

  // Save DML file content
  ipcMain.handle('save-dml-file-content', async (event, filename, content, description) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.saveDmlFileContent(filename, content, description);
      return { success: true, message: result };
    } catch (error) {
      console.error('Error saving DML file content:', error);
      return { success: false, error: error.message };
    }
  });

  // Delete DML file
  ipcMain.handle('delete-dml-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.deleteDmlFile(filename);
      return { success: true, message: result };
    } catch (error) {
      console.error('Error deleting DML file:', error);
      return { success: false, error: error.message };
    }
  });

  // Create new DML file
  ipcMain.handle('create-dml-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.createDmlFile(filename);
      return { success: true, message: result };
    } catch (error) {
      console.error('Error creating DML file:', error);
      return { success: false, error: error.message };
    }
  });

  // Learn DML file (copy to learned folder)
  ipcMain.handle('learn-dml-file', async (event, filename) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = await dmlAgent.learnDmlFile(filename);
      return { success: true, message: result };
    } catch (error) {
      console.error('Error learning DML file:', error);
      return { success: false, error: error.message };
    }
  });

  // Explain last execution
  ipcMain.handle('explain-execution', async (event, conversationId) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      if (!conversationId) {
        throw new Error('conversationId is required');
      }
      
      const result = await dmlAgent.explainLastExecution(conversationId);
      
      // Signal end of output
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: true, result };
    } catch (error) {
      console.error('Error explaining execution:', error);
      
      // Signal end even on error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: false, error: error.message };
    }
  });

  // Select workspace folder
  ipcMain.handle('select-workspace', async () => {
    try {
      const result = await workspaceManager.selectWorkspaceFolder();
      if (result) {
        return { success: true, path: result };
      }
      return { success: false };
    } catch (error) {
      console.error('Error selecting workspace:', error);
      return { success: false, error: error.message };
    }
  });

  // Get current paths
  ipcMain.handle('get-paths', async () => {
    try {
      return {
        success: true,
        paths: {
          workspace: workspaceManager.getWorkspacePath(),
          dmlExamples: workspaceManager.getDmlExamplesPath(),
          config: workspaceManager.getConfigPath()
        }
      };
    } catch (error) {
      console.error('Error getting paths:', error);
      return { success: false, error: error.message };
    }
  });

  // List workspace files
  ipcMain.handle('list-workspace-files', async () => {
    try {
      const workspacePath = workspaceManager.getWorkspacePath();
      const fs = await import('fs');
      const files = [];
      
      function readDirRecursive(dir, relativePath = '') {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);
          
          if (entry.isDirectory()) {
            // Always add directory entries, even if empty
            const stats = fs.statSync(fullPath);
            files.push({
              name: entry.name,
              path: relPath,
              fullPath: fullPath,
              type: 'directory',
              modified: stats.mtime,
              children: []
            });
            // Recurse into directory
            readDirRecursive(fullPath, relPath);
          } else {
            const stats = fs.statSync(fullPath);
            files.push({
              name: entry.name,
              path: relPath,
              fullPath: fullPath,
              type: 'file',
              size: stats.size,
              modified: stats.mtime
            });
          }
        }
      }
      
      readDirRecursive(workspacePath);
      
      return { success: true, files, workspacePath };
    } catch (error) {
      console.error('Error listing workspace files:', error);
      return { success: false, error: error.message };
    }
  });

  // Open workspace folder in file manager
  ipcMain.handle('open-workspace-folder', async () => {
    try {
      const workspacePath = workspaceManager.getWorkspacePath();
      await shell.openPath(workspacePath);
      return { success: true };
    } catch (error) {
      console.error('Error opening workspace folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Select a file from workspace for parameter input
  ipcMain.handle('select-workspace-file', async (event, options = {}) => {
    try {
      const workspacePath = workspaceManager.getWorkspacePath();
      
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select File',
        defaultPath: workspacePath,
        properties: ['openFile'],
        filters: options.filters || [
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      
      const selectedPath = result.filePaths[0];
      
      // Return relative path if within workspace, otherwise absolute path
      let relativePath = selectedPath;
      if (selectedPath.startsWith(workspacePath)) {
        relativePath = path.relative(workspacePath, selectedPath);
      }
      
      return { 
        success: true, 
        filePath: relativePath,
        absolutePath: selectedPath
      };
    } catch (error) {
      console.error('Error selecting workspace file:', error);
      return { success: false, error: error.message };
    }
  });

  // Open file with default application
  ipcMain.handle('open-file-external', async (event, filePath) => {
    try {
      const workspacePath = workspaceManager.getWorkspacePath();
      const fullPath = path.join(workspacePath, filePath);
      await shell.openPath(fullPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening file:', error);
      return { success: false, error: error.message };
    }
  });

  // Read file content
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (error) {
      console.error('Error reading file:', error);
      return { success: false, error: error.message };
    }
  });

  // Write file content
  ipcMain.handle('write-file', async (event, filePath, content) => {
    try {
      const fs = await import('fs');
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      return { success: false, error: error.message };
    }
  });

  // Create new folder in workspace
  ipcMain.handle('create-folder', async (event, folderPath) => {
    try {
      const fs = await import('fs');
      const workspacePath = workspaceManager.getWorkspacePath();
      const fullPath = path.join(workspacePath, folderPath);
      
      // Create folder recursively
      fs.mkdirSync(fullPath, { recursive: true });
      return { success: true, path: fullPath };
    } catch (error) {
      console.error('Error creating folder:', error);
      return { success: false, error: error.message };
    }
  });

  // Create new file in workspace
  ipcMain.handle('create-file', async (event, filePath, content = '') => {
    try {
      const fs = await import('fs');
      const workspacePath = workspaceManager.getWorkspacePath();
      const fullPath = path.join(workspacePath, filePath);
      
      // Ensure parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      // Create file with content
      fs.writeFileSync(fullPath, content, 'utf-8');
      return { success: true, path: fullPath };
    } catch (error) {
      console.error('Error creating file:', error);
      return { success: false, error: error.message };
    }
  });

  // Select and copy file to workspace
  ipcMain.handle('copy-file-to-workspace', async (event, destinationPath) => {
    try {
      const fs = await import('fs');
      
      // Show file picker
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select File to Copy to Workspace'
      });
      
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No file selected' };
      }
      
      const sourcePath = result.filePaths[0];
      const workspacePath = workspaceManager.getWorkspacePath();
      
      // Use provided destination path or just the filename
      const fileName = path.basename(sourcePath);
      const destPath = destinationPath 
        ? path.join(workspacePath, destinationPath, fileName)
        : path.join(workspacePath, fileName);
      
      // Ensure parent directory exists
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      // Copy file
      fs.copyFileSync(sourcePath, destPath);
      
      return { success: true, path: destPath, fileName };
    } catch (error) {
      console.error('Error copying file to workspace:', error);
      return { success: false, error: error.message };
    }
  });

    // Abort current DML execution
  ipcMain.handle('abort-execution', async (event, conversationId = null) => {
    console.log(`[ABORT] IPC 'abort-execution' received conversationId: ${conversationId}`);
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      
      if (conversationId) {
        console.log(`[ABORT] Calling dmlAgent.abortConversation with conversationId: ${conversationId}`);
        // Abort specific conversation
        dmlAgent.abortConversation(conversationId);
      } else {
        console.log(`[ABORT] Calling dmlAgent.abortExecution (all conversations)`);
        // Abort all conversations (legacy behavior)
        dmlAgent.abortExecution();
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error aborting execution:', error);
      return { success: false, error: error.message };
    }
  });

  // Respond to input request from DML
  ipcMain.handle('respond-to-input', async (event, requestId, userInput) => {
    try {
      const resolver = pendingInputRequests.get(requestId);
      if (resolver) {
        resolver(userInput);
        pendingInputRequests.delete(requestId);
        return { success: true };
      }
      return { success: false, error: 'No pending input request found' };
    } catch (error) {
      console.error('Error responding to input:', error);
      return { success: false, error: error.message };
    }
  });

  // Settings operations
  ipcMain.handle('get-settings', async () => {
    try {
      const fs = await import('fs');
      const settingsPath = workspaceManager.getSettingsPath();
      
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(data);
      }
      
      // Return default settings if file doesn't exist
      return {
        models: {
          goal: { provider: 'google', name: 'gemini-2.5-flash', temperature: 0.0 },
          converter: { provider: 'google', name: 'gemini-2.5-pro', temperature: 0.1 },
          agent: { provider: 'google', name: 'gemini-2.5-flash', temperature: 0.0 }
        },
        apiKeys: {
          OPENAI_API_KEY: '',
          GOOGLE_GENERATIVE_AI_API_KEY: '',
          ANTHROPIC_API_KEY: '',
          OPENROUTER_API_KEY: ''
        },
        defaultTools: {
          brave_search: false,
          you_search: true,
          google_search: false,
          google_scholar_search: true,
          visit_webpage: true,
          workspace_reader: true,
          file_downloader: true,
          visualizer: true,
          diagram_generator: true,
          data_analyzer: true,
          linux_vm: true
        }
      };
    } catch (error) {
      console.error('Failed to get settings:', error);
      throw error;
    }
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      const fs = await import('fs');
      const settingsPath = workspaceManager.getSettingsPath();
      
      // Ensure directory exists
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }
      
      // Read existing settings
      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf-8');
        existingSettings = JSON.parse(data);
      }
      
      // Merge with new settings
      const updatedSettings = {
        ...existingSettings,
        models: settings.models,
        apiKeys: settings.apiKeys,
        mcp_servers: settings.mcp_servers,
        environmentVariables: settings.environmentVariables || [],
        defaultTools: settings.defaultTools || existingSettings.defaultTools || {}
      };
      
      // Write back to file
      fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
      
      // Update process.env with API keys so they're available immediately
      Object.entries(settings.apiKeys).forEach(([key, value]) => {
        if (value) {
          process.env[key] = value;
        }
      });
      
      // Update process.env with custom environment variables
      if (settings.environmentVariables && Array.isArray(settings.environmentVariables)) {
        settings.environmentVariables.forEach(({ key, value }) => {
          if (key && value) {
            process.env[key] = value;
            console.log(`Set environment variable: ${key}`);
          }
        });
      }
      
      // Invalidate the config cache in models.js by updating mtime
      // This will be picked up automatically on next config read
      const now = new Date();
      fs.utimesSync(settingsPath, now, now);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  });

  ipcMain.handle('reload-mcp-servers', async () => {
    try {
      if (!dmlAgent) {
        console.warn('Agent not initialized, skipping MCP reload');
        return { success: false, error: 'Agent not initialized' };
      }
      
      // Reload MCP servers through the bridge
      const { reloadMcpServers } = await import('../../dml-js/bridge.js');
      await reloadMcpServers();
      
      return { success: true };
    } catch (error) {
      console.error('Failed to reload MCP servers:', error);
      return { success: false, error: error.message };
    }
  });

  // Serial console handlers for v86 VM
  ipcMain.handle('connect-serial-console', async () => {
    try {
      // Get the global LinuxVMTool instance from dml-js/tools
      const { getGlobalLinuxVMTool } = await import('../../dml-js/tools.js');
      const vmTool = getGlobalLinuxVMTool();
      
      if (!vmTool || !vmTool.emulator) {
        console.log('VM not yet initialized, will connect when ready');
        return { success: false, error: 'VM not initialized' };
      }

      // Remove existing listener if any to prevent duplicates
      if (serialOutputListener) {
        vmTool.emulator.remove_listener('serial0-output-byte', serialOutputListener);
      }

      // Create and store the listener
      serialOutputListener = function(byte) {
        const chr = String.fromCharCode(byte);
        if (chr <= '~') {
          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow) {
            mainWindow.webContents.send('serial-output', chr);
          }
        }
      };

      // Set up listener for serial output
      vmTool.emulator.add_listener('serial0-output-byte', serialOutputListener);

      console.log('Serial console connected to v86 emulator');
      return { success: true };
    } catch (error) {
      console.error('Failed to connect serial console:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('send-serial-input', async (event, data) => {
    try {
      const { getGlobalLinuxVMTool } = await import('../../dml-js/tools.js');
      const vmTool = getGlobalLinuxVMTool();
      
      if (!vmTool || !vmTool.emulator) {
        return { success: false, error: 'VM not initialized' };
      }

      vmTool.emulator.serial0_send(data);
      return { success: true };
    } catch (error) {
      console.error('Failed to send serial input:', error);
      return { success: false, error: error.message };
    }
  });

  // Conversation management handlers
  ipcMain.handle('create-conversation', async (event, title) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const conversation = dmlAgent.createConversation(title);
      return { success: true, conversation };
    } catch (error) {
      console.error('Error creating conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('list-conversations', async () => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const conversations = dmlAgent.listConversations();
      return { success: true, conversations };
    } catch (error) {
      console.error('Error listing conversations:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('load-conversation', async (event, conversationId) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const conversation = dmlAgent.loadConversation(conversationId);
      return { success: true, conversation };
    } catch (error) {
      console.error('Error loading conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-conversation', async (event, conversationId, messages, title) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const conversation = await dmlAgent.saveConversation(conversationId, messages, title);
      return { success: true, conversation };
    } catch (error) {
      console.error('Error saving conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-conversation', async (event, conversationId) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const result = dmlAgent.deleteConversation(conversationId);
      return { success: true, ...result };
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rename-conversation', async (event, conversationId, newTitle) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const conversation = dmlAgent.renameConversation(conversationId, newTitle);
      return { success: true, conversation };
    } catch (error) {
      console.error('Error renaming conversation:', error);
      return { success: false, error: error.message };
    }
  });

  // Read tree.json file for a DML file
  ipcMain.handle('read-tree-json', async (event, filename) => {
    try {
      if (!currentWorkspaceManager) {
        throw new Error('Workspace manager not initialized');
      }
      
      const treeFilename = `${filename}.tree.json`;
      const treeFilePath = path.join(currentWorkspaceManager.getWorkspacePath(), treeFilename);
      
      // Check if file exists
      const fs = await import('fs/promises');
      try {
        const treeJson = await fs.readFile(treeFilePath, 'utf-8');
        const tree = JSON.parse(treeJson);
        return { success: true, tree };
      } catch (err) {
        if (err.code === 'ENOENT') {
          // File doesn't exist - not an error, just return null
          return { success: true, tree: null };
        }
        throw err;
      }
    } catch (error) {
      console.error('Error reading tree JSON:', error);
      return { success: false, error: error.message };
    }
  });

  // Generate prompt from tree (for display in log view)
  ipcMain.handle('generate-prompt-from-tree', async (event, tree) => {
    try {
      const { treeToStructuredPrompt } = await import('./tree-compiler.js');
      const prompt = treeToStructuredPrompt(tree);
      return prompt;
    } catch (error) {
      console.error('Error generating prompt from tree:', error);
      throw error;
    }
  });

  // Compile tree to DML
  ipcMain.handle('compile-tree-to-dml', async (event, tree) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      
      const result = await dmlAgent.compileTreeToDml(tree);
      
      // Signal end of streaming
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return result;
    } catch (error) {
      console.error('Error compiling tree to DML:', error);
      
      // Signal end of streaming even on error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('dml-output-end');
      }
      
      return { success: false, error: error.message };
    }
  });

  // Save DML file with tree.json
  ipcMain.handle('save-dml-with-tree', async (event, filename, content, description, tree) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      
      // Save the DML file
      await dmlAgent.saveDmlFileContent(filename, content, description);
      
      // Save the tree.json file
      const fs = await import('fs/promises');
      const treeFilename = `${filename}.tree.json`;
      const treeFilePath = path.join(currentWorkspaceManager.getWorkspacePath(), treeFilename);
      
      // Update tree metadata
      if (!tree.metadata) tree.metadata = {};
      tree.metadata.lastModified = new Date().toISOString();
      
      await fs.writeFile(treeFilePath, JSON.stringify(tree, null, 2), 'utf-8');
      
      // Trigger file list refresh
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('refresh-dml-files');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error saving DML with tree:', error);
      return { success: false, error: error.message };
    }
  });

  // Cleanup conversation resources (SWIPL instance, etc.)
  ipcMain.handle('cleanup-conversation', async (event, conversationId) => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      await dmlAgent.cleanupConversation(conversationId);
      return { success: true };
    } catch (error) {
      console.error('Error cleaning up conversation:', error);
      return { success: false, error: error.message };
    }
  });

  // Get status of all active conversations
  ipcMain.handle('get-active-conversations-status', async () => {
    try {
      if (!dmlAgent) {
        throw new Error('Agent not initialized');
      }
      const status = dmlAgent.getActiveConversationsStatus();
      return { success: true, status };
    } catch (error) {
      console.error('Error getting conversation status:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('IPC handlers registered');
}

/**
 * Create an input callback that sends requests to the renderer
 */
export function createInputCallback() {
  return async (promptText, inputType = 'text', options = null) => {
    return new Promise((resolve, reject) => {
      const requestId = `input_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store the resolver
      pendingInputRequests.set(requestId, resolve);
      
      // Send request to renderer with type information
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('request-user-input', {
          requestId,
          promptText,
          inputType,
          options
        });
        
        // Set timeout for input request (5 minutes)
        setTimeout(() => {
          if (pendingInputRequests.has(requestId)) {
            pendingInputRequests.delete(requestId);
            resolve(''); // Return empty string on timeout
          }
        }, 300000);
      } else {
        reject(new Error('No window available for input'));
      }
    });
  };
}

/**
 * Create an output callback that streams output to the renderer
 */
export function createOutputCallback() {
  return (outputChunk) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('dml-output-chunk', outputChunk);
    }
  };
}
