import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { setupIpcHandlers } from './ipc-handlers.js';
import { WorkspaceManager } from './workspace-manager.js';
import { registerDeploymentHandlers } from './deployment-handler.js';
import resourceResolver from './resource-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let workspaceManager = null;

// Determine if running in development or production
const isDev = !app.isPackaged;

// Get the resources path (for WASM and V86 files)
const getResourcesPath = () => {
  if (isDev) {
    // In development, use the project root
    return path.join(__dirname, '../../..');
  } else {
    // In production, use the resources folder
    return process.resourcesPath;
  }
};

// Store paths globally for use in other modules
global.appPaths = {
  resources: getResourcesPath(),
  userData: app.getPath('userData'),
  isDev
};

// Export resource resolver globally
global.resourceResolver = resourceResolver;

/**
 * Load settings and inject environment variables into process.env
 */
async function loadAndInjectSettings(workspaceManager) {
  try {
    const settingsPath = workspaceManager.getSettingsPath();
    
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(data);
      
      // Inject API keys into environment
      if (settings.apiKeys) {
        Object.entries(settings.apiKeys).forEach(([key, value]) => {
          if (value) {
            process.env[key] = value;
          }
        });
      }
      
      // Inject custom environment variables
      if (settings.environmentVariables && Array.isArray(settings.environmentVariables)) {
        settings.environmentVariables.forEach(({ key, value }) => {
          if (key && value) {
            process.env[key] = value;
            console.log(`Loaded environment variable: ${key}`);
          }
        });
      }
      
      console.log('Settings loaded and environment variables injected');
    }
  } catch (error) {
    console.error('Failed to load settings on startup:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1700,
    height: 1100,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'DeepClause - Neurosymbolic AI System',
    icon: path.join(__dirname, '../renderer/assets/icon.png') // Optional: add an icon
  });

  // Load the renderer HTML
  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files
    mainWindow.loadFile(path.join(__dirname, '../../../dist/renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// Initialize the app
app.whenReady().then(async () => {
  // Initialize workspace manager FIRST
  workspaceManager = new WorkspaceManager();
  await workspaceManager.initialize();

  // Register custom protocol for workspace files AFTER workspace is initialized
  protocol.registerFileProtocol('workspace', (request, callback) => {
    const url = request.url.replace('workspace://', '');
    const workspacePath = workspaceManager.getWorkspacePath();
    
    console.log('[Protocol] Workspace request:', request.url);
    console.log('[Protocol] Cleaned URL:', url);
    console.log('[Protocol] Workspace path:', workspacePath);
    
    if (!workspacePath) {
      console.error('[Protocol] Workspace path not available');
      callback({ error: -6 }); // FILE_NOT_FOUND
      return;
    }
    
    const filePath = path.normalize(path.join(workspacePath, url));
    console.log('[Protocol] Full file path:', filePath);
    
    // Security check: ensure the file is within workspace
    if (filePath.startsWith(workspacePath)) {
      // Check if file exists
      if (fs.existsSync(filePath)) {
        console.log('[Protocol] File exists, serving:', filePath);
        callback({ path: filePath });
      } else {
        console.error('[Protocol] File not found:', filePath);
        callback({ error: -6 }); // FILE_NOT_FOUND
      }
    } else {
      console.error('[Protocol] Access denied - file outside workspace:', filePath);
      callback({ error: -10 }); // ACCESS_DENIED
    }
  });

  // Load settings and inject environment variables
  await loadAndInjectSettings(workspaceManager);

  // Setup IPC handlers
  setupIpcHandlers(workspaceManager);
  
  // Register deployment handlers
  registerDeploymentHandlers();

  // Create the window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app quit
app.on('before-quit', async () => {
  // Cleanup if needed
  if (workspaceManager) {
    await workspaceManager.cleanup();
  }
});

// Export for use in other modules
export { mainWindow, workspaceManager, resourceResolver };
