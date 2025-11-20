// Application Configuration
export const config = {
  // DML Execution API endpoint
  // For local development with standalone server
  apiEndpoint: import.meta.env.VITE_API_ENDPOINT || 'http://localhost:3001',
  
  // DML file being deployed
  dmlFileName: '{{DML_FILE_NAME}}',
  
  // Execution settings
  execution: {
    timeout: 300000, // 5 minutes
    streamResults: true,
    enableRichOutput: true,
  },
  
  // UI Settings
  ui: {
    theme: 'light', // 'light' | 'dark' | 'auto'
    showExecutionHistory: true,
    maxHistoryItems: 50,
  },
};

// API endpoints
export const API_ROUTES = {
  execute: '/api/execute',
  validate: '/api/validate',
  health: '/api/health',
};
