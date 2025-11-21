import express from 'express';
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
    const sessionId = req.query.sessionId || `session_${new Date().toISOString().replace(/[:.]/g, '_').replace(/-/g, '_')}`;
    const sessionWorkspace = getSessionWorkspace(sessionId);
    console.log(`[Upload] Using session workspace: ${sessionWorkspace} for session: ${sessionId}`);
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
// Use /tmp for Vercel (detected by VERCEL_ENV), workspaces for local/Docker
const isVercel = process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;
process.env.USER_WORKSPACES = isVercel ? '/tmp' : path.join(__dirname, 'workspaces');

// Load deployment configuration
let deploymentConfig = {};
try {
  const configPath = path.join(__dirname, 'deployment-config.json');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    deploymentConfig = JSON.parse(configContent);
    console.log('✓ Loaded deployment configuration');
    
    // Set up environment variables for API keys (if not already set)
    if (deploymentConfig.models?.goalModel?.apiKey) {
      const apiKey = deploymentConfig.models.goalModel.apiKey;
      if (!apiKey.startsWith('${') && !process.env.OPENAI_API_KEY) {
        process.env.OPENAI_API_KEY = apiKey;
      }
    }
  }
} catch (error) {
  console.warn('⚠ Could not load deployment config:', error.message);
}

// Import DML execution engine from bundled runtime
let runDmlCode;
let initializationPromise = null;

async function initializeSWIPL() {
  try {
    const SWIPL = await import('./runtime/vendor/swipl-wasm/dist/swipl/swipl-bundle.js');
    
    const swipl = await SWIPL.default({
      arguments: ['-x', 'mi.qsave'],
      locateFile: (file) => {
        return `./runtime/vendor/swipl-wasm/dist/swipl/${file}`;
      },
      preRun: [(module) => {
        console.log('[SWIPL Init] Loading mi.qsave into SWIPL filesystem');
        const miQsavePath = path.join(__dirname, 'runtime', 'mi.qsave');
        const miData = fs.readFileSync(miQsavePath);
        module.FS.writeFile('mi.qsave', miData);
      }]
    });
    
    // Mark that DML modules are already loaded (from mi.qsave)
    swipl.__dmlModulesLoaded = true;
    
    return swipl;
  } catch (error) {
    console.error('Failed to initialize SWIPL:', error);
    return null;
  }
}

