// Application Configuration

// Determine API endpoint based on environment
const getApiEndpoint = () => {
  // 1. Check for explicit environment variable
  if (import.meta.env.VITE_API_ENDPOINT) {
    return import.meta.env.VITE_API_ENDPOINT;
  }
  
  // 2. If in production (built), use relative URLs (works for Vercel and Docker with reverse proxy)
  if (import.meta.env.PROD) {
    return ''; // Empty string means relative to current domain
  }
  
  // 3. Development mode - use localhost:3001
  return 'http://localhost:3001';
};

export const config = {
  // DML Execution API endpoint
  apiEndpoint: getApiEndpoint(),
  
  // DML file being deployed
  dmlFileName: '{{DML_FILE_NAME}}',
  
  // Execution settings
  execution: {
    timeout: 300000, // 5 minutes
    // Note: Streaming works in Docker/traditional deployments but not in Vercel serverless functions
    // For Vercel, results are collected and sent as a complete response
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
