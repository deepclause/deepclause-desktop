// Vercel serverless function proxy to Express app
import app from '../server/index.js';

export default app;

export const config = {
  maxDuration: 300,
  memory: 3008,
};
