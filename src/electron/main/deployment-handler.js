import { ipcMain, dialog } from 'electron';
import { generateDeployment } from './deployment-generator.js';
import path from 'path';
import fs from 'fs';

/**
 * Convert dot notation DML filename to file path
 * e.g., "browser.find_trials" -> "browser/find_trials.dml"
 */
function convertDotPathToFilePath(name) {
  // If the name already contains path separators or ends with .dml, just ensure .dml extension
  if (name.includes('/') || name.includes('\\')) {
    return name.endsWith('.dml') ? name : `${name}.dml`;
  }
  
  // Convert dots to path separators (but preserve .dml extension if present)
  if (name.endsWith('.dml')) {
    const nameWithoutExt = name.slice(0, -4);
    const pathName = nameWithoutExt.replace(/\./g, path.sep);
    return `${pathName}.dml`;
  }
  
  // Convert dots to path separators and add .dml extension
  const pathName = name.replace(/\./g, path.sep);
  return `${pathName}.dml`;
}

/**
 * Register IPC handlers for deployment functionality
 */
export function registerDeploymentHandlers() {
  // Handle deployment dialog and generation
  ipcMain.handle('deploy-dml-file', async (event, options) => {
    const { dmlFilePath, workspaceDir } = options;

    try {
      // Show dialog to get deployment name
      const { response: deploymentName, canceled: nameCanceled } = await dialog.showMessageBox({
        type: 'question',
        title: 'Create DML Deployment',
        message: 'Enter deployment name:',
        buttons: ['Cancel'],
        cancelId: 0,
        // Note: Electron's dialog doesn't have text input by default
        // We'll need to use a separate input dialog or custom window
      });

      if (nameCanceled) {
        return { success: false, canceled: true };
      }

      // Show dialog to select output folder
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Deployment Output Folder',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose where to create the deployment',
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const outputFolder = filePaths[0];

      // For now, derive deployment name from DML filename
      // TODO: Add a custom dialog for entering deployment name
      const dmlFileName = path.basename(dmlFilePath, '.dml');
      const suggestedName = dmlFileName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();

      // Generate the deployment
      const deploymentPath = await generateDeployment({
        dmlFilePath,
        deploymentName: suggestedName,
        outputFolder,
        workspaceDir,
      });

      return {
        success: true,
        deploymentPath,
        deploymentName: suggestedName,
      };
    } catch (error) {
      console.error('[Deployment Handler] Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Handle deployment with custom name (called from renderer with name input)
  ipcMain.handle('deploy-dml-file-with-name', async (event, options) => {
    const { dmlFilePath, deploymentName, outputFolder, workspaceDir, includeLinuxVM } = options;

    try {
      if (!dmlFilePath || !deploymentName || !outputFolder || !workspaceDir) {
        throw new Error('Missing required deployment options');
      }

      // Convert DML filename from dot notation to path (e.g., "browser.find_trials" -> "browser/find_trials.dml")
      const dmlRelativePath = convertDotPathToFilePath(dmlFilePath);
      
      // DML files are in .deepclause/dml_examples/ (not workspace/dml_examples)
      // workspaceDir is /home/andreas/.deepclause/workspace, so we need to go up one level
      const deepclauseDir = path.dirname(workspaceDir);
      const dmlExamplesDir = path.join(deepclauseDir, 'dml_examples');
      
      // Build full path to DML file
      const fullDmlPath = path.join(dmlExamplesDir, dmlRelativePath);

      // Validate DML file exists
      if (!fs.existsSync(fullDmlPath)) {
        throw new Error(`DML file not found: ${fullDmlPath}`);
      }

      console.log('[Deployment Handler] Deploying:', {
        dmlFilePath,
        dmlRelativePath,
        fullDmlPath,
        deploymentName,
        outputFolder,
        workspaceDir,
        includeLinuxVM: includeLinuxVM || false
      });

      // Generate the deployment
      const deploymentPath = await generateDeployment({
        dmlFilePath: fullDmlPath,
        deploymentName,
        outputFolder,
        workspaceDir,
        includeLinuxVM: includeLinuxVM || false,
      });

      return {
        success: true,
        deploymentPath,
        deploymentName,
      };
    } catch (error) {
      console.error('[Deployment Handler] Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Show folder selection dialog
  ipcMain.handle('select-deployment-folder', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Deployment Output Folder',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose where to create the deployment',
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return {
        success: true,
        folderPath: filePaths[0],
      };
    } catch (error) {
      console.error('[Deployment Handler] Error selecting folder:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  console.log('[Deployment Handler] Registered IPC handlers');
}
