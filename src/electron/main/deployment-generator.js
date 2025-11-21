import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import { analyzeDmlParameters, parseParameterType } from '../../dml-js/dml-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate a deployment for a DML file
 * 
 * @param {Object} options - Deployment options
 * @param {string} options.dmlFilePath - Path to the DML file to deploy
 * @param {string} options.deploymentName - Name for the deployment
 * @param {string} options.outputFolder - Folder where deployment will be created
 * @param {string} options.workspaceDir - Workspace directory with mi.qsave
 * @param {boolean} options.includeLinuxVM - Whether to include Linux VM tool (default: false)
 * @returns {Promise<string>} Path to the created deployment
 */
export async function generateDeployment(options) {
  const { dmlFilePath, deploymentName, outputFolder, workspaceDir, includeLinuxVM = false } = options;

  // Validate inputs
  if (!dmlFilePath || !deploymentName || !outputFolder) {
    throw new Error('Missing required fields: dmlFilePath, deploymentName, and outputFolder are required');
  }

  if (!fs.existsSync(dmlFilePath)) {
    throw new Error(`DML file not found: ${dmlFilePath}`);
  }

  // Sanitize deployment name for use in file paths
  const sanitizedName = deploymentName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const deploymentPath = path.join(outputFolder, sanitizedName);

  // Check if deployment folder already exists
  if (fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment folder already exists: ${deploymentPath}`);
  }

  console.log(`[Deployment] Creating deployment at: ${deploymentPath}`);

  // 1. Read and analyze DML file
  const dmlContent = fs.readFileSync(dmlFilePath, 'utf-8');
  const parameters = analyzeDmlParameters(dmlContent);
  const dmlFileName = path.basename(dmlFilePath);
  
  // Get description from .txt file if it exists
  let description = 'DML Micro Application';
  const txtFilePath = dmlFilePath.replace('.dml', '.txt');
  if (fs.existsSync(txtFilePath)) {
    const descContent = fs.readFileSync(txtFilePath, 'utf-8').trim();
    if (descContent) {
      description = descContent.split('\n')[0]; // First line
      if (description.length > 200) {
        description = description.substring(0, 197) + '...';
      }
    }
  }

  console.log(`[Deployment] DML file: ${dmlFileName}`);
  console.log(`[Deployment] Parameters found: ${parameters.length}`);

  // 2. Create deployment directory
  fs.mkdirSync(deploymentPath, { recursive: true });

  // 3. Copy template folder
  const templatePath = path.join(__dirname, '../deployment_template');
  console.log(`[Deployment] Copying template from: ${templatePath}`);
  await copyDirectoryRecursive(templatePath, deploymentPath, {
    exclude: ['node_modules', 'dist', '.git'],
  });

  // 4. Copy DML runtime dependencies
  await copyDmlDependencies(deploymentPath, workspaceDir, includeLinuxVM);

  // 4b. Copy user settings and capture env vars
  await copyUserSettings(deploymentPath, includeLinuxVM);

  // 5. Copy DML file to deployment
  const dmlDestPath = path.join(deploymentPath, 'src', 'dml', dmlFileName);
  fs.mkdirSync(path.dirname(dmlDestPath), { recursive: true });
  fs.copyFileSync(dmlFilePath, dmlDestPath);
  console.log(`[Deployment] Copied DML file to: ${dmlDestPath}`);

  // 6. Prepare replacement data
  const parametersJson = JSON.stringify(parameters, null, 2);
  const parametersList = formatParametersMarkdown(parameters);

  const replacements = {
    '{{DEPLOYMENT_NAME}}': sanitizedName,
    '{{DML_FILE_NAME}}': dmlFileName,
    '{{DML_DESCRIPTION}}': description,
    '{{PARAMETERS_JSON}}': parametersJson,
    '{{PARAMETERS_LIST}}': parametersList,
  };

  // 7. Replace placeholders in template files
  const filesToProcess = [
    'package.json',
    'README.md',
    'DEPLOYMENT.md',
    'QUICKSTART.md',
    'index.html',
    'src/App.tsx',
    'src/config.ts',
    'server/package.json',
    'docker-compose.yml',
    'nginx.conf',
    'Dockerfile',
    'vercel.json',
  ];

  for (const file of filesToProcess) {
    const filePath = path.join(deploymentPath, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      
      // Replace all placeholders
      for (const [placeholder, value] of Object.entries(replacements)) {
        content = content.replace(new RegExp(placeholder, 'g'), value);
      }
      
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`[Deployment] Processed: ${file}`);
    }
  }

  // 8. Create session-based workspace setup in server
  await createServerWorkspaceSetup(deploymentPath);

  // 9. Update server to use correct paths
  // NOTE: Disabled - server/index.js is now maintained in the template
  // The template has the complete, up-to-date server code
  // await updateServerPaths(deploymentPath);

  // 10. Fix v86 import paths in runtime/dml-js/tools.js
  await fixV86ImportPaths(deploymentPath);

  console.log(`[Deployment] ✅ Deployment created successfully at: ${deploymentPath}`);
  console.log(`[Deployment] `);
  console.log(`[Deployment] 📚 Quick Start Options:`);
  console.log(`[Deployment] `);
  console.log(`[Deployment] 1️⃣  Docker (Recommended for Production):`);
  console.log(`[Deployment]     cd ${deploymentPath}`);
  console.log(`[Deployment]     npm run docker:compose:up`);
  console.log(`[Deployment]     → Access at http://localhost`);
  console.log(`[Deployment] `);
  console.log(`[Deployment] 2️⃣  Vercel (Fastest Deployment):`);
  console.log(`[Deployment]     cd ${deploymentPath}`);
  console.log(`[Deployment]     npm run build`);
  console.log(`[Deployment]     vercel --prod`);
  console.log(`[Deployment] `);
  console.log(`[Deployment] 3️⃣  Local Development:`);
  console.log(`[Deployment]     cd ${deploymentPath}`);
  console.log(`[Deployment]     npm install`);
  console.log(`[Deployment]     npm run dev:all`);
  console.log(`[Deployment]     → Access at http://localhost:5173`);
  console.log(`[Deployment] `);
  console.log(`[Deployment] 📖 Full documentation:`);
  console.log(`[Deployment]     - QUICKSTART.md for immediate deployment`);
  console.log(`[Deployment]     - DEPLOYMENT.md for detailed instructions`);
  console.log(`[Deployment]     - README.md for complete project info`);

  return deploymentPath;
}

/**
 * Copy DML runtime dependencies to deployment
 */
async function copyDmlDependencies(deploymentPath, workspaceDir, includeLinuxVM = false) {
  console.log(`[Deployment] Copying DML runtime dependencies...`);
  console.log(`[Deployment] Linux VM: ${includeLinuxVM ? 'ENABLED (experimental)' : 'DISABLED'}`);

  const resourcesPath = global.appPaths?.resources || path.join(__dirname, '../../..');

  // 1. Copy mi.qsave
  const miQsaveSrc = path.join(workspaceDir, 'mi.qsave');
  const miQsaveDest = path.join(deploymentPath, 'server', 'runtime', 'mi.qsave');
  fs.mkdirSync(path.dirname(miQsaveDest), { recursive: true });
  
  if (fs.existsSync(miQsaveSrc)) {
    fs.copyFileSync(miQsaveSrc, miQsaveDest);
    console.log(`[Deployment] ✓ Copied mi.qsave`);
  } else {
    console.warn(`[Deployment] ⚠ mi.qsave not found at ${miQsaveSrc}`);
  }

  // 2. Copy DML core files
  const dmlCoreSrc = path.join(resourcesPath, 'src', 'dml-core');
  const dmlCoreDest = path.join(deploymentPath, 'server', 'runtime', 'dml-core');
  if (fs.existsSync(dmlCoreSrc)) {
    copyDirectoryRecursive(dmlCoreSrc, dmlCoreDest);
    console.log(`[Deployment] ✓ Copied dml-core`);
  }

  // 3. Copy DML JavaScript bridge and tools
  const dmlJsSrc = path.join(resourcesPath, 'src', 'dml-js');
  const dmlJsDest = path.join(deploymentPath, 'server', 'runtime', 'dml-js');
  if (fs.existsSync(dmlJsSrc)) {
    copyDirectoryRecursive(dmlJsSrc, dmlJsDest, {
      exclude: ['node_modules', '*.test.js'],
    });
    console.log(`[Deployment] ✓ Copied dml-js`);
  }

  // 4. Copy config folder for model configuration
  const configSrc = path.join(resourcesPath, 'src', 'config');
  const configDest = path.join(deploymentPath, 'server', 'runtime', 'config');
  if (fs.existsSync(configSrc)) {
    copyDirectoryRecursive(configSrc, configDest);
    console.log(`[Deployment] ✓ Copied config`);
  }

  // 5. Copy vendor/swipl-wasm
  const swiplSrc = path.join(resourcesPath, 'vendor', 'swipl-wasm');
  const swiplDest = path.join(deploymentPath, 'server', 'runtime', 'vendor', 'swipl-wasm');
  if (fs.existsSync(swiplSrc)) {
    fs.mkdirSync(path.dirname(swiplDest), { recursive: true });
    copyDirectoryRecursive(swiplSrc, swiplDest);
    console.log(`[Deployment] ✓ Copied swipl-wasm`);
  }

  // 5b. Copy vendor/v86 to runtime/vendor (without images - always for code structure)
  const v86Src = path.join(resourcesPath, 'vendor', 'v86');
  const v86RuntimeDest = path.join(deploymentPath, 'server', 'runtime', 'vendor', 'v86');
  if (fs.existsSync(v86Src)) {
    fs.mkdirSync(v86RuntimeDest, { recursive: true });
    copyDirectoryRecursive(v86Src, v86RuntimeDest, {
      exclude: ['images', '*.img', '*.iso', '*.bin'],
    });
    console.log(`[Deployment] ✓ Copied v86 code to runtime/vendor (without images)`);
  }

  // 6. Copy vendor/v86 to server/vendor (conditionally with images - only if includeLinuxVM is true)
  if (includeLinuxVM) {
    console.log(`[Deployment] ⚠️  Including Linux VM tool (experimental, ~50MB)...`);
    
    const v86VendorDest = path.join(deploymentPath, 'server', 'vendor', 'v86');
    if (fs.existsSync(v86Src)) {
      copyDirectoryRecursive(v86Src, v86VendorDest);
      console.log(`[Deployment] ✓ Copied v86 to server/vendor/v86 (with images)`);
    }
  } else {
    console.log(`[Deployment] ⊗ Skipping Linux VM tool (not requested)`);
    console.log(`[Deployment]   → To enable: Check "Include Linux VM Tool" in deployment dialog`);
  }

  console.log(`[Deployment] ✅ All dependencies copied`);
}

/**
 * Create session-based workspace setup in server
 */
async function createServerWorkspaceSetup(deploymentPath) {
  const workspaceSetupPath = path.join(deploymentPath, 'server', 'workspace-setup.js');
  
  const workspaceSetup = `import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Session-based workspace management
// Use /tmp in Vercel (detected by VERCEL_ENV or AWS_LAMBDA_FUNCTION_NAME), workspaces folder otherwise
const isVercel = process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
const WORKSPACES_DIR = isVercel
  ? '/tmp' 
  : (process.env.USER_WORKSPACES || path.join(__dirname, 'workspaces'));
const SESSION_TIMEOUT = 3600000; // 1 hour in milliseconds

// Track active sessions
const activeSessions = new Map();

/**
 * Create or get a session-based workspace
 * @param {string} sessionId - Unique session identifier
 * @returns {string} Path to the session workspace
 */
export function getSessionWorkspace(sessionId) {
  // Ensure workspaces directory is initialized
  ensureWorkspacesDir();
  
  if (!sessionId) {
    sessionId = crypto.randomBytes(16).toString('hex');
  }

  const sessionPath = path.join(WORKSPACES_DIR, sessionId);
  
  // Create workspace directory if it doesn't exist
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
    console.log(\`[Workspace] Created session workspace: \${sessionId}\`);
  }

  // Update session last access time
  activeSessions.set(sessionId, {
    path: sessionPath,
    lastAccess: Date.now(),
  });

  return sessionPath;
}

/**
 * Clean up expired sessions
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  const expiredSessions = [];

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastAccess > SESSION_TIMEOUT) {
      expiredSessions.push(sessionId);
    }
  }

  for (const sessionId of expiredSessions) {
    const session = activeSessions.get(sessionId);
    try {
      // Remove workspace directory
      if (fs.existsSync(session.path)) {
        fs.rmSync(session.path, { recursive: true, force: true });
        console.log(\`[Workspace] Cleaned up expired session: \${sessionId}\`);
      }
      activeSessions.delete(sessionId);
    } catch (error) {
      console.error(\`[Workspace] Error cleaning up session \${sessionId}:\`, error);
    }
  }
}

/**
 * Manually clean up a session
 * @param {string} sessionId - Session to clean up
 */
export function cleanupSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    try {
      if (fs.existsSync(session.path)) {
        fs.rmSync(session.path, { recursive: true, force: true });
        console.log(\`[Workspace] Cleaned up session: \${sessionId}\`);
      }
      activeSessions.delete(sessionId);
    } catch (error) {
      console.error(\`[Workspace] Error cleaning up session \${sessionId}:\`, error);
    }
  }
}

// Run cleanup periodically (only if not in Vercel serverless)
if (!isVercel) {
  setInterval(cleanupExpiredSessions, 300000); // Every 5 minutes
}

// Ensure workspaces directory exists (lazy - only when first accessed)
let workspacesDirInitialized = false;
function ensureWorkspacesDir() {
  if (!workspacesDirInitialized) {
    try {
      fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
      workspacesDirInitialized = true;
      console.log(\`[Workspace] Session workspace system initialized\`);
      console.log(\`[Workspace] Base directory: \${WORKSPACES_DIR}\`);
      console.log(\`[Workspace] Session timeout: \${SESSION_TIMEOUT / 1000}s\`);
    } catch (error) {
      // In read-only environments like Vercel, this is OK - /tmp is already available
      if (isVercel) {
        workspacesDirInitialized = true;
        console.log(\`[Workspace] Using Vercel /tmp directory\`);
      } else {
        throw error;
      }
    }
  }
}
`;

  fs.writeFileSync(workspaceSetupPath, workspaceSetup, 'utf-8');
  console.log(`[Deployment] ✓ Created workspace setup module`);
}

/**
 * Update server paths to use bundled runtime
 */
async function updateServerPaths(deploymentPath) {
  const serverIndexPath = path.join(deploymentPath, 'server', 'index.js');
  
  if (!fs.existsSync(serverIndexPath)) {
    console.warn(`[Deployment] ⚠ server/index.js not found`);
    return;
  }

  let content = fs.readFileSync(serverIndexPath, 'utf-8');

  // Update import paths to use the runtime folder
  const updatedContent = `import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { getSessionWorkspace, cleanupSession } from './workspace-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for file uploads
// Note: We need to handle sessionId from the URL query parameter since
// req.body is not yet parsed when multer's destination is called
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Get sessionId from query parameter
    const sessionId = req.query.sessionId || \`session_\${new Date().toISOString().replace(/[:.]/g, '_').replace(/-/g, '_')}\`;
    const sessionWorkspace = getSessionWorkspace(sessionId);
    console.log(\`[Upload] Using session workspace: \${sessionWorkspace} for session: \${sessionId}\`);
    cb(null, sessionWorkspace);
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Set up environment for DML runtime
const RUNTIME_DIR = path.join(__dirname, 'runtime');
process.env.USER_WORKSPACES = path.join(__dirname, 'workspaces');

// CRITICAL: Load settings BEFORE importing any DML modules
// This ensures environment variables are injected from settings.json before the modules load
console.log('[Server] Loading configuration from settings.json...');
try {
  const settingsPath = path.join(RUNTIME_DIR, 'config', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    
    // Inject ALL environment variables from settings (not just apiKeys)
    let totalInjected = 0;
    const injectedVars = [];
    
    // 1. Inject API keys
    if (settings.apiKeys) {
      Object.entries(settings.apiKeys).forEach(([key, value]) => {
        if (value && !process.env[key]) {
          process.env[key] = value;
          totalInjected++;
          injectedVars.push(key);
        }
      });
    }
    
    // 2. Inject environment variables from settings.environmentVariables array
    if (settings.environmentVariables && Array.isArray(settings.environmentVariables)) {
      settings.environmentVariables.forEach(({ key, value }) => {
        if (key && value !== undefined && value !== null && !process.env[key]) {
          process.env[key] = String(value);
          totalInjected++;
          injectedVars.push(key);
        }
      });
    }
    
    // 3. Inject environment variables from settings.environment object (legacy support)
    if (settings.environment && typeof settings.environment === 'object') {
      Object.entries(settings.environment).forEach(([key, value]) => {
        if (value !== undefined && value !== null && !process.env[key]) {
          process.env[key] = String(value);
          totalInjected++;
          injectedVars.push(key);
        }
      });
    }
    
    if (totalInjected > 0) {
      console.log(\`[Server] Injected \${totalInjected} environment variables from settings: \${injectedVars.join(', ')}\`);
    } else {
      console.log('[Server] No environment variables needed injection (already set)');
    }
    console.log('[Server] ✓ Configuration loaded successfully');
  } else {
    console.warn(\`[Server] ⚠ Settings file not found at: \${settingsPath}\`);
    console.warn('[Server] ⚠ Server will run with default environment only');
  }
} catch (error) {
  console.error('[Server] Error loading settings:', error);
}

// Import DML execution engine from bundled runtime
let runDmlCode;

/**
 * Create a fresh SWIPL instance for a session
 * This ensures clean state for each execution
 */
async function createFreshSWIPL() {
  try {
    const SWIPL = await import('./runtime/vendor/swipl-wasm/dist/swipl/swipl-bundle.js');
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    console.log('[SWIPL] Creating fresh SWIPL instance...');
    
    const swipl = await SWIPL.default({
      arguments: ['-x', 'mi.qsave'],
      locateFile: (file) => {
        return \`./runtime/vendor/swipl-wasm/dist/swipl/\${file}\`;
      },
      preRun: [(module) => {
        console.log('[SWIPL] Loading mi.qsave into SWIPL filesystem');
        const miQsavePath = path.join(__dirname, 'runtime', 'mi.qsave');
        const miData = fs.readFileSync(miQsavePath);
        module.FS.writeFile('mi.qsave', miData);
      }]
    });
    
    // Mark that DML modules are already loaded (from mi.qsave)
    swipl.__dmlModulesLoaded = true;
    
    console.log('[SWIPL] ✓ Fresh SWIPL instance created');
    return swipl;
  } catch (error) {
    console.error('[SWIPL] ✗ Failed to create SWIPL instance:', error);
    throw error;
  }
}

try {
  const bridgeModule = await import('./runtime/dml-js/bridge.js');
  runDmlCode = bridgeModule.runDmlAsync;
  console.log('[Server] ✓ DML execution engine loaded');
  console.log('[Server] ℹ SWIPL instances will be created fresh for each execution');
} catch (error) {
  console.error('[Server] ✗ Failed to import DML execution engine:', error);
  console.error('[Server]   Make sure the runtime files are present in:', RUNTIME_DIR);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dmlEngineAvailable: !!runDmlCode,
  });
});

// DML metadata endpoint
app.get('/api/metadata', async (req, res) => {
  try {
    // Import the DML utilities
    const { analyzeDmlParameters } = await import('./runtime/dml-js/dml-utils.js');
    
    // Read the DML file
    const dmlFiles = fs.readdirSync(path.join(__dirname, '..', 'src', 'dml'));
    const dmlFile = dmlFiles.find(f => f.endsWith('.dml'));
    
    if (!dmlFile) {
      return res.status(404).json({ error: 'No DML file found' });
    }

    const dmlPath = path.join(__dirname, '..', 'src', 'dml', dmlFile);
    const dmlCode = fs.readFileSync(dmlPath, 'utf-8');
    
    // Parse parameters using the DML utilities (which support type detection)
    const parameters = analyzeDmlParameters(dmlCode);
    
    // Look for description file
    let description = 'DML Micro Application';
    const txtFile = dmlFile.replace('.dml', '.txt');
    const txtPath = path.join(__dirname, '..', 'src', 'dml', txtFile);
    
    if (fs.existsSync(txtPath)) {
      const descContent = fs.readFileSync(txtPath, 'utf-8').trim();
      if (descContent) {
        description = descContent.split('\\n')[0];
        if (description.length > 200) {
          description = description.substring(0, 197) + '...';
        }
      }
    }
    
    res.json({
      name: dmlFile,
      description,
      parameters
    });
  } catch (error) {
    console.error('[Metadata] Error:', error);
    res.status(500).json({
      error: 'Failed to load metadata',
      message: error.message
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(\`[Upload] File uploaded: \${req.file.filename} to \${req.file.path}\`);
    console.log(\`[Upload] Session: \${req.query.sessionId || 'none'}\`);

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      path: req.file.path,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    res.status(500).json({
      error: 'File upload failed',
      message: error.message,
    });
  }
});

// Execute DML endpoint
app.post('/api/execute', async (req, res) => {
  const { dmlFile, parameters, streamResults, sessionId } = req.body;

  if (!dmlFile) {
    return res.status(400).json({ error: 'dmlFile is required' });
  }

  if (!runDmlCode) {
    return res.status(503).json({ 
      error: 'DML execution engine not available',
      details: 'The server is not properly configured with the DML runtime'
    });
  }

  try {
    // Create session-based workspace
    const actualSessionId = sessionId || \`session_\${new Date().toISOString().replace(/[:.]/g, '_').replace(/-/g, '_')}\`;
    const sessionWorkspace = getSessionWorkspace(actualSessionId);

    // Read the DML file (it's in parent directory's src/dml folder)
    const dmlPath = path.join(__dirname, '..', 'src', 'dml', dmlFile);
    
    if (!fs.existsSync(dmlPath)) {
      return res.status(404).json({ error: \`DML file not found: \${dmlFile}\` });
    }

    const dmlCode = fs.readFileSync(dmlPath, 'utf-8');

    // Create a fresh SWIPL instance for this execution
    console.log(\`[Session \${actualSessionId}] Creating fresh SWIPL instance...\`);
    const freshSwipl = await createFreshSWIPL();

    if (streamResults) {
      // Set up streaming response
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Session-Id', actualSessionId);

      try {
        // Stream DML execution output with fresh SWIPL
        const outputGenerator = runDmlCode(dmlCode, actualSessionId, parameters || {}, sessionWorkspace, freshSwipl);

        for await (const chunk of outputGenerator) {
          res.write(chunk);
        }

        res.end();
        console.log(\`[Session \${actualSessionId}] Execution completed (streaming)\`);
      } catch (execError) {
        res.write(\`\\n\\nError during execution: \${execError.message}\\n\`);
        res.end();
      }
    } else {
      // Non-streaming response - collect all output
      const outputChunks = [];
      
      try {
        const outputGenerator = runDmlCode(dmlCode, actualSessionId, parameters || {}, sessionWorkspace, freshSwipl);
        
        for await (const chunk of outputGenerator) {
          outputChunks.push(chunk);
        }
        
        const output = outputChunks.join('');

        res.json({
          success: true,
          output,
          sessionId: actualSessionId,
          timestamp: new Date().toISOString(),
        });
        console.log(\`[Session \${actualSessionId}] Execution completed (non-streaming)\`);
      } catch (execError) {
        res.status(500).json({
          success: false,
          error: execError.message,
        });
      }
    }
  } catch (error) {
    console.error('DML execution error:', error);
    res.status(500).json({
      error: 'DML execution failed',
      message: error.message,
    });
  }
});

// Cleanup session endpoint
app.post('/api/cleanup-session', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  cleanupSession(sessionId);
  res.json({ success: true, message: 'Session cleaned up' });
});

// Validate DML endpoint
app.post('/api/validate', async (req, res) => {
  const { dmlFile } = req.body;

  if (!dmlFile) {
    return res.status(400).json({ error: 'dmlFile is required' });
  }

  try {
    const dmlPath = path.join(__dirname, '..', 'src', 'dml', dmlFile);
    
    if (!fs.existsSync(dmlPath)) {
      return res.status(404).json({ 
        valid: false, 
        error: \`DML file not found: \${dmlFile}\` 
      });
    }

    const dmlCode = fs.readFileSync(dmlPath, 'utf-8');

    // Basic validation - check for required predicates
    const hasAgentMain = dmlCode.includes('agent_main');
    
    res.json({
      valid: hasAgentMain,
      warnings: hasAgentMain ? [] : ['Missing agent_main predicate'],
      fileSize: dmlCode.length,
    });
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: error.message,
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(\`
╔════════════════════════════════════════╗
║  DML Micro App Server                  ║
╚════════════════════════════════════════╝

Server running on: http://localhost:\${PORT}
DML Engine: \${runDmlCode ? '✓ Available' : '✗ Not Available'}
Runtime Directory: \${RUNTIME_DIR}
Workspaces: \${process.env.USER_WORKSPACES}

API Endpoints:
  GET  /api/health           - Health check
  POST /api/execute          - Execute DML file
  POST /api/cleanup-session  - Clean up session workspace
  POST /api/validate         - Validate DML file

Press Ctrl+C to stop
\`);
});
`;

  fs.writeFileSync(serverIndexPath, updatedContent, 'utf-8');
  console.log(`[Deployment] ✓ Updated server/index.js with runtime paths`);
}

/**
 * Fix v86 import paths in runtime files for deployment
 */
async function fixV86ImportPaths(deploymentPath) {
  console.log(`[Deployment] Fixing v86 import paths...`);
  
  const toolsJsPath = path.join(deploymentPath, 'server', 'runtime', 'dml-js', 'tools.js');
  
  if (!fs.existsSync(toolsJsPath)) {
    console.warn(`[Deployment] ⚠ tools.js not found at ${toolsJsPath}`);
    return;
  }

  let content = fs.readFileSync(toolsJsPath, 'utf-8');
  
  // Fix the v86 import path
  // From: import { V86 } from "../../vendor/v86/build/libv86.mjs";
  // To:   import { V86 } from "../vendor/v86/build/libv86.mjs";
  content = content.replace(
    /from\s+["']\.\.\/\.\.\/vendor\/v86\//g,
    'from "../vendor/v86/'
  );
  
  fs.writeFileSync(toolsJsPath, content, 'utf-8');
  console.log(`[Deployment] ✓ Fixed v86 import paths in tools.js`);
}

/**
 * Recursively copy directory
 */
function copyDirectoryRecursive(source, destination, options = {}) {
  const { exclude = [] } = options;

  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const files = fs.readdirSync(source);

  for (const file of files) {
    // Check if file should be excluded
    if (exclude.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(file);
      }
      return file === pattern;
    })) {
      continue;
    }

    const sourcePath = path.join(source, file);
    const destPath = path.join(destination, file);

    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectoryRecursive(sourcePath, destPath, options);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

/**
 * Format parameters as markdown list
 */
function formatParametersMarkdown(parameters) {
  if (!parameters || parameters.length === 0) {
    return '- No parameters required';
  }

  return parameters.map(param => {
    const typeInfo = param.type ? ` (${param.type})` : '';
    return `- **${param.name || param.key}**${typeInfo}: ${param.description}`;
  }).join('\n');
}

/**
 * Copy user settings to deployment (no environment variable capturing)
 */
async function copyUserSettings(deploymentPath, includeLinuxVM = false) {
  console.log(`[Deployment] Copying user settings...`);
  
  let config = {};
  
  // 1. Try to load existing settings
  let settingsSource = null;
  const electronPath = path.join(os.homedir(), '.deepclause', 'config', 'settings.json');
  const cliPath = path.resolve(process.cwd(), 'config', 'settings.json');
  
  if (fs.existsSync(electronPath)) {
    settingsSource = electronPath;
  } else if (fs.existsSync(cliPath)) {
    settingsSource = cliPath;
  }
  
  if (settingsSource) {
    try {
      const content = fs.readFileSync(settingsSource, 'utf-8');
      config = JSON.parse(content);
      console.log(`[Deployment] Loaded base settings from ${settingsSource}`);
    } catch (e) {
      console.warn(`[Deployment] Failed to parse settings.json: ${e.message}`);
    }
  } else {
    console.log(`[Deployment] No settings.json found - deployment will use empty settings`);
  }
  
  // 2. Disable Linux VM tool unless explicitly requested
  if (!includeLinuxVM) {
    if (!config.defaultTools) {
      config.defaultTools = {};
    }
    config.defaultTools.linux_vm = false;
    console.log(`[Deployment] ✓ Disabled Linux VM tool in settings`);
  } else {
    console.log(`[Deployment] ⚠️  Linux VM tool enabled (experimental)`);
  }
  
  // Write to deployment
  const configDest = path.join(deploymentPath, 'server', 'runtime', 'config', 'settings.json');
  fs.mkdirSync(path.dirname(configDest), { recursive: true });
  fs.writeFileSync(configDest, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[Deployment] ✓ Wrote settings.json to deployment`);
}
