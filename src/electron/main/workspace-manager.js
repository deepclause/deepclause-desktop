import { app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Access resource resolver from global (set by main process)
// Use a getter function for lazy access to avoid import-time undefined issues
const getResourceResolver = () => global.resourceResolver;

/**
 * Manages workspace folder for the Electron app
 */
export class WorkspaceManager {
  constructor() {
    this.workspacePath = null;
    this.dmlExamplesPath = null;
    this.configPath = null;
    this.deepClauseDir = null;
  }

  async initialize() {
    // Use ~/.deepclause in user's home directory
    const homeDir = os.homedir();
    this.deepClauseDir = path.join(homeDir, '.deepclause');
    
    const defaultWorkspacePath = path.join(this.deepClauseDir, 'workspace');
    const defaultDmlExamplesPath = path.join(this.deepClauseDir, 'dml_examples');
    const defaultConfigPath = path.join(this.deepClauseDir, 'config');

    // Create default directories if they don't exist
    this.ensureDirectory(this.deepClauseDir);
    this.ensureDirectory(defaultWorkspacePath);
    this.ensureDirectory(defaultDmlExamplesPath);
    this.ensureDirectory(defaultConfigPath);

    // Copy default files from resources if this is the first run
    await this.copyDefaultResources(defaultWorkspacePath, defaultDmlExamplesPath, defaultConfigPath);

    // Set the paths
    this.workspacePath = defaultWorkspacePath;
    this.dmlExamplesPath = defaultDmlExamplesPath;
    this.configPath = defaultConfigPath;

    return {
      workspace: this.workspacePath,
      dmlExamples: this.dmlExamplesPath,
      config: this.configPath
    };
  }

  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  async copyDefaultResources(workspacePath, dmlExamplesPath, configPath) {
    const resourcesPath = global.appPaths.resources;
    const resolver = getResourceResolver();

    // Copy DML examples if they don't exist
    const sourceDmlExamples = resolver ? resolver.resolve('dml_examples') : path.join(resourcesPath, 'dml_examples');
    if (fs.existsSync(sourceDmlExamples) && fs.readdirSync(dmlExamplesPath).length === 0) {
      this.copyDirectory(sourceDmlExamples, dmlExamplesPath);
      console.log(`Copied DML examples from ${sourceDmlExamples} to ${dmlExamplesPath}`);
    }

    // Copy initial workspace files if workspace is empty (before README is created)
    const workspaceFiles = fs.readdirSync(workspacePath);
    const isWorkspaceEmpty = workspaceFiles.length === 0;
    
    if (isWorkspaceEmpty) {
      // In development, path is src/electron/initial_workspace
      // In production, path is initial_workspace (from extraResources)
      const initialWorkspacePath = resolver?.isDev 
        ? path.join(resolver.resourcesPath, 'src/electron/initial_workspace')
        : (resolver ? resolver.resolve('initial_workspace') : path.join(resourcesPath, 'initial_workspace'));
      
      console.log(`Checking for initial workspace at: ${initialWorkspacePath}`);
      console.log(`Initial workspace exists: ${fs.existsSync(initialWorkspacePath)}`);
      
      if (fs.existsSync(initialWorkspacePath)) {
        const initialFiles = fs.readdirSync(initialWorkspacePath);
        console.log(`Found ${initialFiles.length} files in initial_workspace:`, initialFiles);
        this.copyDirectory(initialWorkspacePath, workspacePath);
        console.log(`✓ Copied initial workspace files from ${initialWorkspacePath} to ${workspacePath}`);
      } else {
        console.warn(`Initial workspace directory not found at: ${initialWorkspacePath}`);
      }
    }

    // Copy config if it doesn't exist
    const sourceConfig = resolver ? resolver.resolve('config') : path.join(resourcesPath, 'config');
    if (fs.existsSync(sourceConfig)) {
      // Copy settings.json directly to ~/.deepclause/settings.json (not in config subdirectory)
      const settingsSource = path.join(sourceConfig, 'settings.json');
      const settingsDest = path.join(this.deepClauseDir, 'settings.json');
      const oldSettingsDest = path.join(configPath, 'settings.json'); // Old location for migration
      
      // Migrate existing settings from old location if needed
      if (fs.existsSync(oldSettingsDest) && !fs.existsSync(settingsDest)) {
        fs.copyFileSync(oldSettingsDest, settingsDest);
        console.log(`Migrated settings.json from ${oldSettingsDest} to ${settingsDest}`);
      } else if (fs.existsSync(settingsSource) && !fs.existsSync(settingsDest)) {
        fs.copyFileSync(settingsSource, settingsDest);
        console.log(`Copied settings.json from ${settingsSource} to ${settingsDest}`);
      }
      
      // Copy playwright.json to home directory config
      const playwrightSource = path.join(sourceConfig, 'playwright.json');
      const playwrightDest = path.join(configPath, 'playwright.json');
      if (fs.existsSync(playwrightSource) && !fs.existsSync(playwrightDest)) {
        fs.copyFileSync(playwrightSource, playwrightDest);
        console.log(`Copied playwright.json from ${playwrightSource} to ${playwrightDest}`);
      }
    }

    // Copy mi.qsave to global ~/.deepclause directory if it doesn't exist
    const globalMiQsavePath = path.join(this.deepClauseDir, 'mi.qsave');
    if (!fs.existsSync(globalMiQsavePath)) {
      const sourceMiQsave = resolver?.isDev
        ? path.join(resolver.resourcesPath, 'src/electron/initial_workspace/mi.qsave')
        : (resolver ? resolver.resolve('initial_workspace/mi.qsave') : path.join(resourcesPath, 'initial_workspace/mi.qsave'));
      
      if (fs.existsSync(sourceMiQsave)) {
        fs.copyFileSync(sourceMiQsave, globalMiQsavePath);
        console.log(`Copied mi.qsave from ${sourceMiQsave} to ${globalMiQsavePath}`);
      } else {
        console.warn(`Warning: mi.qsave not found at ${sourceMiQsave}. DML execution may not work in production mode.`);
      }
    }

    // Create a README in workspace if it doesn't exist yet (after copying initial files)
    const readmePath = path.join(workspacePath, 'README.md');
    if (!fs.existsSync(readmePath)) {
      const readmeContent = `# DeepClause Workspace

This is your personal workspace folder for DeepClause, located at:
\`${workspacePath}\`

You can store files here that you want to work with in your DML scripts.
All files in this folder are accessible to your DML programs.

## Directory Structure

- **${this.deepClauseDir}**: Main DeepClause directory
  - **workspace/**: Your working files (this directory)
  - **dml_examples/**: Example DML scripts
  - **settings.json**: Configuration file (API keys, models, MCP servers)
  - **config/**: Additional configuration files (playwright.json, etc.)

## Getting Started

1. Try running some of the example DML scripts from dml_examples
2. Create your own DML scripts in the dml_examples folder
3. Store any data files you want to work with here

Happy coding! 🚀
`;
      fs.writeFileSync(readmePath, readmeContent);
    }
  }

  copyDirectory(source, destination) {
    this.ensureDirectory(destination);
    const files = fs.readdirSync(source);

    for (const file of files) {
      const sourcePath = path.join(source, file);
      const destPath = path.join(destination, file);

      if (fs.statSync(sourcePath).isDirectory()) {
        this.copyDirectory(sourcePath, destPath);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  async selectWorkspaceFolder() {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Folder',
      defaultPath: this.workspacePath
    });

    if (!result.canceled && result.filePaths.length > 0) {
      this.workspacePath = result.filePaths[0];
      return this.workspacePath;
    }

    return null;
  }

  getWorkspacePath() {
    return this.workspacePath;
  }

  getDmlExamplesPath() {
    return this.dmlExamplesPath;
  }

  getConfigPath() {
    return this.configPath;
  }

  getDeepClauseDir() {
    return this.deepClauseDir;
  }

  getSettingsPath() {
    // Use ~/.deepclause/settings.json (same path as CLI for consistency)
    return path.join(this.deepClauseDir, 'settings.json');
  }

  async cleanup() {
    // Any cleanup needed before app closes
    console.log('Workspace manager cleanup');
  }
}
