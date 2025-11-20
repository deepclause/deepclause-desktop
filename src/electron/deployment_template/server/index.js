import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSessionWorkspace, cleanupSession } from './workspace-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Set up environment for DML runtime
const RUNTIME_DIR = path.join(__dirname, 'runtime');
process.env.USER_WORKSPACES = path.join(__dirname, 'workspaces');

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
let swiplModule;

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

try {
  const bridgeModule = await import('./runtime/dml-js/bridge.js');
  runDmlCode = bridgeModule.runDmlAsync;
  swiplModule = await initializeSWIPL();
  console.log('✓ DML execution engine loaded');
  console.log('✓ SWIPL initialized:', !!swiplModule);
} catch (error) {
  console.error('✗ Failed to import DML execution engine:', error);
  console.error('  Make sure the runtime files are present in:', RUNTIME_DIR);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dmlEngineAvailable: !!runDmlCode,
  });
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
    const actualSessionId = sessionId || `session-${Date.now()}`;
    const sessionWorkspace = getSessionWorkspace(actualSessionId);

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
        // Stream DML execution output
        const outputGenerator = runDmlCode(dmlCode, actualSessionId, parameters || {}, sessionWorkspace, swiplModule);

        for await (const chunk of outputGenerator) {
          res.write(chunk);
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
        const outputGenerator = runDmlCode(dmlCode, actualSessionId, parameters || {}, sessionWorkspace, swiplModule);
        
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
  POST /api/execute          - Execute DML file
  POST /api/cleanup-session  - Clean up session workspace
  POST /api/validate         - Validate DML file

Press Ctrl+C to stop
`);
});