// Lazy initialization - only run when first request comes in
async function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        const bridgeModule = await import('./runtime/dml-js/bridge.js');
        runDmlCode = bridgeModule.runDmlAsync;
        console.log('✓ DML execution engine loaded');
        return true;
      } catch (error) {
        console.error('✗ Failed to import DML execution engine:', error);
        console.error('  Make sure the runtime files are present in:', RUNTIME_DIR);
        return false;
      }
    })();
  }
  return initializationPromise;
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
    const txtFilePath = dmlPath.replace('.dml', '.txt');
    if (fs.existsSync(txtFilePath)) {
      const descContent = fs.readFileSync(txtFilePath, 'utf-8').trim();
      if (descContent) {
        description = descContent.split('\n')[0];
        if (description.length > 200) {
          description = description.substring(0, 197) + '...';
        }
      }
    }

    res.json({
      name: dmlFile,
      description,
      parameters,
      version: '1.0.0',
    });
  } catch (error) {
    console.error('Error reading DML metadata:', error);
    res.status(500).json({
      error: 'Failed to read DML metadata',
      message: error.message,
    });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log(`[Upload] File uploaded: ${req.file.filename} to ${req.file.path}`);
    console.log(`[Upload] Session: ${req.query.sessionId || 'none'}`);

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

  // Ensure runtime is initialized
  await ensureInitialized();

  if (!runDmlCode) {
    return res.status(503).json({ 
      error: 'DML execution engine not available',
      details: 'The server is not properly configured with the DML runtime'
    });
  }

  try {
    // Create session-based workspace
    const actualSessionId = sessionId || `session-${Date.now()}`;
    const sessionWorkspace = getSessionWorkspace(actualSessionId);

    // Create a fresh SWIPL instance for this execution
    console.log(`[Execute] Creating fresh SWIPL instance for session ${actualSessionId}`);
    const freshSwipl = await initializeSWIPL();
    
    if (!freshSwipl) {
      return res.status(503).json({
        error: 'Failed to initialize SWIPL instance',
        details: 'Could not create a fresh SWIPL instance for this execution'
      });
    }

    // Read the DML file (it's in parent directory's src/dml folder)
    const dmlPath = path.join(__dirname, '..', 'src', 'dml', dmlFile);
    
    if (!fs.existsSync(dmlPath)) {
      return res.status(404).json({ error: `DML file not found: ${dmlFile}` });
    }

    const dmlCode = fs.readFileSync(dmlPath, 'utf-8');

    if (streamResults) {
      // Set up streaming response
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Session-Id', actualSessionId);

      try {
        // Stream DML execution output with fresh SWIPL instance
        const outputGenerator = runDmlCode(dmlCode, actualSessionId, parameters || {}, sessionWorkspace, freshSwipl);

        for await (const chunk of outputGenerator) {
          res.write(chunk);
          // Flush to ensure chunk is sent immediately
          if (res.flush) res.flush();
        }

        res.end();
      } catch (execError) {
        res.write(`\n\nError during execution: ${execError.message}\n`);
        res.end();
      }
    } else {
      // Non-streaming response - collect all output
      const outputChunks = [];
      
      try {
        // Use fresh SWIPL instance for execution
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
        error: `DML file not found: ${dmlFile}` 
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

// List workspace files endpoint - handler function
const listFilesHandler = (req, res) => {
  // Support both POST (body) and GET (query) methods
  const sessionId = req.body?.sessionId || req.query?.sessionId;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const sessionWorkspace = getSessionWorkspace(sessionId);
    
    // Check if directory exists
    if (!fs.existsSync(sessionWorkspace)) {
      return res.json({ sessionId, files: [] });
    }

    // Read directory contents
    const files = fs.readdirSync(sessionWorkspace);
    
    const fileList = files.map(filename => {
      const filePath = path.join(sessionWorkspace, filename);
      const stats = fs.statSync(filePath);
      
      return {
        name: filename,
        size: stats.size,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
      };
    }).filter(f => !f.isDirectory); // Only return files, not directories
    
    res.json({
      sessionId,
      files: fileList,
    });
  } catch (error) {
    console.error('[List Files] Error:', error);
    res.status(500).json({
      error: 'Failed to list files',
      message: error.message
    });
  }
};

// Support both GET and POST for flexibility
app.post('/api/list-files', listFilesHandler);
app.get('/api/list-files', listFilesHandler);

// Download workspace file endpoint
app.get('/api/download', (req, res) => {
  const { sessionId, filename } = req.query;

  if (!sessionId || !filename) {
    return res.status(400).json({ error: 'sessionId and filename are required' });
  }

  // Validate filename (prevent path traversal)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  try {
    const sessionWorkspace = getSessionWorkspace(sessionId);
    const filePath = path.join(sessionWorkspace, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Send file for download
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('[Download] Error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download file' });
        }
      }
    });
  } catch (error) {
    console.error('[Download] Error:', error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message
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

// Export app for Vercel
export default app;

// Start server only if not in Vercel environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  DML Micro App Server                  ║
╚════════════════════════════════════════╝

Server running on: http://localhost:${PORT}
DML Engine: ${runDmlCode ? '✓ Available' : '✗ Not Available'}
Runtime Directory: ${RUNTIME_DIR}
Workspaces: ${process.env.USER_WORKSPACES}

API Endpoints:
  GET  /api/health           - Health check
  GET  /api/metadata         - Get DML file metadata
  POST /api/upload           - Upload file to session workspace
  POST /api/execute          - Execute DML file
  POST /api/cleanup-session  - Clean up session workspace
  POST /api/validate         - Validate DML file
  GET/POST /api/list-files   - List session workspace files
  GET  /api/download         - Download workspace file

Press Ctrl+C to stop
`);
  });
}
